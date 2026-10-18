import { BILLING_INTERVALS, CURRENCY_CODES, SUBSCRIPTION_STATUSES } from '@pos/domain';
import { z } from 'zod';
import { rawPasswordSchema } from './auth';
import { billingInvoiceSchema, planLimitsSchema, planSchema } from './billing';
import { emailSchema, isoDateTimeSchema, pageSchema, uuidSchema } from './common';
import { tenantFeatureSchema } from './notifications';

/**
 * Platform console: staff of the SaaS operator. Separate sign-in (with an
 * authenticator code), separate tokens, and only business metadata — never a
 * shop's sales, products or customers.
 */

export const platformLoginRequestSchema = z.object({
  email: emailSchema,
  password: rawPasswordSchema,
  code: z
    .string({ error: 'validation.required' })
    .trim()
    .regex(/^\d{6}$/, { error: 'validation.totp.invalid' }),
});
export type PlatformLoginRequest = z.input<typeof platformLoginRequestSchema>;

export const platformUserSchema = z.object({
  id: uuidSchema,
  email: z.string(),
  fullName: z.string(),
});
export type PlatformUser = z.infer<typeof platformUserSchema>;

export const platformSessionSchema = z.object({
  accessToken: z.string(),
  /** Absolute end of the sign-in; it also ends after a period of inactivity. */
  expiresAt: isoDateTimeSchema,
  user: platformUserSchema,
});
export type PlatformSession = z.infer<typeof platformSessionSchema>;

const countsByStatus = z.record(z.string(), z.number().int());

export const platformOverviewSchema = z.object({
  tenants: z.object({
    total: z.number().int(),
    suspended: z.number().int(),
    closed: z.number().int(),
    signupsLast30Days: z.number().int(),
  }),
  subscriptions: countsByStatus,
  revenue: z.object({
    currency: z.string(),
    /** Paid subscriptions only: monthly prices plus yearly prices ÷ 12, before tax. */
    monthlyRecurringMinor: z.number().int(),
    paidLast30DaysMinor: z.number().int(),
    paymentsLast30Days: z.number().int(),
  }),
  paymentsConfigured: z.boolean(),
  lastBillingSweepAt: isoDateTimeSchema.nullable(),
});
export type PlatformOverview = z.infer<typeof platformOverviewSchema>;

export const platformSubscriptionSchema = z.object({
  status: z.enum(SUBSCRIPTION_STATUSES),
  planCode: z.string(),
  planName: z.string(),
  interval: z.enum(BILLING_INTERVALS),
  trialEndsAt: isoDateTimeSchema.nullable(),
  currentPeriodEnd: isoDateTimeSchema.nullable(),
  graceEndsAt: isoDateTimeSchema.nullable(),
  cancelAtPeriodEnd: z.boolean(),
});

export const platformTenantSummarySchema = z.object({
  id: uuidSchema,
  name: z.string(),
  slug: z.string(),
  status: z.enum(['ACTIVE', 'SUSPENDED', 'CLOSED']),
  businessType: z.string().nullable(),
  createdAt: isoDateTimeSchema,
  ownerEmail: z.string().nullable(),
  subscription: platformSubscriptionSchema.nullable(),
});
export type PlatformTenantSummary = z.infer<typeof platformTenantSummarySchema>;
export const platformTenantPageSchema = pageSchema(platformTenantSummarySchema);
export type PlatformTenantPage = z.infer<typeof platformTenantPageSchema>;

export const listPlatformTenantsQuerySchema = z.object({
  q: z.string().trim().max(120).optional(),
  subscriptionStatus: z.enum(SUBSCRIPTION_STATUSES).optional(),
  tenantStatus: z.enum(['ACTIVE', 'SUSPENDED', 'CLOSED']).optional(),
  cursor: uuidSchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});
export type ListPlatformTenantsQuery = z.input<typeof listPlatformTenantsQuerySchema>;

export const platformTenantDetailSchema = platformTenantSummarySchema.extend({
  contactPhone: z.string().nullable(),
  onboardingStatus: z.string(),
  owners: z.array(
    z.object({
      fullName: z.string(),
      email: z.string(),
      emailVerified: z.boolean(),
      lastLoginAt: isoDateTimeSchema.nullable(),
    }),
  ),
  usage: planLimitsSchema,
  limits: planLimitsSchema.nullable(),
  invoices: z.array(billingInvoiceSchema),
  payments: z.array(
    z.object({
      createdAt: isoDateTimeSchema,
      provider: z.string(),
      outcome: z.string(),
      amountMinor: z.number().int(),
      currency: z.string(),
      method: z.string().nullable(),
    }),
  ),
  features: z.array(tenantFeatureSchema),
});
export type PlatformTenantDetail = z.infer<typeof platformTenantDetailSchema>;

