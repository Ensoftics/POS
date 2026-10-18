/**
 * Inventory rules shared by the API and clients. Quantities have at most three
 * decimals, so they are handled as integer thousandths ("milli-units") here,
 * which keeps all arithmetic exact without a decimal library.
 */
export const MOVEMENT_TYPES = [
  'RECEIPT',
  'ADJUSTMENT',
  'TRANSFER_OUT',
  'TRANSFER_IN',
  'COUNT_CORRECTION',
  'SALE',
  'RETURN',
] as const;
export type MovementType = (typeof MOVEMENT_TYPES)[number];

export const ADJUSTMENT_REASONS = [
  'DAMAGED',
  'EXPIRED',
  'LOST',
  'THEFT',
  'FOUND',
  'RETURNED_TO_SUPPLIER',
  'INTERNAL_USE',
  'CORRECTION',
] as const;
export type AdjustmentReason = (typeof ADJUSTMENT_REASONS)[number];

/** Reasons that may only reduce stock; FOUND may only increase it. */
export const DECREASE_ONLY_REASONS: readonly AdjustmentReason[] = [
  'DAMAGED',
  'EXPIRED',
  'LOST',
  'THEFT',
  'RETURNED_TO_SUPPLIER',
  'INTERNAL_USE',
];

const SCALE = 1000;

/** "12.5" -> 12500. Throws on malformed input (callers validate first). */
export function toMilli(quantity: string): number {
  const match = /^(-)?(\d+)(?:\.(\d{1,3}))?$/.exec(quantity.trim());
  if (!match) throw new RangeError(`Invalid quantity: ${quantity}`);
  const [, sign, whole, fraction = ''] = match;
  const value = Number(whole) * SCALE + Number(fraction.padEnd(3, '0'));
  return sign ? -value : value;
}

/** 12500 -> "12.5"; -2000 -> "-2". */
export function fromMilli(milli: number): string {
  if (!Number.isSafeInteger(milli)) throw new RangeError('Quantity out of range');
  const sign = milli < 0 ? '-' : '';
  const abs = Math.abs(milli);
  const whole = Math.floor(abs / SCALE);
  const fraction = String(abs % SCALE)
    .padStart(3, '0')
    .replace(/0+$/, '');
  return `${sign}${whole}${fraction ? `.${fraction}` : ''}`;
}

export interface BatchBalance {
  batchId: string | null;
  quantity: string;
  expiryDate: string | null; // ISO date (YYYY-MM-DD)
}

export interface Allocation {
  batchId: string | null;
  quantity: string;
}

/**
 * First-expiry-first-out: takes `needed` from the batches that expire soonest
 * (undated stock last). Returns null when there is not enough stock in total.
 */
export function allocateFefo(balances: BatchBalance[], needed: string): Allocation[] | null {
  let remaining = toMilli(needed);
  const ordered = [...balances]
    .filter((b) => toMilli(b.quantity) > 0)
    .sort((a, b) => {
      if (a.expiryDate === b.expiryDate) return 0;
      if (a.expiryDate === null) return 1;
      if (b.expiryDate === null) return -1;
      return a.expiryDate < b.expiryDate ? -1 : 1;
    });
  const allocations: Allocation[] = [];
  for (const balance of ordered) {
    if (remaining <= 0) break;
    const take = Math.min(remaining, toMilli(balance.quantity));
    allocations.push({ batchId: balance.batchId, quantity: fromMilli(take) });
    remaining -= take;
  }
  return remaining > 0 ? null : allocations;
}

/**
 * FEFO for sales under a negative-stock policy: takes everything available in
 * FEFO order, then books the shortfall against unbatched stock (batch null),
 * which goes below zero until a receipt or stock count corrects it.
 */
export function allocateFefoWithShortfall(balances: BatchBalance[], needed: string): Allocation[] {
  const available = balances.reduce((sum, b) => sum + Math.max(0, toMilli(b.quantity)), 0);
  const shortfall = toMilli(needed) - available;
  if (shortfall <= 0) return allocateFefo(balances, needed)!;
  const taken = available > 0 ? allocateFefo(balances, fromMilli(available))! : [];
  const unbatched = taken.find((a) => a.batchId === null);
  if (unbatched) unbatched.quantity = fromMilli(toMilli(unbatched.quantity) + shortfall);
  else taken.push({ batchId: null, quantity: fromMilli(shortfall) });
  return taken;
}

