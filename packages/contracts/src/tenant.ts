import { z } from 'zod';
import { BUSINESS_TYPES } from '@pos/domain';
import { isoDateTimeSchema, uuidSchema } from './common';

export const TENANT_STATUSES = ['ACTIVE', 'SUSPENDED', 'CLOSED'] as const;
export const ONBOARDING_STATUSES = ['PENDING', 'COMPLETED'] as const;

export const tenantSummarySchema = z.object({
  id: uuidSchema,
  name: z.string(),
  slug: z.string(),
  status: z.enum(TENANT_STATUSES),
  businessType: z.enum(BUSINESS_TYPES).nullable(),
  contactPhone: z.string().nullable(),
  onboardingStatus: z.enum(ONBOARDING_STATUSES),
  onboardingCompletedAt: isoDateTimeSchema.nullable(),
  createdAt: isoDateTimeSchema,
});
export type TenantSummary = z.infer<typeof tenantSummarySchema>;

// Permissive international format; strict per-country validation belongs to Slice 2 settings.
export const phoneSchema = z
  .string()
  .trim()
  .regex(/^\+?[0-9][0-9 ()-]{6,19}$/, { error: 'validation.phone.invalid' });

export const completeOnboardingRequestSchema = z.object({
  businessName: z
    .string()
    .trim()
    .min(2, { error: 'validation.businessName.too_short' })
    .max(120, { error: 'validation.businessName.too_long' }),
  businessType: z.enum(BUSINESS_TYPES, { error: 'validation.businessType.required' }),
  contactPhone: phoneSchema.optional(),
});
export type CompleteOnboardingRequest = z.input<typeof completeOnboardingRequestSchema>;
