import type { BillingInvoice, Plan, Subscription, SubscriptionSummary } from '@pos/contracts';
import type {
  BillingInvoice as InvoiceRow,
  Plan as PlanRow,
  Subscription as SubscriptionRow,
} from '@prisma/client';
import { planLimits } from './entitlements';

const iso = (date: Date | null) => date?.toISOString() ?? null;

export function toPlan(row: PlanRow): Plan {
  return {
    code: row.code,
    name: row.name,
    priceMonthlyMinor: row.priceMonthlyMinor,
    priceYearlyMinor: row.priceYearlyMinor,
    currency: row.currency,
    limits: planLimits(row),
  };
}

export function toSubscriptionSummary(
  row: (SubscriptionRow & { plan: { name: string } }) | null | undefined,
): SubscriptionSummary | null {
  if (!row) return null;
  return {
    status: row.status,
    planName: row.plan.name,
    trialEndsAt: iso(row.trialEndsAt),
    currentPeriodEnd: iso(row.currentPeriodEnd),
    graceEndsAt: iso(row.graceEndsAt),
    cancelAtPeriodEnd: row.cancelAtPeriodEnd,
  };
}

export function toSubscription(row: SubscriptionRow & { plan: PlanRow }): Subscription {
  return {
    ...toSubscriptionSummary(row)!,
    plan: toPlan(row.plan),
    interval: row.interval,
    currentPeriodStart: iso(row.currentPeriodStart),
    version: row.version,
  };
}

export function toBillingInvoice(row: InvoiceRow & { plan: { name: string } }): BillingInvoice {
  return {
    id: row.id,
    number: row.number,
    planName: row.plan.name,
    interval: row.interval,
    status: row.status,
    subtotalMinor: row.subtotalMinor,
    taxRateBp: row.taxRateBp,
    taxMinor: row.taxMinor,
    totalMinor: row.totalMinor,
    currency: row.currency,
    periodStart: iso(row.periodStart),
    periodEnd: iso(row.periodEnd),
    paidAt: iso(row.paidAt),
    createdAt: row.createdAt.toISOString(),
  };
}
