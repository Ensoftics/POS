import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type {
  createStockAdjustmentRequestSchema,
  listDocumentsQuerySchema,
  StockAdjustment,
  StockAdjustmentPage,
} from '@pos/contracts';
import type { z } from 'zod';
import { AuditService } from '../audit/audit.service';
import { AppException } from '../common/app-exception';
import { RequestContext } from '../common/request-context';
import { loadCatalogRules, throwIfIssues } from '../catalog/catalog-rules';
import { PrismaService, type Tx } from '../prisma/prisma.service';
import {
  checkBranch,
  checkLines,
  itemFields,
  loadItems,
  nextDocumentNumber,
} from './inventory-helpers';
import { StockLedger } from './stock-ledger';

type CreateInput = z.output<typeof createStockAdjustmentRequestSchema>;

const include = {
  branch: { select: { name: true } },
  createdBy: { select: { fullName: true } },
  lines: {
    orderBy: { position: 'asc' as const },
    include: { batch: { select: { batchNumber: true } } },
  },
} satisfies Prisma.StockAdjustmentInclude;
type AdjustmentRow = Prisma.StockAdjustmentGetPayload<{ include: typeof include }>;

@Injectable()
export class AdjustmentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly ledger: StockLedger,
  ) {}

  list(
    tenantId: string,
    query: z.output<typeof listDocumentsQuerySchema>,
  ): Promise<StockAdjustmentPage> {
    return this.prisma.withTenant(tenantId, async (tx) => {
      const rows = await tx.stockAdjustment.findMany({
        where: { tenantId, ...(query.branchId ? { branchId: query.branchId } : {}) },
        include,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: query.limit + 1,
        ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
      });
      const page = rows.slice(0, query.limit);
      return {
        items: await this.toDtos(tx, tenantId, page),
        nextCursor: rows.length > query.limit ? (page.at(-1)?.id ?? null) : null,
      };
    });
  }

  /** Idempotent on the client-generated id. Returns [adjustment, created]. */
  create(tenantId: string, input: CreateInput): Promise<[StockAdjustment, boolean]> {
    return this.prisma.withTenant(
      tenantId,
      async (tx) => {
        if (
          await tx.stockAdjustment.findFirst({
            where: { id: input.id, tenantId },
            select: { id: true },
          })
        ) {
          return [await this.load(tx, tenantId, input.id), false];
        }
        const rules = await loadCatalogRules(tx, tenantId);
        const items = await loadItems(
          tx,
          tenantId,
          input.lines.map((l) => l.variantId),
        );
        throwIfIssues([
          ...(await checkBranch(tx, tenantId, input.branchId, 'branchId')).issues,
          // Archived items may still be written off, so activity is not required here.
          ...checkLines(input.lines, items, {
            allowFraction: rules.allowFractionalQuantities,
            requireActive: false,
          }),
          ...(await this.checkBatches(tx, tenantId, input.lines)),
        ]);

        const number = await nextDocumentNumber(tx, tenantId, 'stock_adjustment');
        const recorded: Array<{ variantId: string; batchId: string | null; quantity: string }> = [];
        for (const line of input.lines) {
          const item = items.get(line.variantId)!;
          const common = {
            tenantId,
            branchId: input.branchId,
            variantId: line.variantId,
            type: 'ADJUSTMENT' as const,
            reason: input.reason,
            referenceType: 'stock_adjustment',
            referenceId: input.id,
            referenceNumber: number,
          };
          if (line.quantity.startsWith('-')) {
            const taken = await this.ledger.takeOut(
              tx,
              {
                ...common,
                quantity: line.quantity.slice(1),
                ...(line.batchId !== undefined ? { batchId: line.batchId } : {}),
              },
              `${item.productName} (${item.sku})`,
            );
            recorded.push(
              ...taken.map((t) => ({
                variantId: line.variantId,
                batchId: t.batchId,
                quantity: `-${t.quantity}`,
              })),
            );
          } else {
            await this.ledger.post(tx, {
              ...common,
              batchId: line.batchId ?? null,
              quantity: line.quantity,
            });
            recorded.push({
              variantId: line.variantId,
              batchId: line.batchId ?? null,
              quantity: line.quantity,
            });
          }
        }

        await tx.stockAdjustment.create({
          data: {
            id: input.id,
            tenantId,
            number,
            branchId: input.branchId,
            reason: input.reason,
            notes: input.notes ?? null,
            createdById: RequestContext.get()?.principal?.userId ?? null,
          },
        });
        await tx.stockAdjustmentLine.createMany({
          data: recorded
            .map((line, position) => ({
              tenantId,
              variantId: line.variantId,
              batchId: line.batchId,
              position,
              quantity: new Prisma.Decimal(line.quantity),
            }))
            .map((line) => ({ ...line, adjustmentId: input.id })),
        });
        await this.audit.record(tx, {
          tenantId,
          action: 'stock.adjusted',
          entityType: 'stock_adjustment',
          entityId: input.id,
          metadata: { number, reason: input.reason, lines: recorded.length },
        });
        return [await this.load(tx, tenantId, input.id), true];
      },
      { timeout: 30_000 },
    );
  }

  private async checkBatches(tx: Tx, tenantId: string, lines: CreateInput['lines']) {
    const ids = lines.map((l) => l.batchId).filter((id): id is string => !!id);
    if (ids.length === 0) return [];
    const batches = await tx.stockBatch.findMany({ where: { tenantId, id: { in: ids } } });
    const byId = new Map(batches.map((b) => [b.id, b]));
    return lines.flatMap((line, index) =>
      line.batchId && byId.get(line.batchId)?.variantId !== line.variantId
        ? [{ path: `lines.${index}.batchId`, message: 'validation.batch.not_found' }]
        : [],
    );
  }

  private async load(tx: Tx, tenantId: string, id: string): Promise<StockAdjustment> {
    const row = await tx.stockAdjustment.findFirst({ where: { id, tenantId }, include });
    if (!row) throw AppException.notFound();
    return (await this.toDtos(tx, tenantId, [row]))[0]!;
  }

  private async toDtos(
    tx: Tx,
    tenantId: string,
    rows: AdjustmentRow[],
  ): Promise<StockAdjustment[]> {
    const items = await loadItems(
      tx,
      tenantId,
      rows.flatMap((row) => row.lines.map((l) => l.variantId)),
    );
    return rows.map((row) => ({
      id: row.id,
      number: row.number,
      branchId: row.branchId,
      branchName: row.branch.name,
      reason: row.reason,
      notes: row.notes,
      createdAt: row.createdAt.toISOString(),
      createdByName: row.createdBy?.fullName ?? null,
      lines: row.lines.map((line) => ({
        ...itemFields(items.get(line.variantId), line.variantId),
        batchNumber: line.batch?.batchNumber ?? null,
        quantity: line.quantity.toString(),
      })),
    }));
  }
}
