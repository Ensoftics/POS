import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type {
  createGoodsReceiptRequestSchema,
  GoodsReceipt,
  GoodsReceiptPage,
  listDocumentsQuerySchema,
  ValidationIssue,
} from '@pos/contracts';
import { fromMilli, lineTotalMinor, toMilli } from '@pos/domain';
import type { z } from 'zod';
import { AuditService } from '../audit/audit.service';
import { AppException } from '../common/app-exception';
import { RequestContext } from '../common/request-context';
import { loadCatalogRules, throwIfIssues } from '../catalog/catalog-rules';
import { PrismaService, type Tx } from '../prisma/prisma.service';
import {
  checkBranch,
  checkLines,
  invalidState,
  itemFields,
  loadItems,
  nextDocumentNumber,
} from './inventory-helpers';
import { PurchaseOrdersService } from './purchase-orders.service';
import { StockLedger } from './stock-ledger';

type CreateInput = z.output<typeof createGoodsReceiptRequestSchema>;

const include = {
  branch: { select: { name: true } },
  supplier: { select: { name: true } },
  purchaseOrder: { select: { number: true } },
  createdBy: { select: { fullName: true } },
  lines: { orderBy: { position: 'asc' as const }, include: { batch: true } },
} satisfies Prisma.GoodsReceiptInclude;
type ReceiptRow = Prisma.GoodsReceiptGetPayload<{ include: typeof include }>;

