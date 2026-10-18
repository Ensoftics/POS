import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type {
  createPurchaseOrderRequestSchema,
  listPurchaseOrdersQuerySchema,
  PurchaseOrder,
  PurchaseOrderPage,
  updatePurchaseOrderRequestSchema,
  ValidationIssue,
} from '@pos/contracts';
import { fromMilli, lineTotalMinor, toMilli } from '@pos/domain';
import type { z } from 'zod';
import { AuditService } from '../audit/audit.service';
import { AppException } from '../common/app-exception';
import { versionConflict } from '../common/optimistic';
import { RequestContext } from '../common/request-context';
import { PrismaService, type Tx } from '../prisma/prisma.service';
import { loadCatalogRules, throwIfIssues } from '../catalog/catalog-rules';
import {
  checkBranch,
  checkLines,
  invalidState,
  itemFields,
  loadItems,
  nextDocumentNumber,
} from './inventory-helpers';

type CreateInput = z.output<typeof createPurchaseOrderRequestSchema>;
type UpdateInput = z.output<typeof updatePurchaseOrderRequestSchema>;
type ListQuery = z.output<typeof listPurchaseOrdersQuerySchema>;

const include = {
  supplier: { select: { name: true } },
  branch: { select: { name: true } },
  lines: { orderBy: { position: 'asc' as const } },
} satisfies Prisma.PurchaseOrderInclude;
type OrderRow = Prisma.PurchaseOrderGetPayload<{ include: typeof include }>;

