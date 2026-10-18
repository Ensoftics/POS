import { Injectable } from '@nestjs/common';
import type {
  CatalogSyncPage,
  listConflictsQuerySchema,
  SaleConflict,
  SaleConflictPage,
} from '@pos/contracts';
import type { z } from 'zod';
import { AuditService } from '../audit/audit.service';
import { AppException } from '../common/app-exception';
import type { AuthPrincipal } from '../common/request-context';
import { invalidState, variantLabel } from '../inventory/inventory-helpers';
import { MediaLinks } from '../media/media-links';
import { PrismaService } from '../prisma/prisma.service';

type ConflictsQuery = z.output<typeof listConflictsQuerySchema>;

/**
 * A device's position in the catalogue's change stream. While a sync is paging
 * the cursor is exact; the cursor a device stores between syncs is "final" and is
 * replayed with an overlap, because a change committed late can carry an
 * earlier timestamp than one already sent. Re-sent items are harmless upserts.
 */
interface Cursor {
  final: boolean;
  at: Date;
  id: string;
}
const OVERLAP_MS = 60_000;
const ZERO_ID = '00000000-0000-0000-0000-000000000000';

function encode(cursor: Cursor): string {
  return Buffer.from(
    `${cursor.final ? 'f' : 'p'}|${cursor.at.toISOString()}|${cursor.id}`,
  ).toString('base64url');
}

function decode(value: string | undefined): Cursor | null {
  if (!value) return null;
  const [mode, at, id] = Buffer.from(value, 'base64url').toString('utf8').split('|');
  const date = new Date(at ?? '');
  if (
    (mode !== 'f' && mode !== 'p') ||
    Number.isNaN(date.getTime()) ||
    !/^[0-9a-f-]{36}$/.test(id ?? '')
  )
    throw AppException.validation([{ path: 'cursor', message: 'validation.cursor.invalid' }]);
  return { final: mode === 'f', at: date, id: id! };
}

@Injectable()
export class SyncService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly links: MediaLinks,
  ) {}

  catalog(
    tenantId: string,
    cursorText: string | undefined,
    limit: number,
  ): Promise<CatalogSyncPage> {
    const cursor = decode(cursorText);
    const from = cursor
      ? cursor.final
        ? { at: new Date(cursor.at.getTime() - OVERLAP_MS), id: ZERO_ID }
        : { at: cursor.at, id: cursor.id }
      : { at: new Date(0), id: ZERO_ID };
    return this.prisma.withTenant(tenantId, async (tx) => {
      const rows = await tx.$queryRaw<
        Array<{
          id: string;
          product_id: string;
          name: string;
          brand: string | null;
          sku: string;
          barcode: string | null;
          attributes: unknown;
          unit: string;
          price_minor: bigint;
          tax_rate_id: string | null;
          active: boolean;
          image_id: string | null;
          changed_at: Date;
        }>
      >`
        SELECT v.id, v.product_id, p.name, p.brand, v.sku, v.barcode, v.attributes, p.unit,
               v.price_minor, p.tax_rate_id,
               (v.status = 'ACTIVE' AND p.status = 'ACTIVE') AS active,
               (SELECT i.id FROM product_images i
                WHERE i.tenant_id = p.tenant_id AND i.product_id = p.id
                ORDER BY i.position LIMIT 1) AS image_id,
               GREATEST(v.updated_at, p.updated_at) AS changed_at
        FROM product_variants v
        JOIN products p ON p.tenant_id = v.tenant_id AND p.id = v.product_id
        WHERE v.tenant_id = ${tenantId}::uuid
          AND (GREATEST(v.updated_at, p.updated_at), v.id) > (${from.at}::timestamptz, ${from.id}::uuid)
        ORDER BY changed_at, v.id
        LIMIT ${limit + 1}`;
      const page = rows.slice(0, limit);
      const hasMore = rows.length > limit;
      const last = page.at(-1);
      const next: Cursor | null = last
        ? { final: !hasMore, at: last.changed_at, id: last.id }
        : cursor
          ? { ...cursor, final: true }
          : null;
      return {
        items: page.map((row) => ({
          variantId: row.id,
          productId: row.product_id,
          productName: row.name,
          brand: row.brand,
          sku: row.sku,
          barcode: row.barcode,
          variantLabel: variantLabel(row.attributes),
          unit: row.unit,
          priceMinor: Number(row.price_minor),
          taxRateId: row.tax_rate_id,
          active: row.active,
          imageUrl: row.image_id ? this.links.imageUrl(tenantId, row.image_id, 'thumb') : null,
        })),
        cursor: next ? encode(next) : null,
        hasMore,
      };
    });
  }

  conflicts(tenantId: string, query: ConflictsQuery): Promise<SaleConflictPage> {
    return this.prisma.withTenant(tenantId, async (tx) => {
      const rows = await tx.saleConflict.findMany({
        where: {
          tenantId,
          ...(query.status === 'OPEN' ? { resolvedAt: null } : {}),
          ...(query.status === 'RESOLVED' ? { resolvedAt: { not: null } } : {}),
        },
        include,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: query.limit + 1,
        ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
      });
      const page = rows.slice(0, query.limit);
      return {
        items: page.map(toConflict),
        nextCursor: rows.length > query.limit ? (page.at(-1)?.id ?? null) : null,
      };
    });
  }

  resolve(
    tenantId: string,
    id: string,
    note: string,
    principal: AuthPrincipal,
  ): Promise<SaleConflict> {
    return this.prisma.withTenant(tenantId, async (tx) => {
      const current = await tx.saleConflict.findFirst({ where: { id, tenantId } });
      if (!current) throw AppException.notFound();
      const { count } = await tx.saleConflict.updateMany({
        where: { id, tenantId, resolvedAt: null },
        data: { resolvedAt: new Date(), resolvedById: principal.userId, resolutionNote: note },
      });
      if (count === 0) throw invalidState('This conflict was already resolved.');
      await this.audit.record(tx, {
        tenantId,
        action: 'sale.conflict_resolved',
        entityType: 'sale',
        entityId: current.saleId,
        metadata: { type: current.type, note },
      });
      return toConflict(
        await tx.saleConflict.findFirstOrThrow({ where: { id, tenantId }, include }),
      );
    });
  }
}

const include = {
  sale: {
    select: {
      number: true,
      totalMinor: true,
      createdAt: true,
      branch: { select: { name: true } },
      cashier: { select: { fullName: true } },
    },
  },
  resolvedBy: { select: { fullName: true } },
} as const;

function toConflict(row: {
  id: string;
  type: SaleConflict['type'];
  detail: unknown;
  saleId: string;
  createdAt: Date;
  resolvedAt: Date | null;
  resolutionNote: string | null;
  resolvedBy: { fullName: string } | null;
  sale: {
    number: string;
    totalMinor: bigint;
    createdAt: Date;
    branch: { name: string };
    cashier: { fullName: string } | null;
  };
}): SaleConflict {
  return {
    id: row.id,
    type: row.type,
    detail: (row.detail ?? {}) as Record<string, unknown>,
    saleId: row.saleId,
    saleNumber: row.sale.number,
    branchName: row.sale.branch.name,
    cashierName: row.sale.cashier?.fullName ?? null,
    saleTotalMinor: Number(row.sale.totalMinor),
    capturedAt: row.sale.createdAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
    resolvedAt: row.resolvedAt?.toISOString() ?? null,
    resolvedByName: row.resolvedBy?.fullName ?? null,
    resolutionNote: row.resolutionNote,
  };
}
