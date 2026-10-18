import { describe, expect, it } from 'vitest';
import {
  addInterval,
  daysLeft,
  exceededLimits,
  invoiceTotals,
  isSubscriptionUsable,
  nextTransition,
  paidPeriodStart,
  type SubscriptionState,
  withinLimit,
} from './billing';

const at = (iso: string) => new Date(iso);
const state = (overrides: Partial<SubscriptionState>): SubscriptionState => ({
  status: 'ACTIVE',
  trialEndsAt: null,
  currentPeriodEnd: null,
  graceEndsAt: null,
  cancelAtPeriodEnd: false,
  ...overrides,
});

describe('billing periods', () => {
  it('adds calendar months and years, clamping to the last day of the month', () => {
    expect(addInterval(at('2026-01-31T10:00:00Z'), 'MONTH')).toEqual(at('2026-02-28T10:00:00Z'));
    expect(addInterval(at('2028-01-31T10:00:00Z'), 'MONTH')).toEqual(at('2028-02-29T10:00:00Z'));
    expect(addInterval(at('2026-11-15T00:00:00Z'), 'MONTH')).toEqual(at('2026-12-15T00:00:00Z'));
    expect(addInterval(at('2026-12-15T00:00:00Z'), 'MONTH')).toEqual(at('2027-01-15T00:00:00Z'));
    expect(addInterval(at('2028-02-29T00:00:00Z'), 'YEAR')).toEqual(at('2029-02-28T00:00:00Z'));
  });

  it('counts whole days left', () => {
    expect(daysLeft(at('2026-10-20T00:00:00Z'), at('2026-10-17T12:00:00Z'))).toBe(3);
    expect(daysLeft(at('2026-10-17T00:00:00Z'), at('2026-10-18T00:00:00Z'))).toBe(0);
  });
});

describe('subscription lifecycle', () => {
  const now = at('2026-10-17T00:00:00Z');

  it('moves an unpaid trial to past due with a grace period', () => {
    const trial = state({ status: 'TRIALING', trialEndsAt: at('2026-10-16T00:00:00Z') });
    expect(nextTransition(trial, now, 7)).toEqual({
      status: 'PAST_DUE',
      graceEndsAt: at('2026-10-23T00:00:00Z'),
    });
    expect(
      nextTransition({ ...trial, trialEndsAt: at('2026-10-18T00:00:00Z') }, now, 7),
    ).toBeNull();
  });

  it('ends a period as past due, or cancelled when the owner chose to stop', () => {
    const ended = state({ currentPeriodEnd: at('2026-10-17T00:00:00Z') });
    expect(nextTransition(ended, now, 7)?.status).toBe('PAST_DUE');
    expect(nextTransition({ ...ended, cancelAtPeriodEnd: true }, now, 7)).toEqual({
      status: 'CANCELLED',
      graceEndsAt: null,
    });
  });

  it('suspends once the grace period is over and then stays put', () => {
    const late = state({ status: 'PAST_DUE', graceEndsAt: at('2026-10-17T00:00:00Z') });
    expect(nextTransition(late, now, 7)?.status).toBe('SUSPENDED');
    expect(nextTransition({ ...late, graceEndsAt: at('2026-10-18T00:00:00Z') }, now, 7)).toBeNull();
    expect(nextTransition(state({ status: 'SUSPENDED' }), now, 7)).toBeNull();
    expect(nextTransition(state({ status: 'CANCELLED' }), now, 7)).toBeNull();
  });

  it('allows full use while trialing, paid or within grace', () => {
    expect(isSubscriptionUsable('TRIALING')).toBe(true);
    expect(isSubscriptionUsable('PAST_DUE')).toBe(true);
    expect(isSubscriptionUsable('SUSPENDED')).toBe(false);
    expect(isSubscriptionUsable('CANCELLED')).toBe(false);
  });

  it('starts a paid period without losing paid or trial days', () => {
    const periodEnd = at('2026-11-01T00:00:00Z');
    expect(paidPeriodStart(state({ currentPeriodEnd: periodEnd }), true, now)).toEqual(periodEnd);
    // A different plan starts now (no proration).
    expect(paidPeriodStart(state({ currentPeriodEnd: periodEnd }), false, now)).toEqual(now);
    const trialEnd = at('2026-10-25T00:00:00Z');
    expect(
      paidPeriodStart(state({ status: 'TRIALING', trialEndsAt: trialEnd }), false, now),
    ).toEqual(trialEnd);
    expect(paidPeriodStart(state({ status: 'SUSPENDED' }), true, now)).toEqual(now);
  });
});

describe('plan limits', () => {
  const limits = { branches: 2, registers: 4, staff: 5, devices: 4 };
  it('checks one more of a resource and finds what a downgrade would exceed', () => {
    const usage = { branches: 2, registers: 1, staff: 6, devices: 0 };
    expect(withinLimit(limits, usage, 'branches')).toBe(false);
    expect(withinLimit(limits, usage, 'registers')).toBe(true);
    expect(exceededLimits(limits, usage)).toEqual(['staff']);
  });
});

describe('invoice totals', () => {
  it('adds tax on the exclusive price, rounding half up', () => {
    expect(invoiceTotals(500_000, 1_800)).toEqual({
      subtotalMinor: 500_000,
      taxMinor: 90_000,
      totalMinor: 590_000,
    });
    expect(invoiceTotals(333, 1_500).taxMinor).toBe(50); // 49.95 → 50
    expect(invoiceTotals(500_000, 0).totalMinor).toBe(500_000);
  });
});
