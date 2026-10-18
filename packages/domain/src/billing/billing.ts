/**
 * Subscription rules shared by the API and clients: plan limits, the lifecycle
 * (trial → active → past due → suspended), billing periods and invoice tax.
 * Everything here is pure; the API supplies the clock.
 */

export const SUBSCRIPTION_STATUSES = [
  'TRIALING',
  'ACTIVE',
  'PAST_DUE',
  'SUSPENDED',
  'CANCELLED',
] as const;
export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];

export const BILLING_INTERVALS = ['MONTH', 'YEAR'] as const;
export type BillingInterval = (typeof BILLING_INTERVALS)[number];

/** Things a plan limits. */
export const PLAN_RESOURCES = ['branches', 'registers', 'staff', 'devices'] as const;
export type PlanResource = (typeof PLAN_RESOURCES)[number];
export type PlanLimits = Record<PlanResource, number>;
export type Usage = Record<PlanResource, number>;

/** Full use of the system: trial, paid, or paid-but-late within the grace period. */
export function isSubscriptionUsable(status: SubscriptionStatus): boolean {
  return status === 'TRIALING' || status === 'ACTIVE' || status === 'PAST_DUE';
}

/** True when one more of `resource` fits the plan. */
export function withinLimit(limits: PlanLimits, usage: Usage, resource: PlanResource): boolean {
  return usage[resource] < limits[resource];
}

/** Resources whose current use is above a plan's limits (for downgrades). */
export function exceededLimits(limits: PlanLimits, usage: Usage): PlanResource[] {
  return PLAN_RESOURCES.filter((resource) => usage[resource] > limits[resource]);
}

const DAY_MS = 86_400_000;

export function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * DAY_MS);
}

/**
 * Adds whole calendar months (or years) in UTC, clamping to the month's last day,
 * so a period from 31 January ends on 28/29 February, not in March.
 */
export function addInterval(date: Date, interval: BillingInterval, count = 1): Date {
  const months = interval === 'YEAR' ? 12 * count : count;
  const result = new Date(date.getTime());
  const day = result.getUTCDate();
  result.setUTCDate(1);
  result.setUTCMonth(result.getUTCMonth() + months);
  const lastDay = new Date(
    Date.UTC(result.getUTCFullYear(), result.getUTCMonth() + 1, 0),
  ).getUTCDate();
  result.setUTCDate(Math.min(day, lastDay));
  return result;
}

export interface SubscriptionState {
  status: SubscriptionStatus;
  trialEndsAt: Date | null;
  currentPeriodEnd: Date | null;
  graceEndsAt: Date | null;
  cancelAtPeriodEnd: boolean;
}

export interface Transition {
  status: SubscriptionStatus;
  graceEndsAt: Date | null;
}

/**
 * The next state when time has passed, or null when nothing changes:
 * - a trial or paid period that ends unpaid becomes PAST_DUE for `graceDays`
 *   (or CANCELLED when the owner chose to stop at the period end);
 * - PAST_DUE becomes SUSPENDED (read-only) once the grace period is over.
 */
export function nextTransition(
  state: SubscriptionState,
  now: Date,
  graceDays: number,
): Transition | null {
  switch (state.status) {
    case 'TRIALING':
      if (state.trialEndsAt && now >= state.trialEndsAt)
        return state.cancelAtPeriodEnd
          ? { status: 'CANCELLED', graceEndsAt: null }
          : { status: 'PAST_DUE', graceEndsAt: addDays(state.trialEndsAt, graceDays) };
      return null;
    case 'ACTIVE':
      if (state.currentPeriodEnd && now >= state.currentPeriodEnd)
        return state.cancelAtPeriodEnd
          ? { status: 'CANCELLED', graceEndsAt: null }
          : { status: 'PAST_DUE', graceEndsAt: addDays(state.currentPeriodEnd, graceDays) };
      return null;
    case 'PAST_DUE':
      if (state.graceEndsAt && now >= state.graceEndsAt)
        return { status: 'SUSPENDED', graceEndsAt: state.graceEndsAt };
      return null;
    default:
      return null;
  }
}

/**
 * When a newly paid period starts. Paying early for the same plan continues from
 * the end of the current paid period, and paying during a trial keeps the trial
 * days; otherwise (late, cancelled, suspended, or a different plan) it starts now.
 */
export function paidPeriodStart(
  state: Pick<SubscriptionState, 'status' | 'trialEndsAt' | 'currentPeriodEnd'>,
  samePlan: boolean,
  now: Date,
): Date {
  if (
    samePlan &&
    state.status === 'ACTIVE' &&
    state.currentPeriodEnd &&
    state.currentPeriodEnd > now
  )
    return state.currentPeriodEnd;
  if (state.status === 'TRIALING' && state.trialEndsAt && state.trialEndsAt > now)
    return state.trialEndsAt;
  return now;
}

/** Tax on a tax-exclusive price, rounded half up to the minor unit. */
export function invoiceTotals(
  priceMinor: number,
  taxRateBp: number,
): { subtotalMinor: number; taxMinor: number; totalMinor: number } {
  const taxMinor = Math.floor((priceMinor * taxRateBp + 5_000) / 10_000);
  return { subtotalMinor: priceMinor, taxMinor, totalMinor: priceMinor + taxMinor };
}

/** Whole days left until `end` (0 when past), for "trial ends in N days". */
export function daysLeft(end: Date, now: Date): number {
  return Math.max(0, Math.ceil((end.getTime() - now.getTime()) / DAY_MS));
}