@Injectable()
export class PurchaseOrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  list(tenantId: string, query: ListQuery): Promise<PurchaseOrderPage> {
    return this.prisma.withTenant(tenantId, async (tx) => {
      const rows = await tx.purchaseOrder.findMany({
        where: {
          tenantId,
          ...(query.status ? { status: query.status } : {}),
          ...(query.supplierId ? { supplierId: query.supplierId } : {}),
        },
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

  get(tenantId: string, id: string): Promise<PurchaseOrder> {
    return this.prisma.withTenant(tenantId, async (tx) => this.load(tx, tenantId, id));
  }

  create(tenantId: string, input: CreateInput): Promise<PurchaseOrder> {
    return this.prisma.withTenant(tenantId, async (tx) => {
      throwIfIssues(await this.validate(tx, tenantId, input));
      const number = await nextDocumentNumber(tx, tenantId, 'purchase_order');
      const order = await tx.purchaseOrder.create({
        data: {
          tenantId,
          number,
          supplierId: input.supplierId,
          branchId: input.branchId,
          expectedDate: input.expectedDate ? new Date(input.expectedDate) : null,
          notes: input.notes ?? null,
          createdById: RequestContext.get()?.principal?.userId ?? null,
        },
      });
      await this.replaceLines(tx, tenantId, order.id, input.lines);
      await this.audit.record(tx, {
        tenantId,
        action: 'purchase_order.created',
        entityType: 'purchase_order',
        entityId: order.id,
        metadata: { number, lines: input.lines.length },
      });
      return this.load(tx, tenantId, order.id);
    });
  }

  update(tenantId: string, id: string, input: UpdateInput): Promise<PurchaseOrder> {
    return this.prisma.withTenant(tenantId, async (tx) => {
      const current = await tx.purchaseOrder.findFirst({ where: { id, tenantId } });
      if (!current) throw AppException.notFound();
      if (current.version !== input.version) throw versionConflict();
      if (current.status !== 'DRAFT')
        throw invalidState('Only draft purchase orders can be edited.');

      throwIfIssues(
        await this.validate(tx, tenantId, {
          supplierId: input.supplierId ?? current.supplierId,
          branchId: input.branchId ?? current.branchId,
          lines: input.lines ?? [],
        }),
      );
      const { count } = await tx.purchaseOrder.updateMany({
        where: { id, tenantId, version: input.version },
        data: {
          ...(input.supplierId ? { supplierId: input.supplierId } : {}),
          ...(input.branchId ? { branchId: input.branchId } : {}),
          ...(input.expectedDate !== undefined
            ? { expectedDate: input.expectedDate ? new Date(input.expectedDate) : null }
            : {}),
          ...(input.notes !== undefined ? { notes: input.notes } : {}),
          version: { increment: 1 },
        },
      });
      if (count === 0) throw versionConflict();
      if (input.lines) await this.replaceLines(tx, tenantId, id, input.lines);
      await this.audit.record(tx, {
        tenantId,
        action: 'purchase_order.updated',
        entityType: 'purchase_order',
        entityId: id,
        metadata: { number: current.number },
      });
      return this.load(tx, tenantId, id);
    });
  }

  /** DRAFT -> ORDERED (sent to the supplier). */
  placeOrder(tenantId: string, id: string, version: number): Promise<PurchaseOrder> {
    return this.transition(tenantId, id, version, ['DRAFT'], 'ORDERED', 'purchase_order.ordered');
  }

  /** Cancels anything not fully received; already received stock stays. */
  cancel(tenantId: string, id: string, version: number): Promise<PurchaseOrder> {
    return this.transition(
      tenantId,
      id,
      version,
      ['DRAFT', 'ORDERED', 'PARTIALLY_RECEIVED'],
      'CANCELLED',
      'purchase_order.cancelled',
    );
  }

  /**
   * Called by goods receiving inside its transaction: adds received quantities
   * to the order lines and moves the order to PARTIALLY_RECEIVED or RECEIVED.
   */
  async recordReceipt(
    tx: Tx,
    tenantId: string,
    orderId: string,
    received: Map<string, string>,
  ): Promise<void> {
    const lines = await tx.purchaseOrderLine.findMany({
      where: { tenantId, purchaseOrderId: orderId },
    });
    let complete = true;
    for (const line of lines) {
      const add = received.get(line.variantId);
      const total = toMilli(line.quantityReceived.toString()) + (add ? toMilli(add) : 0);
      if (add) {
        await tx.purchaseOrderLine.update({
          where: { id: line.id },
          data: { quantityReceived: new Prisma.Decimal(fromMilli(total)) },
        });
      }
      if (total < toMilli(line.quantityOrdered.toString())) complete = false;
    }
    await tx.purchaseOrder.update({
      where: { id: orderId },
      data: { status: complete ? 'RECEIVED' : 'PARTIALLY_RECEIVED', version: { increment: 1 } },
    });
  }

  private transition(
    tenantId: string,
    id: string,
    version: number,
    from: Array<'DRAFT' | 'ORDERED' | 'PARTIALLY_RECEIVED'>,
    to: 'ORDERED' | 'CANCELLED',
    action: 'purchase_order.ordered' | 'purchase_order.cancelled',
  ): Promise<PurchaseOrder> {
    return this.prisma.withTenant(tenantId, async (tx) => {
      const current = await tx.purchaseOrder.findFirst({ where: { id, tenantId } });
      if (!current) throw AppException.notFound();
      if (current.version !== version) throw versionConflict();
      if (!(from as string[]).includes(current.status)) {
        throw invalidState(
          `A ${current.status.toLowerCase()} purchase order cannot be ${to.toLowerCase()}.`,
        );
      }
      const { count } = await tx.purchaseOrder.updateMany({
        where: { id, tenantId, version },
        data: {
          status: to,
          version: { increment: 1 },
          ...(to === 'ORDERED' ? { orderedAt: new Date() } : {}),
        },
      });
      if (count === 0) throw versionConflict();
      await this.audit.record(tx, {
        tenantId,
        action,
        entityType: 'purchase_order',
        entityId: id,
        metadata: { number: current.number, from: current.status },
      });
      return this.load(tx, tenantId, id);
    });
  }

  private async validate(
    tx: Tx,
    tenantId: string,
    input: { supplierId: string; branchId: string; lines: CreateInput['lines'] },
  ): Promise<ValidationIssue[]> {
    const issues: ValidationIssue[] = [];
    const supplier = await tx.supplier.findFirst({ where: { id: input.supplierId, tenantId } });
    if (!supplier) issues.push({ path: 'supplierId', message: 'validation.supplier.not_found' });
    else if (supplier.status !== 'ACTIVE')
      issues.push({ path: 'supplierId', message: 'validation.supplier.archived' });
    issues.push(...(await checkBranch(tx, tenantId, input.branchId, 'branchId')).issues);
    if (input.lines.length > 0) {
      const rules = await loadCatalogRules(tx, tenantId);
      const items = await loadItems(
        tx,
        tenantId,
        input.lines.map((l) => l.variantId),
      );
      issues.push(
        ...checkLines(input.lines, items, {
          allowFraction: rules.allowFractionalQuantities,
          requireActive: true,
        }),
      );
    }
    return issues;
  }

  private async replaceLines(
    tx: Tx,
    tenantId: string,
    orderId: string,
    lines: CreateInput['lines'],
  ) {
    await tx.purchaseOrderLine.deleteMany({ where: { tenantId, purchaseOrderId: orderId } });
    await tx.purchaseOrderLine.createMany({
      data: lines.map((line, position) => ({
        tenantId,
        purchaseOrderId: orderId,
        variantId: line.variantId,
        position,
        quantityOrdered: new Prisma.Decimal(line.quantity),
        unitCostMinor: BigInt(line.unitCostMinor),
      })),
    });
  }

  private async load(tx: Tx, tenantId: string, id: string): Promise<PurchaseOrder> {
    const row = await tx.purchaseOrder.findFirst({ where: { id, tenantId }, include });
    if (!row) throw AppException.notFound();
    return (await this.toDtos(tx, tenantId, [row]))[0]!;
  }

  private async toDtos(tx: Tx, tenantId: string, rows: OrderRow[]): Promise<PurchaseOrder[]> {
    const items = await loadItems(
      tx,
      tenantId,
      rows.flatMap((row) => row.lines.map((l) => l.variantId)),
    );
    return rows.map((row) => ({
      id: row.id,
      number: row.number,
      supplierId: row.supplierId,
      supplierName: row.supplier.name,
      branchId: row.branchId,
      branchName: row.branch.name,
      status: row.status,
      expectedDate: row.expectedDate?.toISOString().slice(0, 10) ?? null,
      notes: row.notes,
      totalMinor: row.lines.reduce(
        (sum, line) => sum + lineTotalMinor(line.unitCostMinor, line.quantityOrdered.toString()),
        0,
      ),
      version: row.version,
      createdAt: row.createdAt.toISOString(),
      orderedAt: row.orderedAt?.toISOString() ?? null,
      lines: row.lines.map((line) => ({
        id: line.id,
        ...itemFields(items.get(line.variantId), line.variantId),
        quantityOrdered: line.quantityOrdered.toString(),
        quantityReceived: line.quantityReceived.toString(),
        unitCostMinor: Number(line.unitCostMinor),
      })),
    }));
  }
}