const reasonSchema = z
  .string({ error: 'validation.required' })
  .trim()
  .min(3, { error: 'validation.reason.too_short' })
  .max(500, { error: 'validation.text.too_long' });

export const tenantActionRequestSchema = z.object({ reason: reasonSchema });
export type TenantActionRequest = z.input<typeof tenantActionRequestSchema>;

/** Closing is final for the business; the slug must be typed to confirm. */
export const closeTenantRequestSchema = z.object({
  reason: reasonSchema,
  confirmSlug: z.string().trim().min(1, { error: 'validation.required' }),
});
export type CloseTenantRequest = z.input<typeof closeTenantRequestSchema>;

export const extendSubscriptionRequestSchema = z.object({
  days: z.coerce.number().int().min(1).max(366),
  reason: reasonSchema,
});
export type ExtendSubscriptionRequest = z.input<typeof extendSubscriptionRequestSchema>;

export const changePlanRequestSchema = z.object({
  planCode: z.string().trim().min(1).max(32),
  reason: reasonSchema,
});
export type ChangePlanRequest = z.input<typeof changePlanRequestSchema>;

/** A payment received outside the provider (e.g. bank transfer), recorded by staff. */
export const manualPaymentRequestSchema = z.object({
  planCode: z.string().trim().min(1).max(32),
  interval: z.enum(BILLING_INTERVALS),
  amountMinor: z.number().int().min(0).max(1_000_000_000),
  reference: z.string().trim().min(1, { error: 'validation.required' }).max(64),
  reason: reasonSchema,
});
export type ManualPaymentRequest = z.input<typeof manualPaymentRequestSchema>;

export const platformPlanSchema = planSchema.extend({
  isPublic: z.boolean(),
  sortOrder: z.number().int(),
  version: z.number().int(),
  subscribers: z.number().int(),
});
export type PlatformPlan = z.infer<typeof platformPlanSchema>;
export const platformPlanListSchema = z.object({ items: z.array(platformPlanSchema) });
export type PlatformPlanList = z.infer<typeof platformPlanListSchema>;

const limitSchema = z.number().int().min(0).max(100_000);
const priceSchema = z.number().int().min(0).max(1_000_000_000);

export const createPlanRequestSchema = z.object({
  code: z
    .string({ error: 'validation.required' })
    .trim()
    .toUpperCase()
    .regex(/^[A-Z][A-Z0-9_]{1,31}$/, { error: 'validation.plan.code' }),
  name: z.string().trim().min(2).max(60),
  priceMonthlyMinor: priceSchema,
  priceYearlyMinor: priceSchema,
  currency: z.enum(CURRENCY_CODES).default('LKR'),
  limits: z.object({
    branches: limitSchema.min(1),
    registers: limitSchema.min(1),
    staff: limitSchema.min(1),
    devices: limitSchema,
  }),
  isPublic: z.boolean().default(false),
  sortOrder: z.number().int().min(0).max(1000).default(0),
});
export type CreatePlanRequest = z.input<typeof createPlanRequestSchema>;

export const updatePlanRequestSchema = createPlanRequestSchema
  .omit({ code: true, currency: true })
  .partial()
  .extend({ version: z.number().int().min(1) });
export type UpdatePlanRequest = z.input<typeof updatePlanRequestSchema>;

export const platformAuditEntrySchema = z.object({
  id: uuidSchema,
  action: z.string(),
  actorEmail: z.string().nullable(),
  tenantId: uuidSchema.nullable(),
  tenantName: z.string().nullable(),
  entityType: z.string().nullable(),
  entityId: z.string().nullable(),
  metadata: z.unknown().nullable(),
  ip: z.string().nullable(),
  createdAt: isoDateTimeSchema,
});
export type PlatformAuditEntry = z.infer<typeof platformAuditEntrySchema>;
export const platformAuditPageSchema = pageSchema(platformAuditEntrySchema);
export type PlatformAuditPage = z.infer<typeof platformAuditPageSchema>;

export const platformAuditQuerySchema = z.object({
  tenantId: uuidSchema.optional(),
  cursor: uuidSchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export type PlatformAuditQuery = z.input<typeof platformAuditQuerySchema>;
