import { lineTotalMinor } from '../inventory/inventory';

/**
 * Checkout arithmetic shared by the API (authoritative) and the clients (live
 * cart totals), so a cashier always sees the amount the server will charge.
 * Everything is integer minor units; intermediate products use BigInt and every
 * rounding step is half-up to a whole minor unit.
 *
 * Percentages (discounts, tax rates) are basis points: 10000 = 100 %, 1850 = 18.5 %.
 */
export const BASIS_POINTS = 10_000;

export const DISCOUNT_KINDS = ['PERCENT', 'AMOUNT'] as const;
export type DiscountKind = (typeof DISCOUNT_KINDS)[number];

/** PERCENT: value in basis points (0–10000). AMOUNT: value in minor units. */
export interface Discount {
  kind: DiscountKind;
  value: number;
}

/**
 * ACCOUNT: charged to the customer's account (needs a customer with credit).
 * LOYALTY: paid with the customer's points (online only).
 */
export const PAYMENT_METHODS = [
  'CASH',
  'CARD',
  'BANK_TRANSFER',
  'OTHER',
  'ACCOUNT',
  'LOYALTY',
] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export interface CartLineInput {
  unitPriceMinor: number;
  quantity: string;
  discount?: Discount | null;
  taxRateBp: number;
}

export interface CartInput {
  lines: CartLineInput[];
  discount?: Discount | null;
  /** Shelf prices already contain tax (tax is extracted) instead of being added on top. */
  pricesIncludeTax: boolean;
}

export interface CartLineTotals {
  /** unit price × quantity */
  grossMinor: number;
  lineDiscountMinor: number;
  /** This line's share of the cart discount. */
  cartDiscountMinor: number;
  /** Tax contained in (inclusive pricing) or added to (exclusive) the line. */
  taxMinor: number;
  /** What the customer pays for this line. */
  totalMinor: number;
}

export type CartIssue =
  | { line: number; issue: 'discount_exceeds_line' }
  | { line: null; issue: 'discount_exceeds_total' };

export interface CartTotals {
  lines: CartLineTotals[];
  subtotalMinor: number;
  discountMinor: number;
  taxMinor: number;
  totalMinor: number;
  issues: CartIssue[];
}

/** a × num / den rounded half-up, for non-negative integers. */
function mulDivRound(a: bigint, num: bigint, den: bigint): bigint {
  return (a * num * 2n + den) / (den * 2n);
}

const toSafe = (value: bigint): number => {
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) throw new RangeError('Amount is too large');
  return Number(value);
};

/** Discount amount for a base amount; percent rounds half-up. May exceed the base (caller checks). */
export function discountAmount(base: number, discount: Discount | null | undefined): number {
  if (!discount || discount.value === 0) return 0;
  if (discount.kind === 'AMOUNT') return discount.value;
  return toSafe(mulDivRound(BigInt(base), BigInt(discount.value), BigInt(BASIS_POINTS)));
}

/**
 * Splits `amount` across `weights` in proportion, exactly (the parts always sum
 * to `amount`). Leftover units go to the largest fractional remainders, ties to
 * the earlier line, so the result is deterministic.
 */
export function allocateProportionally(amount: number, weights: number[]): number[] {
  const total = weights.reduce((sum, w) => sum + BigInt(w), 0n);
  if (amount === 0 || total === 0n) return weights.map(() => 0);
  const big = BigInt(amount);
  const parts = weights.map((w) => (big * BigInt(w)) / total);
  const remainders = weights.map((w, index) => ({ index, rest: (big * BigInt(w)) % total }));
  let left = big - parts.reduce((sum, p) => sum + p, 0n);
  remainders.sort((a, b) => (a.rest === b.rest ? a.index - b.index : a.rest > b.rest ? -1 : 1));
  for (const { index } of remainders) {
    if (left === 0n) break;
    parts[index]! += 1n;
    left -= 1n;
  }
  return parts.map(toSafe);
}

/** Tax on a line amount: extracted from it (inclusive) or added to it (exclusive). */
export function taxFor(amountMinor: number, rateBp: number, inclusive: boolean): number {
  if (rateBp === 0 || amountMinor === 0) return 0;
  const amount = BigInt(amountMinor);
  const rate = BigInt(rateBp);
  return toSafe(
    inclusive
      ? mulDivRound(amount, rate, BigInt(BASIS_POINTS) + rate)
      : mulDivRound(amount, rate, BigInt(BASIS_POINTS)),
  );
}

