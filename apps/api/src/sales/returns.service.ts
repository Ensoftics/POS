import { createHash } from 'node:crypto';
import { HttpStatus, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type {
  createReturnRequestSchema,
  listReturnsQuerySchema,
  SaleReturn,
  SaleReturnPage,
  ValidationIssue,
  voidSaleRequestSchema,
} from '@pos/contracts';
import {
  checkRefunds,
  fromMilli,
  lineRefund,
  parseQuantity,
  type PaymentMethod,
  refundableByMethod,
  toMilli,
  cumulativePointShare,
} from '@pos/domain';
import type { z } from 'zod';
import { AuditService } from '../audit/audit.service';
import { throwIfIssues } from '../catalog/catalog-rules';
import { AppException } from '../common/app-exception';
import { isUniqueViolation } from '../common/optimistic';
import type { AuthPrincipal } from '../common/request-context';
import { invalidState, nextDocumentNumber } from '../inventory/inventory-helpers';
import { StockLedger } from '../inventory/stock-ledger';
import { PrismaService, type Tx } from '../prisma/prisma.service';
import { CustomerLedger } from '../customers/customer-ledger';
import { LoyaltyLedger } from '../customers/loyalty-ledger';
import { ApprovalsService } from './approvals.service';
import { canActOnShift, shiftNotOpen } from './shifts.service';

type ReturnInput = z.output<typeof createReturnRequestSchema>;
type VoidInput = z.output<typeof voidSaleRequestSchema>;
type ListQuery = z.output<typeof listReturnsQuerySchema>;

const include = {
  sale: { select: { number: true, shift: { select: { openedById: true } } } },
  shift: { select: { number: true, openedById: true } },
  branch: { select: { name: true } },
  register: { select: { name: true } },
  cashier: { select: { fullName: true } },
  approvedBy: { select: { fullName: true } },
  lines: { orderBy: { position: 'asc' as const }, include: { saleLine: true } },
  refunds: { orderBy: { position: 'asc' as const } },
} satisfies Prisma.SaleReturnInclude;
type ReturnRow = Prisma.SaleReturnGetPayload<{ include: typeof include }>;

function toReturn(row: ReturnRow): SaleReturn {
  return {
    id: row.id,
    number: row.number,
    kind: row.kind,
    saleId: row.saleId,
    saleNumber: row.sale.number,
    shiftId: row.shiftId,
    shiftNumber: row.shift.number,
    branchName: row.branch.name,
    registerName: row.register.name,
    cashierName: row.cashier?.fullName ?? null,
    approvedByName: row.approvedBy?.fullName ?? null,
    reason: row.reason,
    refundMinor: Number(row.refundMinor),
    taxMinor: Number(row.taxMinor),
    createdAt: row.createdAt.toISOString(),
    lines: row.lines.map((line) => ({
      saleLineId: line.saleLineId,
      variantId: line.saleLine.variantId,
      productName: line.saleLine.productName,
      sku: line.saleLine.sku,
      variantLabel: line.saleLine.variantLabel,
      unit: line.saleLine.unit,
      quantity: line.quantity.toString(),
      restock: line.restock,
      refundMinor: Number(line.refundMinor),
      taxMinor: Number(line.taxMinor),
    })),
    refunds: row.refunds.map((r) => ({
      method: r.method,
      amountMinor: Number(r.amountMinor),
      reference: r.reference,
    })),
  };
}

interface Plan {
  kind: 'RETURN' | 'VOID';
  id: string;
  shiftId: string;
  reason: string;
  lines: Array<{ saleLineId: string; quantity: string; restock: boolean }>;
  refunds: Array<{ method: PaymentMethod; amountMinor: number; reference: string | null }>;
}

const fingerprint = (saleId: string, value: object) =>
  createHash('sha256')
    .update(JSON.stringify([saleId, value]))
    .digest('hex');

/**
 * Returns and voids. Both are new, immutable records linked to the sale; the sale
 * itself is never edited. Refunds are pro-rated from what was paid, go back by the
 * original payment methods, and restocked items return to the batches they came
 * from through the stock ledger.
 */
@Injectable()
export class ReturnsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly ledger: StockLedger,
    private readonly approvals: ApprovalsService,
    private readonly customerLedger: CustomerLedger,
    private readonly loyalty: LoyaltyLedger,
  ) {}

  /**
   * Points follow the money back: a refunded points payment returns those points,
   * and points earned on the sale are taken back in proportion to the refund. Both
   * use cumulative shares, so partial returns add up exactly to the original
   * points. Reversal may take the balance below zero if the points were spent.
   */
  private async settleLoyalty(
    tx: Tx,
    tenantId: string,
    sale: SaleForReturn,
    returnId: string,
    returnNumber: string,
    refundMinor: number,
    refunds: Array<{ method: PaymentMethod; amountMinor: number }>,
    userId: string,
  ): Promise<void> {
    if (!sale.customerId || (sale.pointsEarned === 0 && sale.pointsRedeemed === 0)) return;
    const refundedBefore = sale.returns.reduce((sum, r) => sum + Number(r.refundMinor), 0);
    const pointsPaidBack = (list: Array<{ method: PaymentMethod; amountMinor: number | bigint }>) =>
      list.filter((r) => r.method === 'LOYALTY').reduce((sum, r) => sum + Number(r.amountMinor), 0);
    const loyaltyRefundedBefore = pointsPaidBack(sale.returns.flatMap((r) => r.refunds));
    const moved = await this.loyalty.totalsForSale(tx, tenantId, sale.id);
    const ref = {
      tenantId,
      customerId: sale.customerId,
      saleId: sale.id,
      referenceType: 'sale_return',
      referenceId: returnId,
      referenceNumber: returnNumber,
      createdById: userId,
      requireBalance: false,
    };
    const back =
      cumulativePointShare(
        sale.pointsRedeemed,
        loyaltyRefundedBefore + pointsPaidBack(refunds),
        Number(sale.pointsRedeemedMinor),
      ) - moved.REFUND;
    if (back > 0) await this.loyalty.post(tx, { ...ref, type: 'REFUND', points: back });
    // REVERSE entries are negative, so adding them gives what is still to take back.
    const reverse =
      cumulativePointShare(
        sale.pointsEarned,
        refundedBefore + refundMinor,
        Number(sale.totalMinor),
      ) + moved.REVERSE;
    if (reverse > 0) await this.loyalty.post(tx, { ...ref, type: 'REVERSE', points: -reverse });
  }

  async createReturn(
    tenantId: string,
    saleId: string,
    input: ReturnInput,
    principal: AuthPrincipal,
  ): Promise<[SaleReturn, boolean]> {
    const { approval, ...request } = input;
    const approverId = await this.approvals.verify(tenantId, approval);
    return this.run(tenantId, saleId, fingerprint(saleId, request), principal, async (tx) => ({
      kind: 'RETURN',
      id: input.id,
      shiftId: input.shiftId,
      reason: input.reason,
      lines: input.lines,
      refunds: input.refunds.map((r) => ({
        method: r.method,
        amountMinor: r.amountMinor,
        reference: r.reference ?? null,
      })),
      approverId,
      needsApproval: (await tx.tenantSettings.findUniqueOrThrow({ where: { tenantId } }))
        .refundsRequireApproval,
    }));
  }

  async voidSale(
    tenantId: string,
    saleId: string,
    input: VoidInput,
    principal: AuthPrincipal,
  ): Promise<[SaleReturn, boolean]> {
    const { approval, ...request } = input;
    const approverId = await this.approvals.verify(tenantId, approval);
    return this.run(tenantId, saleId, fingerprint(saleId, request), principal, async (tx, sale) => {
      // A void undoes the whole sale exactly: every line, every payment as paid.
      const payments = await tx.salePayment.findMany({ where: { tenantId, saleId } });
      const refundable = refundableByMethod(
        payments.map((p) => ({ method: p.method, amountMinor: Number(p.amountMinor) })),
        Number(sale.changeMinor),
        [],
      );
      return {
        kind: 'VOID',
        id: input.id,
        shiftId: sale.shiftId,
        reason: input.reason,
        lines: sale.lines.map((l) => ({
          saleLineId: l.id,
          quantity: l.quantity.toString(),
          restock: true,
        })),
        refunds: [...refundable.entries()].map(([method, amountMinor]) => ({
          method,
          amountMinor,
          reference: null,
        })),
        approverId,
        needsApproval: true,
      };
    });
  }

  list(tenantId: string, query: ListQuery, principal: AuthPrincipal): Promise<SaleReturnPage> {
    return this.prisma.withTenant(tenantId, async (tx) => {
      const rows = await tx.saleReturn.findMany({
        where: {
          tenantId,
          ...(query.saleId ? { saleId: query.saleId } : {}),
          ...(query.shiftId ? { shiftId: query.shiftId } : {}),
          ...(principal.branchIds ? { branchId: { in: [...principal.branchIds] } } : {}),
          ...(principal.permissions.includes('shifts.manage')
            ? {}
            : { shift: { openedById: principal.userId } }),
        },
        include,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: query.limit + 1,
        ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
      });
      const page = rows.slice(0, query.limit);
      return {
        items: page.map(toReturn),
        nextCursor: rows.length > query.limit ? (page.at(-1)?.id ?? null) : null,
      };
    });
  }

  get(tenantId: string, id: string, principal: AuthPrincipal): Promise<SaleReturn> {
    return this.prisma.withTenant(tenantId, async (tx) => {
      const row = await tx.saleReturn.findFirst({ where: { id, tenantId }, include });
      if (!row || !canActOnShift(principal, row.shift.openedById, row.branchId))
        throw AppException.notFound();
      return toReturn(row);
    });
  }

  /* --------------------------------------------------------------------- */

  private async run(
    tenantId: string,
    saleId: string,
    hash: string,
    principal: AuthPrincipal,
    plan: (
      tx: Tx,
      sale: SaleForReturn,
    ) => Promise<Plan & { approverId: string | null; needsApproval: boolean }>,
  ): Promise<[SaleReturn, boolean]> {
    try {
      return await this.prisma.withTenant(
        tenantId,
        async (tx) => {
          // One return of a sale at a time, so two tills cannot refund the same items twice.
          // (Sales are append-only for the app role, so a row lock is not available.)
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`sale:${saleId}`}, 0))`;
          const sale = await loadSaleForReturn(tx, tenantId, saleId);
          const steps = await plan(tx, sale);
          const replay = await this.existing(tx, tenantId, steps.id, hash);
          if (replay) return [replay, false] as [SaleReturn, boolean];
          return [await this.record(tx, tenantId, sale, steps, hash, principal), true] as [
            SaleReturn,
            boolean,
          ];
        },
        { timeout: 30_000 },
      );
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      // A simultaneous retry of the same request won the primary key.
      return this.prisma.withTenant(tenantId, async (tx) => {
        const row = await tx.saleReturn.findFirst({
          where: { saleId, tenantId, requestHash: hash },
          include,
        });
        if (!row) throw error;
        return [toReturn(row), false] as [SaleReturn, boolean];
      });
    }
  }

  private async existing(tx: Tx, tenantId: string, id: string, hash: string) {
    const row = await tx.saleReturn.findFirst({ where: { id, tenantId }, include });
    if (!row) return null;
    if (row.requestHash !== hash)
      throw new AppException(
        'IDEMPOTENCY_CONFLICT',
        HttpStatus.CONFLICT,
        'A different return was already recorded with this id.',
      );
    return toReturn(row);
  }

  private async record(
    tx: Tx,
    tenantId: string,
    sale: SaleForReturn,
    plan: Plan & { approverId: string | null; needsApproval: boolean },
    hash: string,
    principal: AuthPrincipal,
  ): Promise<SaleReturn> {
    if (sale.returns.some((r) => r.kind === 'VOID')) throw invalidState('This sale was voided.');
    if (plan.kind === 'VOID') {
      if (sale.returns.length > 0)
        throw invalidState('Items of this sale were already returned. Use a return instead.');
      if (sale.shift.status !== 'OPEN')
        throw invalidState('A sale can only be voided while its shift is open. Use a return.');
    }

    // FOR SHARE: closing the shift waits for this refund, as it does for sales.
    const shifts = await tx.$queryRaw<
      Array<{
        id: string;
        status: string;
        branch_id: string;
        register_id: string;
        opened_by_id: string;
      }>
    >`
      SELECT id, status::text, branch_id, register_id, opened_by_id FROM shifts
      WHERE tenant_id = ${tenantId}::uuid AND id = ${plan.shiftId}::uuid FOR SHARE`;
    const shift = shifts[0];
    if (!shift)
      throw AppException.validation([{ path: 'shiftId', message: 'validation.shift.not_found' }]);
    if (shift.status !== 'OPEN') throw shiftNotOpen();
    if (!canActOnShift(principal, shift.opened_by_id, shift.branch_id))
      throw AppException.forbidden('This shift belongs to another cashier.');

    const settings = await tx.tenantSettings.findUniqueOrThrow({ where: { tenantId } });
    const linesById = new Map(sale.lines.map((l) => [l.id, l]));
    const earlier = new Map<string, { milli: number; refund: number; tax: number }>();
    for (const ret of sale.returns)
      for (const l of ret.lines) {
        const e = earlier.get(l.saleLineId) ?? { milli: 0, refund: 0, tax: 0 };
        earlier.set(l.saleLineId, {
          milli: e.milli + toMilli(l.quantity.toString()),
          refund: e.refund + Number(l.refundMinor),
          tax: e.tax + Number(l.taxMinor),
        });
      }

    const issues: ValidationIssue[] = [];
    const computed = plan.lines.map((line, index) => {
      const sold = linesById.get(line.saleLineId);
      if (!sold) {
        issues.push({
          path: `lines.${index}.saleLineId`,
          message: 'validation.return.line_not_found',
        });
        return null;
      }
      // Part quantities are allowed if the business allows them or the item was sold that way.
      const parsed = parseQuantity(line.quantity, {
        allowFraction:
          settings.allowFractionalQuantities || !Number.isInteger(Number(sold.quantity)),
      });
      if (!parsed.ok) {
        issues.push({
          path: `lines.${index}.quantity`,
          message: `validation.quantity.${parsed.issue}`,
        });
        return null;
      }
      const before = earlier.get(sold.id) ?? { milli: 0, refund: 0, tax: 0 };
      const result = lineRefund(
        {
          quantity: sold.quantity.toString(),
          totalMinor: Number(sold.totalMinor),
          taxMinor: Number(sold.taxMinor),
          returnedQuantity: fromMilli(before.milli),
          refundedMinor: before.refund,
          refundedTaxMinor: before.tax,
        },
        parsed.value,
      );
      if (!result.ok) {
        issues.push({
          path: `lines.${index}.quantity`,
          message: 'validation.return.exceeds_remaining',
        });
        return null;
      }
      return { ...line, quantity: parsed.value, sold, ...result };
    });
    throwIfIssues(issues);
    const lines = computed.filter((l): l is NonNullable<typeof l> => l !== null);
    const refundMinor = lines.reduce((sum, l) => sum + l.refundMinor, 0);
    const taxMinor = lines.reduce((sum, l) => sum + l.taxMinor, 0);

    const refundable = refundableByMethod(
      sale.payments.map((p) => ({ method: p.method, amountMinor: Number(p.amountMinor) })),
      Number(sale.changeMinor),
      sale.returns.flatMap((r) =>
        r.refunds.map((f) => ({ method: f.method, amountMinor: Number(f.amountMinor) })),
      ),
    );
    const refundIssue = checkRefunds(refundMinor, plan.refunds, refundable);
    if (refundIssue)
      throw AppException.validation([
        { path: 'refunds', message: `validation.refund.${refundIssue}` },
      ]);

    const approvedById = this.approvals.resolve(
      principal,
      plan.needsApproval,
      plan.approverId,
      plan.kind === 'VOID' ? 'VOID' : 'RETURN',
    );

    const number = await nextDocumentNumber(tx, tenantId, 'sale_return');
    // Restocked items go back to the batches the sale took them from.
    const restockByVariant = new Map<string, number>();
    for (const line of lines.filter((l) => l.restock))
      restockByVariant.set(
        line.sold.variantId,
        (restockByVariant.get(line.sold.variantId) ?? 0) + toMilli(line.quantity),
      );
    for (const [variantId, milli] of restockByVariant) {
      // Goods come back at the cost they left with on this sale, so profit stays exact.
      const sold = await tx.$queryRaw<Array<{ cost: bigint | null; quantity: string | null }>>`
        SELECT SUM(cost_minor)::bigint AS cost, (-SUM(quantity))::text AS quantity
        FROM stock_movements
        WHERE tenant_id = ${tenantId}::uuid AND variant_id = ${variantId}::uuid
          AND type = 'SALE' AND reference_type = 'sale' AND reference_id = ${sale.id}::uuid`;
      const soldMilli = sold[0]?.quantity ? toMilli(sold[0].quantity) : 0;
      const soldCost = sold[0]?.cost ?? null;
      for (const allocation of await this.batchesFor(tx, tenantId, sale.id, variantId, milli)) {
        const costMinor =
          soldCost === null || soldMilli === 0
            ? null
            : Number(
                (soldCost * BigInt(allocation.milli) * 2n + BigInt(soldMilli)) /
                  (BigInt(soldMilli) * 2n),
              );
        await this.ledger.post(tx, {
          costMinor,
          tenantId,
          branchId: shift.branch_id,
          variantId,
          batchId: allocation.batchId,
          quantity: fromMilli(allocation.milli),
          type: 'RETURN',
          referenceType: 'sale_return',
          referenceId: plan.id,
          referenceNumber: number,
        });
      }
    }

    await tx.saleReturn.create({
      data: {
        id: plan.id,
        tenantId,
        number,
        kind: plan.kind,
        saleId: sale.id,
        shiftId: shift.id,
        branchId: shift.branch_id,
        registerId: shift.register_id,
        cashierId: principal.userId,
        approvedById,
        reason: plan.reason,
        refundMinor: BigInt(refundMinor),
        taxMinor: BigInt(taxMinor),
        requestHash: hash,
      },
    });
    await tx.saleReturnLine.createMany({
      data: lines.map((line, position) => ({
        tenantId,
        returnId: plan.id,
        saleLineId: line.saleLineId,
        position,
        quantity: new Prisma.Decimal(line.quantity),
        restock: line.restock,
        refundMinor: BigInt(line.refundMinor),
        taxMinor: BigInt(line.taxMinor),
      })),
    });
    const refunds = plan.refunds.filter((r) => r.amountMinor > 0);
    if (refunds.length > 0)
      await tx.saleReturnRefund.createMany({
        data: refunds.map((r, position) => ({
          tenantId,
          returnId: plan.id,
          position,
          method: r.method,
          amountMinor: BigInt(r.amountMinor),
          reference: r.reference,
        })),
      });
    // Refunds to the customer's account reduce what they owe (or add store credit).
    const toAccount = refunds
      .filter((r) => r.method === 'ACCOUNT')
      .reduce((sum, r) => sum + r.amountMinor, 0);
    if (toAccount > 0) {
      if (!sale.customerId) throw invalidState('This sale has no customer account.');
      await this.customerLedger.post(tx, {
        tenantId,
        customerId: sale.customerId,
        type: 'REFUND',
        amountMinor: -toAccount,
        referenceType: 'sale_return',
        referenceId: plan.id,
        referenceNumber: number,
        enforceLimit: false,
      });
    }
    await this.settleLoyalty(
      tx,
      tenantId,
      sale,
      plan.id,
      number,
      refundMinor,
      refunds,
      principal.userId,
    );
    await this.audit.record(tx, {
      tenantId,
      action: plan.kind === 'VOID' ? 'sale.voided' : 'sale.returned',
      entityType: 'sale',
      entityId: sale.id,
      metadata: { number, saleNumber: sale.number, refundMinor, reason: plan.reason, approvedById },
    });
    const row = await tx.saleReturn.findFirstOrThrow({ where: { id: plan.id, tenantId }, include });
    return toReturn(row);
  }

  /**
   * Splits a restock over the batches the sale took stock from, net of earlier
   * restocks of this sale. Anything left (not expected) goes to unbatched stock.
   */
  private async batchesFor(
    tx: Tx,
    tenantId: string,
    saleId: string,
    variantId: string,
    milli: number,
  ): Promise<Array<{ batchId: string | null; milli: number }>> {
    const rows = await tx.$queryRaw<Array<{ batch_id: string | null; taken: string }>>`
      SELECT m.batch_id, (-SUM(m.quantity))::text AS taken
      FROM stock_movements m
      WHERE m.tenant_id = ${tenantId}::uuid AND m.variant_id = ${variantId}::uuid
        AND ((m.reference_type = 'sale' AND m.reference_id = ${saleId}::uuid)
          OR (m.reference_type = 'sale_return' AND m.reference_id IN (
                SELECT id FROM sale_returns WHERE tenant_id = ${tenantId}::uuid AND sale_id = ${saleId}::uuid)))
      GROUP BY m.batch_id
      ORDER BY m.batch_id NULLS LAST`;
    const result: Array<{ batchId: string | null; milli: number }> = [];
    let left = milli;
    for (const row of rows) {
      const available = toMilli(row.taken);
      if (left <= 0 || available <= 0) continue;
      const take = Math.min(left, available);
      result.push({ batchId: row.batch_id, milli: take });
      left -= take;
    }
    if (left > 0) result.push({ batchId: null, milli: left });
    return result;
  }
}

async function loadSaleForReturn(tx: Tx, tenantId: string, saleId: string) {
  const sale = await tx.sale.findFirst({
    where: { id: saleId, tenantId },
    include: {
      lines: { orderBy: { position: 'asc' } },
      payments: true,
      shift: { select: { status: true } },
      returns: { include: { lines: true, refunds: true } },
    },
  });
  if (!sale) throw AppException.notFound();
  return sale;
}

type SaleForReturn = Awaited<ReturnType<typeof loadSaleForReturn>>;
