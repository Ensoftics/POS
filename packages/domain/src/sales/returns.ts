import { toMilli } from '../inventory/inventory';
import { BASIS_POINTS, type PaymentMethod } from './sales';

/**
 * Returns, refunds and approval rules shared by the API and clients.
 *
 * Refunds are pro-rated from what the customer actually paid for a line (after
 * discounts, including tax) using cumulative rounding: the refund for returning
 * `q` more units is round(total × (returned + q) / sold) − refunded so far. The
 * pieces of a line returned in several visits therefore always add up to exactly
 * the line total, never a cent more or less.
 */
export interface SoldLine {
  quantity: string;
  totalMinor: number;
  taxMinor: number;
  /** Already returned on earlier returns. */
  returnedQuantity: string;
  refundedMinor: number;
  refundedTaxMinor: number;
}

export type ReturnLineIssue = 'exceeds_remaining';

export function lineRefund(
  line: SoldLine,
  quantity: string,
): { ok: true; refundMinor: number; taxMinor: number } | { ok: false; issue: ReturnLineIssue } {
  const sold = BigInt(toMilli(line.quantity));
  const before = BigInt(toMilli(line.returnedQuantity));
  const after = before + BigInt(toMilli(quantity));
  if (after > sold) return { ok: false, issue: 'exceeds_remaining' };
  const share = (amount: number) =>
    after === sold ? BigInt(amount) : (BigInt(amount) * after * 2n + sold) / (sold * 2n);
  return {
    ok: true,
    refundMinor: Number(share(line.totalMinor)) - line.refundedMinor,
    taxMinor: Number(share(line.taxMinor)) - line.refundedTaxMinor,
  };
}

/** Quantity still returnable on a line, as a decimal string in milli-units. */
export function remainingQuantity(line: Pick<SoldLine, 'quantity' | 'returnedQuantity'>): number {
  return toMilli(line.quantity) - toMilli(line.returnedQuantity);
}

export interface PaymentTotals {
  method: PaymentMethod;
  amountMinor: number;
}

/**
 * How much may still be refunded per method: what the customer paid with it
 * (cash net of change) minus earlier refunds by the same method. Refunds go back
 * the way the money came in, so a card purchase cannot be refunded in cash.
 */
export function refundableByMethod(
  payments: PaymentTotals[],
  changeMinor: number,
  refunded: PaymentTotals[],
): Map<PaymentMethod, number> {
  const result = new Map<PaymentMethod, number>();
  for (const p of payments) result.set(p.method, (result.get(p.method) ?? 0) + p.amountMinor);
  if (result.has('CASH')) result.set('CASH', result.get('CASH')! - changeMinor);
  for (const r of refunded) result.set(r.method, (result.get(r.method) ?? 0) - r.amountMinor);
  for (const [method, amount] of result) if (amount <= 0) result.delete(method);
  return result;
}

export type RefundIssue = 'mismatch' | 'method_not_refundable' | 'exceeds_method';

/** Refund tenders must add up to the refund exactly and stay within each method's limit. */
export function checkRefunds(
  refundMinor: number,
  refunds: PaymentTotals[],
  refundable: Map<PaymentMethod, number>,
): RefundIssue | null {
  const byMethod = new Map<PaymentMethod, number>();
  for (const r of refunds) byMethod.set(r.method, (byMethod.get(r.method) ?? 0) + r.amountMinor);
  for (const [method, amount] of byMethod) {
    const limit = refundable.get(method);
    if (limit === undefined) return 'method_not_refundable';
    if (amount > limit) return 'exceeds_method';
  }
  const total = refunds.reduce((sum, r) => sum + r.amountMinor, 0);
  return total === refundMinor ? null : 'mismatch';
}

/**
 * Splits a refund over the original methods, largest first, as a default the
 * cashier can change. Cash is offered first because it settles at the counter.
 */
export function suggestRefunds(
  refundMinor: number,
  refundable: Map<PaymentMethod, number>,
): PaymentTotals[] {
  const order = [...refundable.entries()].sort(([a, x], [b, y]) =>
    a === 'CASH' ? -1 : b === 'CASH' ? 1 : y - x,
  );
  const result: PaymentTotals[] = [];
  let left = refundMinor;
  for (const [method, limit] of order) {
    if (left <= 0) break;
    const amount = Math.min(limit, left);
    result.push({ method, amountMinor: amount });
    left -= amount;
  }
  return result;
}

/**
 * True when the sale's discounts exceed the tenant's limit (basis points of the
 * subtotal). A null limit means discounts never need approval.
 */
export function discountNeedsApproval(
  subtotalMinor: number,
  discountMinor: number,
  limitBp: number | null,
): boolean {
  if (limitBp === null || discountMinor === 0) return false;
  return BigInt(discountMinor) * BigInt(BASIS_POINTS) > BigInt(subtotalMinor) * BigInt(limitBp);
}

/** Drawer cash with refunds, cash movements and customer collections included. */
export function expectedDrawerCash(input: {
  openingFloatMinor: number;
  cashReceivedMinor: number;
  changeGivenMinor: number;
  cashRefundedMinor: number;
  payInMinor: number;
  payOutMinor: number;
  /** Cash collected from customers against their accounts. */
  collectionsCashMinor?: number;
}): number {
  return (
    input.openingFloatMinor +
    input.cashReceivedMinor -
    input.changeGivenMinor -
    input.cashRefundedMinor +
    input.payInMinor -
    input.payOutMinor +
    (input.collectionsCashMinor ?? 0)
  );
}

export const APPROVAL_PIN_PATTERN = /^\d{4,8}$/;