/**
 * Prices a cart: line discounts first, then the cart discount shared across lines
 * in proportion to their discounted amounts, then tax per line on what is left.
 * Over-large discounts are reported as issues and clamped so totals stay valid.
 */
export function computeCart(input: CartInput): CartTotals {
  const issues: CartIssue[] = [];
  const gross = input.lines.map((line) => lineTotalMinor(line.unitPriceMinor, line.quantity));
  const lineDiscounts = input.lines.map((line, index) => {
    const amount = discountAmount(gross[index]!, line.discount);
    if (amount > gross[index]!) {
      issues.push({ line: index, issue: 'discount_exceeds_line' });
      return gross[index]!;
    }
    return amount;
  });
  const afterLine = gross.map((g, index) => g - lineDiscounts[index]!);
  const base = afterLine.reduce((sum, value) => sum + value, 0);

  let cartDiscount = discountAmount(base, input.discount);
  if (cartDiscount > base) {
    issues.push({ line: null, issue: 'discount_exceeds_total' });
    cartDiscount = base;
  }
  const shares = allocateProportionally(cartDiscount, afterLine);

  const lines = input.lines.map((line, index): CartLineTotals => {
    const net = afterLine[index]! - shares[index]!;
    const tax = taxFor(net, line.taxRateBp, input.pricesIncludeTax);
    return {
      grossMinor: gross[index]!,
      lineDiscountMinor: lineDiscounts[index]!,
      cartDiscountMinor: shares[index]!,
      taxMinor: tax,
      totalMinor: input.pricesIncludeTax ? net : net + tax,
    };
  });
  const sum = (pick: (line: CartLineTotals) => number) =>
    lines.reduce((total, line) => total + pick(line), 0);
  return {
    lines,
    subtotalMinor: sum((l) => l.grossMinor),
    discountMinor: sum((l) => l.lineDiscountMinor + l.cartDiscountMinor),
    taxMinor: sum((l) => l.taxMinor),
    totalMinor: sum((l) => l.totalMinor),
    issues,
  };
}

export interface PaymentInput {
  method: PaymentMethod;
  amountMinor: number;
}

export type SettlementIssue = 'insufficient' | 'non_cash_exceeds_total';

export type Settlement =
  | { ok: true; paidMinor: number; changeMinor: number; cashMinor: number }
  | { ok: false; issue: SettlementIssue; dueMinor: number };

/**
 * Checks split payments against a total. Only cash can be over-tendered (the
 * difference is change); card, transfer and other payments may not exceed what
 * is still owed, so change is never given against them.
 */
export function settlePayments(totalMinor: number, payments: PaymentInput[]): Settlement {
  const paid = payments.reduce((sum, p) => sum + p.amountMinor, 0);
  const cash = payments.filter((p) => p.method === 'CASH').reduce((s, p) => s + p.amountMinor, 0);
  const nonCash = paid - cash;
  if (nonCash > totalMinor)
    return { ok: false, issue: 'non_cash_exceeds_total', dueMinor: totalMinor };
  if (paid < totalMinor) return { ok: false, issue: 'insufficient', dueMinor: totalMinor - paid };
  return { ok: true, paidMinor: paid, changeMinor: paid - totalMinor, cashMinor: cash };
}

/** Cash that should be in the drawer: opening float + cash taken − change given. */
export function expectedCash(
  openingFloatMinor: number,
  cashReceivedMinor: number,
  changeGivenMinor: number,
): number {
  return openingFloatMinor + cashReceivedMinor - changeGivenMinor;
}

/** "18.5" -> 1850 basis points; null when malformed or outside 0–100. */
export function parsePercent(input: string): number | null {
  const match = /^(\d{1,3})(?:\.(\d{1,2}))?$/.exec(input.trim());
  if (!match) return null;
  const value = Number(match[1]) * 100 + Number((match[2] ?? '').padEnd(2, '0'));
  return value <= BASIS_POINTS ? value : null;
}

/** 1850 -> "18.5"; 1800 -> "18". */
export function formatPercent(basisPoints: number): string {
  const whole = Math.floor(basisPoints / 100);
  const fraction = String(basisPoints % 100)
    .padStart(2, '0')
    .replace(/0+$/, '');
  return fraction ? `${whole}.${fraction}` : String(whole);
}
