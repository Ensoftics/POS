import { createHash } from 'node:crypto';
import { HttpStatus, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type {
  createSaleRequestSchema,
  listSalesQuerySchema,
  Receipt,
  Sale,
  SaleConflictType,
  SalePage,
  ValidationIssue,
} from '@pos/contracts';
import {
  computeCart,
  discountNeedsApproval,
  fromMilli,
  lineTotalMinor,
  localDateIn,
  refundableByMethod,
  settlePayments,
  toMilli,
  pointsEarned,
  pointsToRedeem,
} from '@pos/domain';
import type { z } from 'zod';
import { AuditService } from '../audit/audit.service';
import { throwIfIssues } from '../catalog/catalog-rules';
import { AppException } from '../common/app-exception';
import { assertBranchAllowed } from '../common/branch-access';
import { isUniqueViolation } from '../common/optimistic';
import type { AuthPrincipal } from '../common/request-context';
import { checkLines, loadItems, nextDocumentNumber } from '../inventory/inventory-helpers';
import { StockLedger } from '../inventory/stock-ledger';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService, type Tx } from '../prisma/prisma.service';
import { CustomerLedger, creditLimitExceeded } from '../customers/customer-ledger';
import { insufficientPoints, LoyaltyLedger } from '../customers/loyalty-ledger';
import { ApprovalsService } from './approvals.service';
import { canActOnShift, shiftNotOpen } from './shifts.service';

type CreateInput = z.output<typeof createSaleRequestSchema>;
type ListQuery = z.output<typeof listSalesQuerySchema>;

/** Offline sales older than this are refused: a till should not hold sales for weeks. */
const OFFLINE_MAX_AGE_MS = 30 * 24 * 60 * 60_000;

const include = {
  branch: { select: { name: true } },
  register: { select: { name: true } },
  shift: { select: { number: true } },
  cashier: { select: { fullName: true } },
  lines: { orderBy: { position: 'asc' as const } },
  payments: { orderBy: { position: 'asc' as const } },
  approvedBy: { select: { fullName: true } },
  customer: { select: { name: true } },
  returns: {
    orderBy: { createdAt: 'asc' as const },
    include: { lines: true, refunds: true },
  },
  conflicts: { orderBy: { createdAt: 'asc' as const } },
} satisfies Prisma.SaleInclude;
type SaleRow = Prisma.SaleGetPayload<{ include: typeof include }>;

const discountOf = (kind: 'PERCENT' | 'AMOUNT' | null, value: bigint | null) =>
  kind && value !== null ? { kind, value: Number(value) } : null;