@Injectable()
export class ReceiptsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly ledger: StockLedger,
    private readonly orders: PurchaseOrdersService,
  ) {}

  list(
    tenantId: string,
    query: z.output<typeof listDocumentsQuerySchema>,
  ): Promise<GoodsReceiptPage> {
    return this.prisma.withTenant(tenantId, async (tx) => {
      const rows = await tx.goodsReceipt.findMany({
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

  get(tenantId: string, id: string): Promise<GoodsReceipt> {
    return this.prisma.withTenant(tenantId, (tx) => this.load(tx, tenantId, id));
  }

  /** Posts stock in. Idempotent on the client-generated id. Returns [receipt, created]. */
  async create(tenantId: string, input: CreateInput): Promise<[GoodsReceipt, boolean]> {
    return this.prisma.withTenant(
      tenantId,
      async (tx) => {
        const existing = await tx.goodsReceipt.findFirst({ where: { id: input.id, tenantId } });
        if (existing) return [await this.load(tx, tenantId, input.id), false];

        const rules = await loadCatalogRules(tx, tenantId);
        const items = await loadItems(
          tx,
          tenantId,
          input.lines.map((l) => l.variantId),
        );
        const issues: ValidationIssue[] = [
          ...(await checkBranch(tx, tenantId, input.branchId, 'branchId')).issues,
          ...checkLines(input.lines, items, {
            allowFraction: rules.allowFractionalQuantities,
            requireActive: true,
          }),
        ];

        let supplierId = input.supplierId ?? null;
        const order = input.purchaseOrderId
          ? await tx.purchaseOrder.findFirst({
              where: { id: input.purchaseOrderId, tenantId },
              include: { lines: { select: { variantId: true } } },
            })
          : null;
        if (input.purchaseOrderId && !order) {
          issues.push({ path: 'purchaseOrderId', message: 'validation.purchase_order.not_found' });
        }
        if (order) {
          if (!['ORDERED', 'PARTIALLY_RECEIVED'].includes(order.status)) {
            throw invalidState('Stock can only be received against an ordered purchase order.');
          }
          if (order.branchId !== input.branchId) {
            issues.push({ path: 'branchId', message: 'validation.purchase_order.other_branch' });
          }
          if (supplierId && supplierId !== order.supplierId) {
            issues.push({
              path: 'supplierId',
              message: 'validation.purchase_order.other_supplier',
            });
          }
          supplierId = order.supplierId;
          const ordered = new Set(order.lines.map((l) => l.variantId));
          input.lines.forEach((line, index) => {
            if (!ordered.has(line.variantId)) {
              issues.push({
                path: `lines.${index}.variantId`,
                message: 'validation.purchase_order.item_not_ordered',
              });
            }
          });
        }
        if (supplierId && !order) {
          const supplier = await tx.supplier.findFirst({ where: { id: supplierId, tenantId } });
          if (!supplier)
            issues.push({ path: 'supplierId', message: 'validation.supplier.not_found' });
        }

        input.lines.forEach((line, index) => {
          if (rules.trackBatchNumbers && !line.batchNumber) {
            issues.push({
              path: `lines.${index}.batchNumber`,
              message: 'validation.batch.required',
            });
          }
          if (rules.trackExpiryDates && !line.expiryDate) {
            issues.push({
              path: `lines.${index}.expiryDate`,
              message: 'validation.batch.expiry_required',
            });
          }
        });
        throwIfIssues(issues);

        const batchIds = await this.resolveBatches(tx, tenantId, input.lines);
        const number = await nextDocumentNumber(tx, tenantId, 'goods_receipt');
        await tx.goodsReceipt.create({
          data: {
            id: input.id,
            tenantId,
            number,
            branchId: input.branchId,
            supplierId,
            purchaseOrderId: order?.id ?? null,
            supplierReference: input.supplierReference ?? null,
            notes: input.notes ?? null,
            createdById: RequestContext.get()?.principal?.userId ?? null,
          },
        });
        await tx.goodsReceiptLine.createMany({
          data: input.lines
            .map((line, position) => ({
              tenantId,
              variantId: line.variantId,
              batchId: batchIds[position] ?? null,
              position,
              quantity: new Prisma.Decimal(line.quantity),
              unitCostMinor: BigInt(line.unitCostMinor),
            }))
            .map((line) => ({ ...line, receiptId: input.id })),
        });

        for (const [position, line] of input.lines.entries()) {
          await this.ledger.post(tx, {
            tenantId,
            branchId: input.branchId,
            variantId: line.variantId,
            batchId: batchIds[position] ?? null,
            quantity: line.quantity,
            type: 'RECEIPT',
            unitCostMinor: BigInt(line.unitCostMinor),
            referenceType: 'goods_receipt',
            referenceId: input.id,
            referenceNumber: number,
          });
        }

        if (order) {
          const received = new Map<string, string>();
          for (const line of input.lines) {
            received.set(
              line.variantId,
              fromMilli(toMilli(received.get(line.variantId) ?? '0') + toMilli(line.quantity)),
            );
          }
          await this.orders.recordReceipt(tx, tenantId, order.id, received);
        }

        await this.audit.record(tx, {
          tenantId,
          action: 'goods_receipt.posted',
          entityType: 'goods_receipt',
          entityId: input.id,
          metadata: { number, lines: input.lines.length, purchaseOrderId: order?.id ?? null },
        });
        return [await this.load(tx, tenantId, input.id), true];
      },
      { timeout: 30_000 },
    );
  }

  /**
   * Finds or creates the batch for each line. With expiry tracking but no batch
   * number, the batch is named after the expiry date. A batch number that already
   * exists with a different expiry date is rejected rather than silently merged.
   */
  private async resolveBatches(
    tx: Tx,
    tenantId: string,
    lines: CreateInput['lines'],
  ): Promise<Array<string | null>> {
    const ids: Array<string | null> = [];
    const issues: ValidationIssue[] = [];
    for (const [index, line] of lines.entries()) {
      const batchNumber = line.batchNumber ?? (line.expiryDate ? `EXP-${line.expiryDate}` : null);
      if (!batchNumber) {
        ids.push(null);
        continue;
      }
      const expiry = line.expiryDate ? new Date(line.expiryDate) : null;
      const existing = await tx.stockBatch.findFirst({
        where: { tenantId, variantId: line.variantId, batchNumber },
      });
      if (existing) {
        const sameExpiry = (existing.expiryDate?.getTime() ?? null) === (expiry?.getTime() ?? null);
        if (!sameExpiry)
          issues.push({
            path: `lines.${index}.expiryDate`,
            message: 'validation.batch.expiry_mismatch',
          });
        ids.push(existing.id);
      } else {
        const created = await tx.stockBatch.create({
          data: { tenantId, variantId: line.variantId, batchNumber, expiryDate: expiry },
        });
        ids.push(created.id);
      }
    }
    throwIfIssues(issues);
    return ids;
  }

  private async load(tx: Tx, tenantId: string, id: string): Promise<GoodsReceipt> {
    const row = await tx.goodsReceipt.findFirst({ where: { id, tenantId }, include });
    if (!row) throw AppException.notFound();
    return (await this.toDtos(tx, tenantId, [row]))[0]!;
  }

  private async toDtos(tx: Tx, tenantId: string, rows: ReceiptRow[]): Promise<GoodsReceipt[]> {
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
      supplierId: row.supplierId,
      supplierName: row.supplier?.name ?? null,
      purchaseOrderId: row.purchaseOrderId,
      purchaseOrderNumber: row.purchaseOrder?.number ?? null,
      supplierReference: row.supplierReference,
      notes: row.notes,
      totalMinor: row.lines.reduce(
        (sum, line) => sum + lineTotalMinor(line.unitCostMinor, line.quantity.toString()),
        0,
      ),
      createdAt: row.createdAt.toISOString(),
      createdByName: row.createdBy?.fullName ?? null,
      lines: row.lines.map((line) => ({
        id: line.id,
        ...itemFields(items.get(line.variantId), line.variantId),
        quantity: line.quantity.toString(),
        unitCostMinor: Number(line.unitCostMinor),
        batchNumber: line.batch?.batchNumber ?? null,
        expiryDate: line.batch?.expiryDate?.toISOString().slice(0, 10) ?? null,
      })),
    }));
  }
}
