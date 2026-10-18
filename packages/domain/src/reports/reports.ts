import { toMilli } from '../inventory/inventory';

/**
 * Costing and reporting rules shared by the API and clients.
 *
 * Average cost is kept per variant across all branches with four decimals of a
 * minor unit ("cost4": 1 minor unit = 10_000), so averaging many small receipts
 * does not drift. Quantities are milli-units (see inventory.ts).
 */
export const COST_SCALE = 10_000n;

function divRound(numerator: bigint, denominator: bigint): bigint {
  if (denominator === 0n) throw new RangeError('Division by zero');
  const negative = numerator < 0n !== denominator < 0n;
  const n = numerator < 0n ? -numerator : numerator;
  const d = denominator < 0n ? -denominator : denominator;
  const q = (n * 2n + d) / (d * 2n);
  return negative ? -q : q;
}

/**
 * Moving weighted-average cost after a receipt. Stock below zero counts as none
 * (it was sold without a known cost), so the receipt's cost is not distorted.
 */
export function averageCostAfterReceipt(input: {
  onHand: string;
  averageCost4: bigint | null;
  received: string;
  unitCostMinor: number | bigint;
}): bigint {
  const onHand = BigInt(Math.max(0, toMilli(input.onHand)));
  const received = BigInt(toMilli(input.received));
  const incoming = received * BigInt(input.unitCostMinor) * COST_SCALE;
  if (input.averageCost4 === null || onHand === 0n) return BigInt(input.unitCostMinor) * COST_SCALE;
  return divRound(onHand * input.averageCost4 + incoming, onHand + received);
}

/** Cost of `quantity` units at an average cost, rounded half-up to a minor unit. */
export function costOf(quantity: string, averageCost4: bigint): number {
  return Number(divRound(BigInt(toMilli(quantity)) * averageCost4, 1000n * COST_SCALE));
}

/** Gross margin in basis points of revenue (null when there is no revenue). */
export function marginBp(revenueMinor: number, profitMinor: number): number | null {
  if (revenueMinor === 0) return null;
  return Number(divRound(BigInt(profitMinor) * 10_000n, BigInt(revenueMinor)));
}

export const AGEING_BUCKETS = ['0_30', '31_60', '61_90', 'OVER_90'] as const;
export type AgeingBucket = (typeof AGEING_BUCKETS)[number];

export interface AccountMovement {
  /** Signed: positive increases what the customer owes. */
  amountMinor: number;
  createdAt: string;
}

/**
 * Splits what a customer owes by how long it has been owed. Payments and refunds
 * settle the oldest charges first (FIFO); whatever remains of each charge is aged
 * from the charge's date. Store credit (nothing owed) gives empty buckets.
 */
export function ageReceivable(
  movements: AccountMovement[],
  asOf: Date,
): Record<AgeingBucket, number> & { totalMinor: number } {
  const ordered = [...movements].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const open: Array<{ amount: number; at: string }> = [];
  let credit = 0;
  for (const m of ordered) {
    if (m.amountMinor > 0) {
      // A new charge first uses any credit left over from earlier payments.
      const used = Math.min(credit, m.amountMinor);
      credit -= used;
      if (m.amountMinor - used > 0) open.push({ amount: m.amountMinor - used, at: m.createdAt });
    } else {
      let left = -m.amountMinor;
      while (left > 0 && open.length > 0) {
        const oldest = open[0]!;
        const take = Math.min(left, oldest.amount);
        oldest.amount -= take;
        left -= take;
        if (oldest.amount === 0) open.shift();
      }
      credit += left;
    }
  }
  const buckets: Record<AgeingBucket, number> = { '0_30': 0, '31_60': 0, '61_90': 0, OVER_90: 0 };
  for (const charge of open) {
    const days = Math.floor((asOf.getTime() - Date.parse(charge.at)) / 86_400_000);
    const bucket: AgeingBucket =
      days <= 30 ? '0_30' : days <= 60 ? '31_60' : days <= 90 ? '61_90' : 'OVER_90';
    buckets[bucket] += charge.amount;
  }
  return { ...buckets, totalMinor: open.reduce((sum, c) => sum + c.amount, 0) };
}