export function toSale(row: SaleRow): Sale {
  // Returned so far per sale line, summed exactly in milli-units / minor units.
  const returned = new Map<string, { milli: number; refund: number; tax: number }>();
  for (const ret of row.returns)
    for (const line of ret.lines) {
      const current = returned.get(line.saleLineId) ?? { milli: 0, refund: 0, tax: 0 };
      returned.set(line.saleLineId, {
        milli: current.milli + toMilli(line.quantity.toString()),
        refund: current.refund + Number(line.refundMinor),
        tax: current.tax + Number(line.taxMinor),
      });
    }
  const soldMilli = row.lines.reduce((sum, l) => sum + toMilli(l.quantity.toString()), 0);
  const returnedMilli = [...returned.values()].reduce((sum, r) => sum + r.milli, 0);
  const refundedMinor = row.returns.reduce((sum, r) => sum + Number(r.refundMinor), 0);
  const refundable = refundableByMethod(
    row.payments.map((p) => ({ method: p.method, amountMinor: Number(p.amountMinor) })),
    Number(row.changeMinor),
    row.returns.flatMap((r) =>
      r.refunds.map((f) => ({ method: f.method, amountMinor: Number(f.amountMinor) })),
    ),
  );
  const taxGroups = new Map<string, Sale['taxSummary'][number]>();
  for (const line of row.lines) {
    const tax = Number(line.taxMinor);
    const total = Number(line.totalMinor);
    const key = `${line.taxName ?? ''}|${line.taxRateBp}`;
    const group = taxGroups.get(key) ?? {
      name: line.taxName,
      rateBp: line.taxRateBp,
      taxableMinor: 0,
      taxMinor: 0,
    };
    // Line totals include tax either way (inclusive: in the price; exclusive: added).
    group.taxableMinor += total - tax;
    group.taxMinor += tax;
    taxGroups.set(key, group);
  }
  return {
    id: row.id,
    number: row.number,
    status: row.status,
    branchId: row.branchId,
    branchName: row.branch.name,
    registerId: row.registerId,
    registerName: row.register.name,
    shiftId: row.shiftId,
    shiftNumber: row.shift.number,
    cashierName: row.cashier?.fullName ?? null,
    customerId: row.customerId,
    customerName: row.customer?.name ?? null,
    currency: row.currency,
    pricesIncludeTax: row.pricesIncludeTax,
    discount: discountOf(row.discountKind, row.discountValue),
    subtotalMinor: Number(row.subtotalMinor),
    discountMinor: Number(row.discountMinor),
    taxMinor: Number(row.taxMinor),
    totalMinor: Number(row.totalMinor),
    paidMinor: Number(row.paidMinor),
    changeMinor: Number(row.changeMinor),
    pointsEarned: row.pointsEarned,
    pointsRedeemed: row.pointsRedeemed,
    notes: row.notes,
    createdAt: row.createdAt.toISOString(),
    lines: row.lines.map((line) => ({
      id: line.id,
      variantId: line.variantId,
      productName: line.productName,
      sku: line.sku,
      variantLabel: line.variantLabel,
      unit: line.unit,
      quantity: line.quantity.toString(),
      unitPriceMinor: Number(line.unitPriceMinor),
      grossMinor: lineTotalMinor(line.unitPriceMinor, line.quantity.toString()),
      discount: discountOf(line.discountKind, line.discountValue),
      lineDiscountMinor: Number(line.lineDiscountMinor),
      cartDiscountMinor: Number(line.cartDiscountMinor),
      taxName: line.taxName,
      taxRateBp: line.taxRateBp,
      taxMinor: Number(line.taxMinor),
      totalMinor: Number(line.totalMinor),
      returnedQuantity: fromMilli(returned.get(line.id)?.milli ?? 0),
      refundedMinor: returned.get(line.id)?.refund ?? 0,
      refundedTaxMinor: returned.get(line.id)?.tax ?? 0,
    })),
    payments: row.payments.map((payment) => ({
      method: payment.method,
      amountMinor: Number(payment.amountMinor),
      reference: payment.reference,
    })),
    taxSummary: [...taxGroups.values()].filter((group) => group.rateBp > 0),
    approvedByName: row.approvedBy?.fullName ?? null,
    returnStatus: returnedMilli === 0 ? 'NONE' : returnedMilli >= soldMilli ? 'FULL' : 'PARTIAL',
    capturedOffline: row.capturedOffline,
    syncedAt: row.syncedAt?.toISOString() ?? null,
    conflicts: row.conflicts.map((c) => ({
      id: c.id,
      type: c.type,
      resolved: c.resolvedAt !== null,
    })),
    voided: row.returns.some((r) => r.kind === 'VOID'),
    refundedMinor,
    refundable: [...refundable.entries()].map(([method, amountMinor]) => ({ method, amountMinor })),
    returns: row.returns.map((r) => ({
      id: r.id,
      number: r.number,
      kind: r.kind,
      refundMinor: Number(r.refundMinor),
      createdAt: r.createdAt.toISOString(),
    })),
  };
}

/**
 * Request fingerprint: tells a retry of the same sale from a different sale reusing
 * the id. The approval and offline details are left out: a retry may carry a fresh
 * PIN entry, and a sale first sent online may be re-sent from the offline outbox.
 */
const fingerprint = (input: CreateInput) => {
  const { approval: _approval, offline: _offline, ...sale } = input;
  return createHash('sha256').update(JSON.stringify(sale)).digest('hex');
};

