import { z } from 'zod';
import {
  BUSINESS_TYPES,
  CURRENCY_CODES,
  isValidTimeZone,
  LANGUAGES,
  UNIT_CODES,
  VARIANT_ATTRIBUTES,
} from '@pos/domain';
import { isoDateTimeSchema } from './common';

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, { error: 'validation.text.too_long' })
    .transform((value) => (value === '' ? null : value))
    .nullable()
    .optional();

export const timeZoneSchema = z
  .string()
  .refine(isValidTimeZone, { error: 'validation.timezone.invalid' });

export const businessProfileSchema = z.object({
  trackBatchNumbers: z.boolean(),
  trackExpiryDates: z.boolean(),
  allowFractionalQuantities: z.boolean(),
  variantAttributes: z.array(z.enum(VARIANT_ATTRIBUTES)).max(VARIANT_ATTRIBUTES.length),
  defaultUnits: z
    .array(z.enum(UNIT_CODES))
    .min(1, { error: 'validation.units.required' })
    .max(UNIT_CODES.length),
});
export type BusinessProfileDto = z.infer<typeof businessProfileSchema>;

/** How the till prices and sells. */
export const checkoutSettingsSchema = z.object({
  /** Shelf prices already contain tax (tax is shown as included on receipts). */
  pricesIncludeTax: z.boolean(),
  /** Allow sales beyond recorded stock; the balance goes negative until corrected. */
  allowNegativeStock: z.boolean(),
  receiptFooter: z.string().nullable(),
  /** Discounts above this share of the subtotal (basis points) need approval; null = never. */
  discountApprovalBp: z.number().int().nullable(),
  refundsRequireApproval: z.boolean(),
});
export type CheckoutSettingsDto = z.infer<typeof checkoutSettingsSchema>;

export const checkoutSettingsInputSchema = z.object({
  pricesIncludeTax: z.boolean().optional(),
  allowNegativeStock: z.boolean().optional(),
  receiptFooter: optionalText(300),
  discountApprovalBp: z
    .number()
    .int({ error: 'validation.percent.invalid' })
    .min(0, { error: 'validation.percent.invalid' })
    .max(10_000, { error: 'validation.percent.invalid' })
    .nullable()
    .optional(),
  refundsRequireApproval: z.boolean().optional(),
});

export const loyaltySettingsSchema = z.object({
  enabled: z.boolean(),
  /** Spend (minor units) for one point. */
  spendPerPointMinor: z.number().int(),
  /** What one point pays for (minor units). */
  pointValueMinor: z.number().int(),
  minRedeemPoints: z.number().int(),
});
export type LoyaltySettingsDto = z.infer<typeof loyaltySettingsSchema>;

const positiveMinor = z
  .number()
  .int({ error: 'validation.loyalty.positive' })
  .min(1, { error: 'validation.loyalty.positive' })
  .max(100_000_000, { error: 'validation.money.too_large' });

export const loyaltySettingsInputSchema = z.object({
  enabled: z.boolean().optional(),
  spendPerPointMinor: positiveMinor.optional(),
  pointValueMinor: positiveMinor.optional(),
  minRedeemPoints: z
    .number()
    .int({ error: 'validation.loyalty.min_points' })
    .min(0, { error: 'validation.loyalty.min_points' })
    .max(1_000_000, { error: 'validation.loyalty.min_points' })
    .optional(),
});

export const tenantSettingsSchema = z.object({
  version: z.number().int(),
  legalName: z.string().nullable(),
  taxRegistrationNumber: z.string().nullable(),
  addressLine1: z.string().nullable(),
  addressLine2: z.string().nullable(),
  city: z.string().nullable(),
  postalCode: z.string().nullable(),
  country: z.string(),
  currency: z.enum(CURRENCY_CODES),
  timezone: z.string(),
  defaultLanguage: z.enum(LANGUAGES),
  enabledLanguages: z.array(z.enum(LANGUAGES)),
  profile: businessProfileSchema,
  checkout: checkoutSettingsSchema,
  /** Absent from older servers and caches: treat as switched off. */
  loyalty: loyaltySettingsSchema.optional(),
  updatedAt: isoDateTimeSchema,
});
export type TenantSettings = z.infer<typeof tenantSettingsSchema>;

/** Editable settings fields, all optional (partial update). Reused by client forms. */
export const tenantSettingsFieldsSchema = z.object({
  legalName: optionalText(160),
  taxRegistrationNumber: optionalText(40),
  addressLine1: optionalText(160),
  addressLine2: optionalText(160),
  city: optionalText(80),
  postalCode: optionalText(16),
  country: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{2}$/, { error: 'validation.country.invalid' })
    .optional(),
  currency: z.enum(CURRENCY_CODES, { error: 'validation.currency.invalid' }).optional(),
  timezone: timeZoneSchema.optional(),
  defaultLanguage: z.enum(LANGUAGES).optional(),
  enabledLanguages: z
    .array(z.enum(LANGUAGES))
    .min(1, { error: 'validation.languages.required' })
    .optional(),
  profile: businessProfileSchema.optional(),
  checkout: checkoutSettingsInputSchema.optional(),
  loyalty: loyaltySettingsInputSchema.optional(),
});

/** Adds the default-language rule when both fields are present (the API re-checks the merged result). */
export function refineLanguages(
  value: { defaultLanguage?: string; enabledLanguages?: string[] },
  ctx: z.RefinementCtx,
) {
  if (
    value.defaultLanguage &&
    value.enabledLanguages &&
    !value.enabledLanguages.includes(value.defaultLanguage)
  ) {
    ctx.addIssue({
      code: 'custom',
      path: ['enabledLanguages'],
      message: 'validation.languages.default_not_enabled',
    });
  }
}

/**
 * Partial update guarded by optimistic concurrency: `version` must match the
 * stored row, otherwise the API answers 409 VERSION_CONFLICT.
 */
export const updateTenantSettingsRequestSchema = tenantSettingsFieldsSchema
  .extend({ version: z.number().int().min(1) })
  .superRefine(refineLanguages);
export type UpdateTenantSettingsRequest = z.input<typeof updateTenantSettingsRequestSchema>;

export const businessProfilePresetsSchema = z.record(z.enum(BUSINESS_TYPES), businessProfileSchema);
export type BusinessProfilePresets = z.infer<typeof businessProfilePresetsSchema>;