/** A batch is usable through its expiry date and expired from the next day. */
export function isExpired(expiryDate: string | null, today: string): boolean {
  return expiryDate !== null && expiryDate < today;
}

export type SaleAllocation =
  | {
      ok: true;
      allocations: Allocation[];
      /** The part taken from expired batches (only with `allowExpired`). */
      expired: Allocation[];
    }
  | { ok: false; reason: 'insufficient' | 'expired' };

/**
 * Picks stock for a sale. Batches that expired before `today` are never chosen
 * while other stock is left. When the rest is not enough:
 * - with `allowExpired` (offline sales: the goods have already left the shop),
 *   expired batches are used next and reported in `expired`;
 * - otherwise, if expired stock exists, the sale is refused (`expired`): what
 *   the cashier holds is most likely from that batch;
 * - any remaining shortfall goes against unbatched stock when `allowNegative`,
 *   else the sale is refused (`insufficient`).
 */
export function allocateForSale(
  balances: BatchBalance[],
  needed: string,
  today: string,
  options: { allowNegative: boolean; allowExpired: boolean },
): SaleAllocation {
  const usable = balances.filter((b) => !isExpired(b.expiryDate, today));
  const expired = balances.filter((b) => isExpired(b.expiryDate, today));
  const fresh = allocateFefo(usable, needed);
  if (fresh) return { ok: true, allocations: fresh, expired: [] };

  const positive = (list: BatchBalance[]) =>
    list.reduce((sum, b) => sum + Math.max(0, toMilli(b.quantity)), 0);
  const usableMilli = positive(usable);
  const expiredMilli = positive(expired);
  if (expiredMilli > 0 && !options.allowExpired) return { ok: false, reason: 'expired' };

  const fromExpiredMilli = options.allowExpired
    ? Math.min(expiredMilli, toMilli(needed) - usableMilli)
    : 0;
  const shortfall = toMilli(needed) - usableMilli - fromExpiredMilli;
  if (shortfall > 0 && !options.allowNegative) return { ok: false, reason: 'insufficient' };

  const allocations = usableMilli > 0 ? allocateFefo(usable, fromMilli(usableMilli))! : [];
  // Expired stock: the most recently expired first (likeliest to still be on the shelf).
  const takenExpired =
    fromExpiredMilli > 0
      ? allocateFefo(
          expired.map((b) => ({ ...b, expiryDate: invertDate(b.expiryDate!) })),
          fromMilli(fromExpiredMilli),
        )!
      : [];
  allocations.push(...takenExpired);
  if (shortfall > 0) {
    const unbatched = allocations.find((a) => a.batchId === null);
    if (unbatched) unbatched.quantity = fromMilli(toMilli(unbatched.quantity) + shortfall);
    else allocations.push({ batchId: null, quantity: fromMilli(shortfall) });
  }
  return { ok: true, allocations, expired: takenExpired };
}

/** Sort key that orders ISO dates latest first under the ascending FEFO sort. */
function invertDate(isoDate: string): string {
  return String(99_999_999 - Number(isoDate.replaceAll('-', ''))).padStart(8, '0');
}

/** The calendar date (YYYY-MM-DD) at `at` in an IANA time zone. */
export function localDateIn(at: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(at);
}

/** Days until expiry from `today` (both ISO dates); negative when already expired. */
export function daysUntilExpiry(expiryDate: string, today: string): number {
  return Math.round(
    (Date.parse(`${expiryDate}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000,
  );
}

/**
 * unit price (minor units) x quantity, rounded half-up to a whole minor unit.
 * BigInt keeps the intermediate product exact for any allowed money/quantity.
 */
export function lineTotalMinor(unitMinor: number | bigint, quantity: string): number {
  const product = BigInt(unitMinor) * BigInt(toMilli(quantity));
  const negative = product < 0n;
  const abs = negative ? -product : product;
  const rounded = (abs + 500n) / 1000n;
  if (rounded > BigInt(Number.MAX_SAFE_INTEGER)) throw new RangeError('Line total is too large');
  return Number(negative ? -rounded : rounded);
}
