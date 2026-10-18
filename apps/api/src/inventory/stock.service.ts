import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type {
  listMovementsQuerySchema,
  listStockQuerySchema,
  StockMovementPage,
  StockPage,
} from '@pos/contracts';
import { fromMilli, toMilli } from '@pos/domain';
import type { z } from 'zod';
import { allowedBranchFilter, assertBranchAllowed } from '../common/branch-access';
import { RequestContext } from '../common/request-context';
import { PrismaService } from '../prisma/prisma.service';
import { variantLabel } from './inventory-helpers';

type StockQuery = z.output<typeof listStockQuerySchema>;

@Injectable()
export class StockService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * One row per active variant for a branch, ordered by product name and SKU.
   * Filtering (in stock, low, expiring) and keyset pagination run in SQL so pages
   * stay correct however the filter is defined.
   */
  list(tenantId: string, query: StockQuery): Promise<StockPage> {
    assertBranchAllowed(RequestContext.get()?.principal, query.branchId);
    return this.prisma.withTenant(tenantId, async (tx) => {
      const horizon = new Date(Date.now() + query.days * 86_400_000).toISOString().slice(0, 10);
      const search = query.q ? `%${query.q.replace(/[\\%_]/g, (c) => `\\${c}`)}%` : null;

      const filter = {
        ALL: Prisma.sql`TRUE`,
        IN_STOCK: Prisma.sql`COALESCE(l.total, 0) > 0`,
        LOW: Prisma.sql`v.reorder_level IS NOT NULL AND COALESCE(l.total, 0) <= v.reorder_level`,
        EXPIRING: Prisma.sql`EXISTS (
          SELECT 1 FROM stock_levels sl JOIN stock_batches b ON b.id = sl.batch_id
          WHERE sl.branch_id = ${query.branchId}::uuid AND sl.variant_id = v.id AND sl.quantity > 0
            AND b.expiry_date IS NOT NULL AND b.expiry_date <= ${horizon}::date)`,
      }[query.filter];

      const ids = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT v.id
        FROM product_variants v
        JOIN products p ON p.id = v.product_id
        LEFT JOIN (
          SELECT variant_id, SUM(quantity) AS total FROM stock_levels
          WHERE branch_id = ${query.branchId}::uuid GROUP BY variant_id
        ) l ON l.variant_id = v.id
        WHERE v.tenant_id = ${tenantId}::uuid AND v.status = 'ACTIVE' AND p.status = 'ACTIVE'
          AND ${filter}
          AND (${search}::text IS NULL OR p.name ILIKE ${search} OR v.sku ILIKE ${search} OR v.barcode = ${query.q ?? null})
          AND (${query.cursor ?? null}::uuid IS NULL OR (p.name, v.sku, v.id) > (
            SELECT p2.name, v2.sku, v2.id FROM product_variants v2 JOIN products p2 ON p2.id = v2.product_id
            WHERE v2.id = ${query.cursor ?? null}::uuid))
        ORDER BY p.name, v.sku, v.id
        LIMIT ${query.limit + 1}`;

      const pageIds = ids.slice(0, query.limit).map((row) => row.id);
      const variants = await tx.productVariant.findMany({
        where: { tenantId, id: { in: pageIds } },
        include: {
          product: { select: { id: true, name: true, unit: true } },
          levels: { where: { branchId: query.branchId }, include: { batch: true } },
        },
      });
      const byId = new Map(variants.map((v) => [v.id, v]));

      const items = pageIds.map((id) => {
        const variant = byId.get(id)!;
        const total = variant.levels.reduce(
          (sum, level) => sum + toMilli(level.quantity.toString()),
          0,
        );
        const batches = variant.levels
          .filter((level) => toMilli(level.quantity.toString()) !== 0 || level.batchId === null)
          .map((level) => ({
            batchId: level.batchId,
            batchNumber: level.batch?.batchNumber ?? null,
            expiryDate: level.batch?.expiryDate?.toISOString().slice(0, 10) ?? null,
            quantity: level.quantity.toString(),
          }))
          .sort((a, b) => (a.expiryDate ?? '9999').localeCompare(b.expiryDate ?? '9999'));
        const nextExpiry =
          batches
            .filter((b) => b.expiryDate && toMilli(b.quantity) > 0)
            .map((b) => b.expiryDate!)[0] ?? null;
        const reorderLevel = variant.reorderLevel?.toString() ?? null;
        return {
          variantId: variant.id,
          productId: variant.product.id,
          productName: variant.product.name,
          sku: variant.sku,
          variantLabel: variantLabel(variant.attributes),
          barcode: variant.barcode,
          unit: variant.product.unit,
          quantity: fromMilli(total),
          reorderLevel,
          low: reorderLevel !== null && total <= toMilli(reorderLevel),
          nextExpiry,
          batches,
        };
      });
      return { items, nextCursor: ids.length > query.limit ? (pageIds.at(-1) ?? null) : null };
    });
  }

  movements(
    tenantId: string,
    query: z.output<typeof listMovementsQuerySchema>,
  ): Promise<StockMovementPage> {
    const principal = RequestContext.get()?.principal;
    if (query.branchId) assertBranchAllowed(principal, query.branchId);
    // Staff limited to some branches only see their branches' history.
    const allowed = query.branchId ? undefined : allowedBranchFilter(principal);
    return this.prisma.withTenant(tenantId, async (tx) => {
      const rows = await tx.stockMovement.findMany({
        where: {
          tenantId,
          ...(query.variantId ? { variantId: query.variantId } : {}),
          ...(query.branchId ? { branchId: query.branchId } : {}),
          ...(allowed ? { branchId: allowed } : {}),
        },
        include: {
          branch: { select: { name: true } },
          variant: { include: { product: { select: { name: true, unit: true } } } },
          batch: { select: { batchNumber: true } },
          actor: { select: { fullName: true } },
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: query.limit + 1,
        ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
      });
      const page = rows.slice(0, query.limit);
      return {
        items: page.map((row) => ({
          id: row.id,
          type: row.type,
          quantity: row.quantity.toString(),
          balanceAfter: row.balanceAfter.toString(),
          branchId: row.branchId,
          branchName: row.branch.name,
          variantId: row.variantId,
          productName: row.variant.product.name,
          sku: row.variant.sku,
          variantLabel: variantLabel(row.variant.attributes),
          unit: row.variant.product.unit,
          batchNumber: row.batch?.batchNumber ?? null,
          referenceType: row.referenceType,
          referenceId: row.referenceId,
          referenceNumber: row.referenceNumber,
          unitCostMinor: row.unitCostMinor === null ? null : Number(row.unitCostMinor),
          reason: row.reason,
          actorName: row.actor?.fullName ?? null,
          createdAt: row.createdAt.toISOString(),
        })),
        nextCursor: rows.length > query.limit ? (page.at(-1)?.id ?? null) : null,
      };
    });
  }
}
