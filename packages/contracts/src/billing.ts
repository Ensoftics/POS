import { BILLING_INTERVALS, SUBSCRIPTION_STATUSES } from '@pos/domain';
import { z } from 'zod';
import { isoDateTimeSchema, uuidSchema } from './common';

export const planLimitsSchema = z.object({
  branches: z.number().int(),
  registers: z.number().int(),
  staff: z.number().int(),
  devices: z.number().int(),
});
export type PlanLimitsDto = z.infer<typeof planLimitsSchema>;

export const planSchema = z.object({
  code: z.string(),
  name: z.string(),
  /** Tax-exclusive prices in minor units. */
  priceMonthlyMinor: z.number().int(),
  priceYearlyMinor: z.number().int(),
  currency: z.string(),
  limits: planLimitsSchema,
});
export type Plan = z.infer<typeof planSchema>;

/** The parts of the subscription every signed-in screen needs (banners, read-only mode). */
export const subscriptionSummarySchema = z.object({
  status: z.enum(SUBSCRIPTION_STATUSES),
  planName: z.string(),
  trialEndsAt: isoDateTimeSchema.nullable(),
  currentPeriodEnd: isoDateTimeSchema.nullable(),
  graceEndsAt: isoDateTimeSchema.nullable(),
  cancelAtPeriodEnd: z.boolean(),
});
export type SubscriptionSummary = z.infer<typeof subscriptionSummarySchema>;

export const subscriptionSchema = subscriptionSummarySchema.extend({
  plan: planSchema,
  interval: z.enum(BILLING_INTERVALS),
  currentPeriodStart: isoDateTimeSchema.nullable(),
  version: z.number().int(),
});
export type Subscription = z.infer<typeof subscriptionSchema>;

export const billingInvoiceSchema = z.object({
  id: uuidSchema,
  number: z.string(),
  planName: z.string(),
  interval: z.enum(BILLING_INTERVALS),
  status: z.enum(['OPEN', 'PAID', 'VOID']),
  subtotalMinor: z.number().int(),
  taxRateBp: z.number().int(),
  taxMinor: z.number().int(),
  totalMinor: z.number().int(),
  currency: z.string(),
  periodStart: isoDateTimeSchema.nullable(),
  periodEnd: isoDateTimeSchema.nullable(),
  paidAt: isoDateTimeSchema.nullable(),
  createdAt: isoDateTimeSchema,
});
export type BillingInvoice = z.infer<typeof billingInvoiceSchema>;

export const billingOverviewSchema = z.object({
  subscription: subscriptionSchema,
  usage: planLimitsSchema,
  plans: z.array(planSchema),
  invoices: z.array(billingInvoiceSchema),
  /** False when no payment provider is configured on this server. */
  paymentsAvailable: z.boolean(),
  emailVerified: z.boolean(),
});
export type BillingOverview = z.infer<typeof billingOverviewSchema>;

export const checkoutRequestSchema = z.object({
  planCode: z.string({ error: 'validation.required' }).trim().min(1).max(32),
  interval: z.enum(BILLING_INTERVALS).default('MONTH'),
});
export type CheckoutRequest = z.input<typeof checkoutRequestSchema>;

/**
 * Where to send the browser to pay: an HTML form POST to the provider's hosted
 * checkout page. Card details are entered there, never in this system.
 */
export const checkoutResponseSchema = z.object({
  invoice: billingInvoiceSchema,
  redirect: z.object({
    method: z.literal('POST'),
    // HTTPS only: the web app submits a form to this address.
    url: z.url({ protocol: /^https$/ }),
    fields: z.record(z.string(), z.string()),
  }),
});
export type CheckoutResponse = z.infer<typeof checkoutResponseSchema>;

export const verifyEmailRequestSchema = z.object({ token: z.string().min(20).max(200) });
export type VerifyEmailRequest = z.input<typeof verifyEmailRequestSchema>;