@Injectable()
export class SalesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly ledger: StockLedger,
    private readonly approvals: ApprovalsService,
    private readonly customerLedger: CustomerLedger,
    private readonly loyalty: LoyaltyLedger,
    private readonly notifications: NotificationsService,
  ) {}

  /**
   * Completes a sale atomically: prices from the server's catalogue, tax from the
   * tenant's rates, payments checked, stock taken through the ledger. Idempotent
   * on the client-generated id. Returns [sale, created].
   */
  async create(
    tenantId: string,
    input: CreateInput,
    principal: AuthPrincipal,
  ): Promise<[Sale, boolean]> {
    const hash = fingerprint(input);
    const approverId = await this.approvals.verify(tenantId, input.approval);
    try {
      return await this.prisma.withTenant(
        tenantId,
        (tx) => this.createIn(tx, tenantId, input, hash, principal, approverId),
        {
          timeout: 30_000,
        },
      );
    } catch (error) {
      // Two simultaneous submissions of the same sale: the primary key let one win.
      if (isUniqueViolation(error))
        return this.prisma.withTenant(tenantId, async (tx) => {
          const existing = await this.existing(tx, tenantId, input.id, hash);
          if (!existing) throw error;
          return [existing, false];
        });
      throw error;
    }
  }

  private async existing(tx: Tx, tenantId: string, id: string, hash: string) {
    const row = await tx.sale.findFirst({ where: { id, tenantId }, include });
    if (!row) return null;
    if (row.requestHash !== hash) {
      throw new AppException(
        'IDEMPOTENCY_CONFLICT',
        HttpStatus.CONFLICT,
        'A different sale was already recorded with this id.',
      );
    }
    return toSale(row);
  }

  private async createIn(
    tx: Tx,
    tenantId: string,
    input: CreateInput,
    hash: string,
    principal: AuthPrincipal,
    verifiedApproverId: string | null,
  ): Promise<[Sale, boolean]> {
    const replay = await this.existing(tx, tenantId, input.id, hash);
    if (replay) return [replay, false];

    // FOR SHARE: many sales may run at once, but closing the shift waits for them.
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
      WHERE tenant_id = ${tenantId}::uuid AND id = ${input.shiftId}::uuid FOR SHARE`;
    const shift = shifts[0];
    if (!shift)
      throw AppException.validation([{ path: 'shiftId', message: 'validation.shift.not_found' }]);
    if (!canActOnShift(principal, shift.opened_by_id, shift.branch_id))
      throw AppException.forbidden('This shift belongs to another cashier.');

    // An offline sale already happened: record it as it was and flag what differs,
    // instead of refusing it. Online sales keep the strict rules.
    const offline = input.offline ?? null;
    const conflicts: Array<{ type: SaleConflictType; detail: Record<string, unknown> }> = [];
    let capturedAt: Date | null = null;
    if (offline) {
      capturedAt = new Date(offline.capturedAt);
      const now = Date.now();
      if (
        capturedAt.getTime() > now + 5 * 60_000 ||
        capturedAt.getTime() < now - OFFLINE_MAX_AGE_MS
      )
        throw AppException.validation([
          { path: 'offline.capturedAt', message: 'validation.offline.captured_at' },
        ]);
    }
    if (shift.status !== 'OPEN') {
      if (!offline) throw shiftNotOpen();
      conflicts.push({ type: 'SHIFT_CLOSED', detail: {} });
    }

    const discounted = !!input.discount?.value || input.lines.some((l) => !!l.discount?.value);
    if (discounted && !principal.permissions.includes('sales.discount')) {
      if (!offline) throw AppException.forbidden('You may not give discounts.');
      conflicts.push({ type: 'APPROVAL_MISSING', detail: { reason: 'no_discount_permission' } });
    }

    const branch = await tx.branch.findFirstOrThrow({ where: { id: shift.branch_id, tenantId } });
    if (branch.status !== 'ACTIVE' && !offline)
      throw new AppException('BRANCH_ARCHIVED', HttpStatus.CONFLICT, 'This branch is archived.');

    const settings = await tx.tenantSettings.findUniqueOrThrow({ where: { tenantId } });
    const onAccount = input.payments
      .filter((p) => p.method === 'ACCOUNT')
      .reduce((sum, p) => sum + p.amountMinor, 0);
    if (onAccount > 0 && !input.customerId)
      throw AppException.validation([
        { path: 'payments', message: 'validation.payment.account_needs_customer' },
      ]);
    if (input.customerId) {
      const customer = await tx.customer.findFirst({
        where: { id: input.customerId, tenantId },
        select: { status: true },
      });
      if (!customer)
        throw AppException.validation([
          { path: 'customerId', message: 'validation.customer.not_found' },
        ]);
      if (customer.status !== 'ACTIVE' && !offline)
        throw AppException.validation([
          { path: 'customerId', message: 'validation.customer.archived' },
        ]);
    }
    const items = await loadItems(
      tx,
      tenantId,
      input.lines.map((l) => l.variantId),
    );
    throwIfIssues(
      checkLines(input.lines, items, {
        allowFraction: settings.allowFractionalQuantities,
        requireActive: !offline,
      }),
    );
    const archived = input.lines.filter((l) => !items.get(l.variantId)!.active);
    if (archived.length > 0)
      conflicts.push({
        type: 'ITEM_ARCHIVED',
        detail: { skus: [...new Set(archived.map((l) => items.get(l.variantId)!.sku))] },
      });

    // Prices and tax always come from the server, never from the till.
    const variants = await tx.productVariant.findMany({
      where: { tenantId, id: { in: [...items.keys()] } },
      select: { id: true, priceMinor: true, product: { select: { taxRateId: true } } },
    });
    const variantById = new Map(variants.map((v) => [v.id, v]));
    const rates = await tx.taxRate.findMany({ where: { tenantId } });
    const defaultRate = rates.find((r) => r.isDefault && r.status === 'ACTIVE') ?? null;
    const lineRates = input.lines.map((line) => {
      const ownRate = variantById.get(line.variantId)!.product.taxRateId;
      return ownRate ? rates.find((r) => r.id === ownRate)! : defaultRate;
    });

    // Online: the server's prices. Offline: the prices the customer was charged.
    const pricesIncludeTax = offline ? offline.pricesIncludeTax : settings.pricesIncludeTax;
    const charged = input.lines.map((line, index) => ({
      unitPriceMinor: offline
        ? offline.lines[index]!.unitPriceMinor
        : Number(variantById.get(line.variantId)!.priceMinor),
      taxRateBp: offline ? offline.lines[index]!.taxRateBp : (lineRates[index]?.rateBp ?? 0),
    }));
    if (offline) {
      const changed = input.lines
        .map((line, index) => ({
          sku: items.get(line.variantId)!.sku,
          chargedMinor: charged[index]!.unitPriceMinor,
          currentMinor: Number(variantById.get(line.variantId)!.priceMinor),
          chargedTaxBp: charged[index]!.taxRateBp,
          currentTaxBp: lineRates[index]?.rateBp ?? 0,
        }))
        .filter((c) => c.chargedMinor !== c.currentMinor || c.chargedTaxBp !== c.currentTaxBp);
      if (changed.length > 0 || pricesIncludeTax !== settings.pricesIncludeTax)
        conflicts.push({
          type: 'PRICE_CHANGED',
          detail: {
            lines: changed,
            ...(pricesIncludeTax !== settings.pricesIncludeTax ? { pricesIncludeTax } : {}),
          },
        });
    }
    const totals = computeCart({
      pricesIncludeTax,
      discount: input.discount ?? null,
      lines: input.lines.map((line, index) => ({
        unitPriceMinor: charged[index]!.unitPriceMinor,
        quantity: line.quantity,
        discount: line.discount ?? null,
        taxRateBp: charged[index]!.taxRateBp,
      })),
    });
    throwIfIssues(
      totals.issues.map((issue): ValidationIssue =>
        issue.line === null
          ? { path: 'discount', message: 'validation.discount.exceeds_total' }
          : { path: `lines.${issue.line}.discount`, message: 'validation.discount.exceeds_line' },
      ),
    );
    const needsApproval = discountNeedsApproval(
      totals.subtotalMinor,
      totals.discountMinor,
      settings.discountApprovalBp,
    );
    let approvedById: string | null;
    try {
      approvedById = this.approvals.resolve(
        principal,
        needsApproval,
        verifiedApproverId,
        'DISCOUNT',
      );
    } catch (error) {
      // No manager could approve on a disconnected till; a manager reviews it instead.
      if (!offline) throw error;
      approvedById = null;
      conflicts.push({
        type: 'APPROVAL_MISSING',
        detail: { discountMinor: totals.discountMinor, subtotalMinor: totals.subtotalMinor },
      });
    }
    // Online, a different total means prices changed under the cashier. Offline, the
    // till priced the sale itself, so a different total means its arithmetic is wrong.
    if (totals.totalMinor !== input.expectedTotalMinor) {
      throw new AppException(
        'TOTAL_MISMATCH',
        HttpStatus.CONFLICT,
        'Prices or taxes changed since the cart was priced. Refresh the cart and try again.',
      );
    }
    const settlement = settlePayments(totals.totalMinor, input.payments);
    if (!settlement.ok)
      throw AppException.validation([
        { path: 'payments', message: `validation.payment.${settlement.issue}` },
      ]);

    // Loyalty: points pay for part of the sale (online only) and are earned on the rest.
    const loyaltyRules = input.customerId ? await this.loyalty.rules(tx, tenantId) : null;
    const redeemMinor = input.payments
      .filter((p) => p.method === 'LOYALTY')
      .reduce((sum, p) => sum + p.amountMinor, 0);
    let pointsRedeemed = 0;
    if (redeemMinor > 0) {
      const issue = (code: string) =>
        AppException.validation([{ path: 'payments', message: `validation.payment.${code}` }]);
      // A till without a connection cannot know the customer's balance.
      if (offline) throw issue('loyalty_offline');
      if (!input.customerId) throw issue('loyalty_needs_customer');
      if (!loyaltyRules) throw issue('loyalty_off');
      const check = pointsToRedeem(
        redeemMinor,
        loyaltyRules,
        await this.loyalty.balance(tx, tenantId, input.customerId),
      );
      if (!check.ok) {
        if (check.issue === 'insufficient_points') throw insufficientPoints();
        throw issue(`loyalty_${check.issue}`);
      }
      pointsRedeemed = check.points;
    }
    const pointsEarnedOnSale =
      loyaltyRules && input.customerId
        ? pointsEarned(totals.totalMinor - redeemMinor, loyaltyRules.spendPerPointMinor)
        : 0;

    const number = await nextDocumentNumber(tx, tenantId, 'sale');
    if (offline && !settings.allowNegativeStock) {
      // The goods have left the shop, so stock is taken regardless; a shortfall is flagged.
      const short: Array<{ sku: string; soldQuantity: string; availableQuantity: string }> = [];
      const needed = new Map<string, number>();
      for (const line of input.lines)
        needed.set(line.variantId, (needed.get(line.variantId) ?? 0) + toMilli(line.quantity));
      for (const [variantId, milli] of needed) {
        const balances = await this.ledger.balances(tx, tenantId, shift.branch_id, variantId);
        const available = balances.reduce((sum, b) => sum + Math.max(0, toMilli(b.quantity)), 0);
        if (available < milli)
          short.push({
            sku: items.get(variantId)!.sku,
            soldQuantity: fromMilli(milli),
            availableQuantity: fromMilli(available),
          });
      }
      if (short.length > 0) conflicts.push({ type: 'STOCK_SHORT', detail: { lines: short } });
    }
    // Expiry is judged on the business's calendar on the day of the sale.
    const today = localDateIn(capturedAt ?? new Date(), settings.timezone);
    const expiredSold: Array<{ variantId: string; batchId: string; quantity: string }> = [];
    for (const line of input.lines) {
      const item = items.get(line.variantId)!;
      const taken = await this.ledger.takeOutForSale(
        tx,
        {
          tenantId,
          branchId: shift.branch_id,
          variantId: line.variantId,
          quantity: line.quantity,
          type: 'SALE',
          referenceType: 'sale',
          referenceId: input.id,
          referenceNumber: number,
        },
        `${item.productName} (${item.sku})`,
        {
          today,
          allowNegative: settings.allowNegativeStock || !!offline,
          allowExpired: !!offline,
        },
      );
      for (const part of taken.expired)
        expiredSold.push({
          variantId: line.variantId,
          batchId: part.batchId!,
          quantity: part.quantity,
        });
    }
    if (expiredSold.length > 0) {
      const batches = await tx.stockBatch.findMany({
        where: { tenantId, id: { in: expiredSold.map((part) => part.batchId) } },
        select: { id: true, batchNumber: true, expiryDate: true },
      });
      const byId = new Map(batches.map((batch) => [batch.id, batch]));
      conflicts.push({
        type: 'EXPIRED_SOLD',
        detail: {
          lines: expiredSold.map((part) => ({
            sku: items.get(part.variantId)!.sku,
            batchNumber: byId.get(part.batchId)?.batchNumber ?? null,
            expiryDate: byId.get(part.batchId)?.expiryDate?.toISOString().slice(0, 10) ?? null,
            quantity: part.quantity,
          })),
        },
      });
    }

    await tx.sale.create({
      data: {
        id: input.id,
        tenantId,
        number,
        branchId: shift.branch_id,
        registerId: shift.register_id,
        shiftId: shift.id,
        cashierId: principal.userId,
        currency: settings.currency,
        pricesIncludeTax,
        discountKind: input.discount?.kind ?? null,
        discountValue: input.discount ? BigInt(input.discount.value) : null,
        subtotalMinor: BigInt(totals.subtotalMinor),
        discountMinor: BigInt(totals.discountMinor),
        taxMinor: BigInt(totals.taxMinor),
        totalMinor: BigInt(totals.totalMinor),
        paidMinor: BigInt(settlement.paidMinor),
        changeMinor: BigInt(settlement.changeMinor),
        notes: input.notes ?? null,
        requestHash: hash,
        approvedById,
        customerId: input.customerId ?? null,
        pointsEarned: pointsEarnedOnSale,
        pointsRedeemed,
        pointsRedeemedMinor: BigInt(redeemMinor),
        ...(offline ? { capturedOffline: true, createdAt: capturedAt!, syncedAt: new Date() } : {}),
      },
    });
    await tx.saleLine.createMany({
      data: input.lines.map((line, position) => {
        const item = items.get(line.variantId)!;
        const computed = totals.lines[position]!;
        const rate = lineRates[position];
        return {
          tenantId,
          saleId: input.id,
          // Report columns; the database trigger copies the sale's exact values.
          createdAt: capturedAt ?? new Date(),
          branchId: shift.branch_id,
          position,
          variantId: line.variantId,
          productName: item.productName,
          sku: item.sku,
          variantLabel: item.variantLabel,
          unit: item.unit,
          quantity: new Prisma.Decimal(line.quantity),
          unitPriceMinor: BigInt(charged[position]!.unitPriceMinor),
          discountKind: line.discount?.kind ?? null,
          discountValue: line.discount ? BigInt(line.discount.value) : null,
          lineDiscountMinor: BigInt(computed.lineDiscountMinor),
          cartDiscountMinor: BigInt(computed.cartDiscountMinor),
          // The rate's name is shown only when it matches the rate actually charged.
          taxRateId: rate && rate.rateBp === charged[position]!.taxRateBp ? rate.id : null,
          taxName: rate && rate.rateBp === charged[position]!.taxRateBp ? rate.name : null,
          taxRateBp: charged[position]!.taxRateBp,
          taxMinor: BigInt(computed.taxMinor),
          totalMinor: BigInt(computed.totalMinor),
        };
      }),
    });
    if (input.payments.length > 0) {
      await tx.salePayment.createMany({
        data: input.payments.map((payment, position) => ({
          tenantId,
          saleId: input.id,
          position,
          method: payment.method,
          amountMinor: BigInt(payment.amountMinor),
          reference: payment.reference ?? null,
        })),
      });
    }
    if (onAccount > 0) {
      // Online the credit limit is enforced on the latest balance; an offline sale has
      // already happened, so it is charged and flagged if it went over the limit.
      try {
        await this.customerLedger.post(tx, {
          tenantId,
          customerId: input.customerId!,
          type: 'CHARGE',
          amountMinor: onAccount,
          referenceType: 'sale',
          referenceId: input.id,
          referenceNumber: number,
          enforceLimit: !offline,
        });
      } catch (error) {
        if (error instanceof AppException && error.code === 'CREDIT_LIMIT_EXCEEDED')
          throw creditLimitExceeded();
        throw error;
      }
      if (offline && (await this.customerLedger.isOverLimit(tx, tenantId, input.customerId!)))
        conflicts.push({ type: 'CREDIT_LIMIT_EXCEEDED', detail: { onAccountMinor: onAccount } });
    }
    const loyaltyRef = {
      tenantId,
      customerId: input.customerId!,
      saleId: input.id,
      referenceType: 'sale',
      referenceId: input.id,
      referenceNumber: number,
      createdById: principal.userId,
    };
    // Spending is checked against the latest balance, so two tills cannot spend the same points.
    if (pointsRedeemed > 0)
      await this.loyalty.post(tx, {
        ...loyaltyRef,
        type: 'REDEEM',
        points: -pointsRedeemed,
        requireBalance: true,
      });
    if (pointsEarnedOnSale > 0)
      await this.loyalty.post(tx, {
        ...loyaltyRef,
        type: 'EARN',
        points: pointsEarnedOnSale,
        requireBalance: false,
      });
    await this.audit.record(tx, {
      tenantId,
      action: 'sale.completed',
      entityType: 'sale',
      entityId: input.id,
      metadata: {
        number,
        totalMinor: totals.totalMinor,
        discountMinor: totals.discountMinor,
        lines: input.lines.length,
        methods: [...new Set(input.payments.map((p) => p.method))],
        approvedById,
        ...(offline ? { offline: true, conflicts: conflicts.map((c) => c.type) } : {}),
      },
    });
    // One conflict per type (APPROVAL_MISSING can be raised for two reasons).
    const byType = new Map(conflicts.map((c) => [c.type, c]));
    if (byType.size > 0) {
      await tx.saleConflict.createMany({
        data: [...byType.values()].map((c) => ({
          tenantId,
          saleId: input.id,
          type: c.type,
          detail: c.detail as Prisma.InputJsonValue,
        })),
      });
      const reviewers = await this.notifications.recipients(
        tx,
        tenantId,
        'shifts.manage',
        shift.branch_id,
      );
      await this.notifications.notify(
        tx,
        reviewers.map((r) => ({
          tenantId,
          userId: r.userId,
          kind: 'SALE_CONFLICT' as const,
          dedupeKey: `conflict:${input.id}`,
          data: { saleId: input.id, saleNumber: number, conflicts: [...byType.keys()] },
          link: '/sales/review',
        })),
      );
    }
    const row = await tx.sale.findFirstOrThrow({ where: { id: input.id, tenantId }, include });
    return [toSale(row), true];
  }

  list(tenantId: string, query: ListQuery, principal: AuthPrincipal): Promise<SalePage> {
    return this.prisma.withTenant(tenantId, async (tx) => {
      const settings = await tx.tenantSettings.findUniqueOrThrow({
        where: { tenantId },
        select: { timezone: true },
      });
      const range = await this.dayRange(tx, settings.timezone, query.from, query.to);
      if (query.branchId) assertBranchAllowed(principal, query.branchId);
      const rows = await tx.sale.findMany({
        where: {
          tenantId,
          ...(query.branchId ? { branchId: query.branchId } : {}),
          // Staff limited to some branches only see those branches' sales.
          ...(!query.branchId && principal.branchIds
            ? { branchId: { in: [...principal.branchIds] } }
            : {}),
          ...(query.shiftId ? { shiftId: query.shiftId } : {}),
          ...(query.customerId ? { customerId: query.customerId } : {}),
          ...(query.q ? { number: { startsWith: query.q.toUpperCase() } } : {}),
          ...(range ? { createdAt: range } : {}),
          // Cashiers see the sales of their own shifts; managers see all.
          // Cashiers see their own shifts' sales, or a customer's purchase history.
          ...(principal.permissions.includes('shifts.manage') ||
          (query.customerId && principal.permissions.includes('customers.read'))
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
        items: page.map(toSale),
        nextCursor: rows.length > query.limit ? (page.at(-1)?.id ?? null) : null,
      };
    });
  }

  get(tenantId: string, id: string, principal: AuthPrincipal): Promise<Sale> {
    return this.prisma.withTenant(tenantId, async (tx) =>
      toSale(await this.load(tx, tenantId, id, principal)),
    );
  }

  receipt(tenantId: string, id: string, principal: AuthPrincipal): Promise<Receipt> {
    return this.prisma.withTenant(tenantId, async (tx) => {
      const row = await this.load(tx, tenantId, id, principal);
      const tenant = await tx.tenant.findUniqueOrThrow({ where: { id: tenantId } });
      const settings = await tx.tenantSettings.findUniqueOrThrow({ where: { tenantId } });
      const branch = await tx.branch.findFirstOrThrow({ where: { id: row.branchId, tenantId } });
      const cityLine = [settings.city, settings.postalCode].filter(Boolean).join(' ');
      return {
        business: {
          name: tenant.name,
          legalName: settings.legalName,
          taxRegistrationNumber: settings.taxRegistrationNumber,
          addressLines: [settings.addressLine1, settings.addressLine2, cityLine].filter(
            (line): line is string => !!line,
          ),
          branchName: branch.name,
          branchAddress: [branch.addressLine1, branch.city].filter(Boolean).join(', ') || null,
          branchPhone: branch.phone,
          footer: settings.receiptFooter,
          timezone: settings.timezone,
        },
        sale: toSale(row),
        // Shown on the receipt when the customer collects points.
        loyaltyBalance:
          row.customerId && (await this.loyalty.rules(tx, tenantId))
            ? await this.loyalty.balance(tx, tenantId, row.customerId)
            : null,
      };
    });
  }

  /** Finds a sale by its receipt number for a return, whichever shift it belongs to. */
  lookup(tenantId: string, number: string): Promise<Sale> {
    return this.prisma.withTenant(tenantId, async (tx) => {
      const row = await tx.sale.findFirst({
        where: { tenantId, number: number.trim().toUpperCase() },
        include,
      });
      if (!row) throw AppException.notFound('No sale has this receipt number.');
      return toSale(row);
    });
  }

  private async load(tx: Tx, tenantId: string, id: string, principal: AuthPrincipal) {
    const row = await tx.sale.findFirst({
      where: { id, tenantId },
      include: { ...include, shift: { select: { number: true, openedById: true } } },
    });
    if (!row || !canActOnShift(principal, row.shift.openedById, row.branchId))
      throw AppException.notFound();
    return row;
  }

  /** Converts business days in the tenant's timezone to an instant range. */
  private async dayRange(tx: Tx, timezone: string, from?: string, to?: string) {
    if (!from && !to) return null;
    const rows = await tx.$queryRaw<Array<{ start: Date | null; end: Date | null }>>`
      SELECT (${from ?? null}::date::timestamp AT TIME ZONE ${timezone}) AS start,
             ((${to ?? null}::date + 1)::timestamp AT TIME ZONE ${timezone}) AS "end"`;
    const { start, end } = rows[0]!;
    return { ...(start ? { gte: start } : {}), ...(end ? { lt: end } : {}) };
  }
}
