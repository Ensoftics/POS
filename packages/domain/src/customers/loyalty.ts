/**
 * Loyalty points: earned on what a customer pays (except with points), spent as a
 * payment method, and reversed in proportion when goods come back. All amounts are
 * integers (minor units and whole points), so the rules are exact.
 */

export interface LoyaltyRules {
  enabled: boolean;
  /** Spend (minor units) for one point, e.g. 10000 = 1 point per LKR 100. */
  spendPerPointMinor: number;
  /** What one point pays for (minor units), e.g. 100 = LKR 1. */
  pointValueMinor: number;
  /** Fewest points usable in one sale. */
  minRedeemPoints: number;
}

/** Whole points earned on an amount; nothing on zero or less. */
export function pointsEarned(eligibleMinor: number, spendPerPointMinor: number): number {
  if (eligibleMinor <= 0 || spendPerPointMinor <= 0) return 0;
  return Math.floor(eligibleMinor / spendPerPointMinor);
}

export type RedeemIssue = 'not_whole_points' | 'below_minimum' | 'insufficient_points';

/**
 * Points needed to pay `amountMinor`. The amount must be a whole number of points
 * (no fractions of a point are spent), at least the minimum, and within the balance.
 */
export function pointsToRedeem(
  amountMinor: number,
  rules: Pick<LoyaltyRules, 'pointValueMinor' | 'minRedeemPoints'>,
  balance: number,
): { ok: true; points: number } | { ok: false; issue: RedeemIssue } {
  if (amountMinor <= 0 || amountMinor % rules.pointValueMinor !== 0)
    return { ok: false, issue: 'not_whole_points' };
  const points = amountMinor / rules.pointValueMinor;
  if (points < rules.minRedeemPoints) return { ok: false, issue: 'below_minimum' };
  if (points > balance) return { ok: false, issue: 'insufficient_points' };
  return { ok: true, points };
}

/** Most that can be paid with points: whole points, within the balance and what is due. */
export function maxRedeemableMinor(
  balance: number,
  dueMinor: number,
  rules: Pick<LoyaltyRules, 'pointValueMinor' | 'minRedeemPoints'>,
): number {
  if (balance <= 0 || dueMinor <= 0) return 0;
  const points = Math.min(balance, Math.floor(dueMinor / rules.pointValueMinor));
  return points >= Math.max(rules.minRedeemPoints, 1) ? points * rules.pointValueMinor : 0;
}

/**
 * Cumulative share of `totalPoints` for `cumulativeMinor` out of `baseMinor`,
 * rounded down until the whole base is reached (then exactly all points). Each
 * return takes the difference from the previous share, so several partial returns
 * add up to the original points exactly.
 */
export function cumulativePointShare(
  totalPoints: number,
  cumulativeMinor: number,
  baseMinor: number,
): number {
  if (totalPoints <= 0 || baseMinor <= 0 || cumulativeMinor <= 0) return 0;
  if (cumulativeMinor >= baseMinor) return totalPoints;
  return Math.floor((totalPoints * cumulativeMinor) / baseMinor);
}
