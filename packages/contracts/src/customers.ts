import { z } from 'zod';
import { CUSTOMER_ENTRY_TYPES, MAX_MINOR_UNITS, PAYMENT_METHODS } from '@pos/domain';
import { emailSchema, isoDateTimeSchema, pageSchema, uuidSchema } from './common';
import { CATALOG_STATUSES } from './catalog';
import { isoDateSchema } from './inventory';

const nullableText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, { error: 'validation.text.too_long' })
    .transform((value) => (value === '' ? null : value))
    .nullable()
    .optional();

const minorAmount = z
  .number({ error: 'validation.money.invalid' })
  .int({ error: 'validation.money.invalid' })
  .min(0, { error: 'validation.money.negative' })
  .max(MAX_MINOR_UNITS, { error: 'validation.money.too_large' });

export const customerSchema = z.object({
  id: uuidSchema,
  number: z.string(),
  name: z.string(),
  /** E.164, e.g. +94771234567. */
  phone: z.string().nullable(),
  email: z.string().nullable(),
  address: z.string().nullable(),
  notes: z.string().nullable(),
  marketingConsent: z.boolean(),
  marketingConsentAt: isoDateTimeSchema.nullable(),
  creditLimitMinor: z.number().int(),
  /** Positive: owed by the customer. Negative: store credit. */
  balanceMinor: z.number().int(),
  availableCreditMinor: z.number().int(),
  /** Loyalty points held (may be below zero after a return of goods bought with points). */
  loyaltyPoints: z.number().int().optional(),
  status: z.enum(CATALOG_STATUSES),
  version: z.number().int(),
  createdAt: isoDateTimeSchema,
});
export type Customer = z.infer<typeof customerSchema>;
export const customerPageSchema = pageSchema(customerSchema);
export type CustomerPage = z.infer<typeof customerPageSchema>;

const customerFields = {
  name: z
    .string({ error: 'validation.required' })
    .trim()
    .min(1, { error: 'validation.required' })
    .max(120, { error: 'validation.text.too_long' }),
  /** Any common format; stored normalised in the business's country. */
  phone: nullableText(30),
  email: z
    .union([z.literal(''), emailSchema])
    .transform((value) => (value === '' ? null : value))
    .nullable()
    .optional(),
  address: nullableText(300),
  notes: nullableText(1000),
  marketingConsent: z.boolean().optional(),
  /** How consent was asked or given (kept in the consent history), e.g. "Asked at the till". */
  consentNote: nullableText(300),
};

export const createCustomerRequestSchema = z.object({
  ...customerFields,
  /** Needs `customers.credit`. */
  creditLimitMinor: minorAmount.optional(),
});
export type CreateCustomerRequest = z.input<typeof createCustomerRequestSchema>;

export const updateCustomerRequestSchema = z.object({
  version: z.number().int().min(1),
  name: customerFields.name.optional(),
  phone: customerFields.phone,
  email: customerFields.email,
  address: customerFields.address,
  notes: customerFields.notes,
  marketingConsent: customerFields.marketingConsent,
  consentNote: customerFields.consentNote,
  creditLimitMinor: minorAmount.optional(),
  status: z.enum(CATALOG_STATUSES).optional(),
});
export type UpdateCustomerRequest = z.input<typeof updateCustomerRequestSchema>;

export const listCustomersQuerySchema = z.object({
  /** Name, number or phone (any format). */
  q: z.string().trim().max(100).optional(),
  status: z.enum(['ACTIVE', 'ARCHIVED', 'ALL']).default('ACTIVE'),
  /** Only customers who owe money. */
  owing: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
  cursor: uuidSchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});
export type ListCustomersQuery = z.input<typeof listCustomersQuerySchema>;

/* Collections ---------------------------------------------------------------- */

export const COLLECTION_METHODS = PAYMENT_METHODS.filter(
  (m): m is Exclude<(typeof PAYMENT_METHODS)[number], 'ACCOUNT' | 'LOYALTY'> =>
    m !== 'ACCOUNT' && m !== 'LOYALTY',
);

export const createCustomerPaymentRequestSchema = z.object({
  /** Client-generated; a retry returns the original payment. */
  id: uuidSchema,
  method: z.enum(COLLECTION_METHODS as unknown as ['CASH', 'CARD', 'BANK_TRANSFER', 'OTHER']),
  amountMinor: minorAmount.refine((v) => v > 0, { error: 'validation.payment.amount_positive' }),
  reference: nullableText(40).refine(
    (value) => !value || !/\d{12,}/.test(value.replace(/[\s-]/g, '')),
    { error: 'validation.payment.reference_looks_like_card' },
  ),
  /** The collector's open shift; required for cash, which goes into its drawer. */
  shiftId: uuidSchema.optional(),
});
export type CreateCustomerPaymentRequest = z.input<typeof createCustomerPaymentRequestSchema>;

export const customerPaymentSchema = z.object({
  id: uuidSchema,
  number: z.string(),
  customerId: uuidSchema,
  customerName: z.string(),
  method: z.enum(PAYMENT_METHODS),
  amountMinor: z.number().int(),
  reference: z.string().nullable(),
  shiftNumber: z.string().nullable(),
  createdByName: z.string().nullable(),
  createdAt: isoDateTimeSchema,
  balanceAfterMinor: z.number().int(),
});
export type CustomerPayment = z.infer<typeof customerPaymentSchema>;

/* Statements --------------------------------------------------------------- */

export const statementQuerySchema = z.object({
  /** Business days in the tenant's timezone, inclusive; default: last 30 days to today. */
  from: isoDateSchema.optional(),
  to: isoDateSchema.optional(),
});
export type StatementQuery = z.input<typeof statementQuerySchema>;

export const statementSchema = z.object({
  business: z.object({
    name: z.string(),
    legalName: z.string().nullable(),
    addressLines: z.array(z.string()),
    timezone: z.string(),
    currency: z.string(),
  }),
  customer: customerSchema,
  from: isoDateSchema,
  to: isoDateSchema,
  openingBalanceMinor: z.number().int(),
  closingBalanceMinor: z.number().int(),
  entries: z.array(
    z.object({
      id: uuidSchema,
      type: z.enum(CUSTOMER_ENTRY_TYPES),
      amountMinor: z.number().int(),
      balanceAfterMinor: z.number().int(),
      referenceType: z.string(),
      referenceId: uuidSchema,
      referenceNumber: z.string(),
      createdAt: isoDateTimeSchema,
    }),
  ),
});
export type Statement = z.infer<typeof statementSchema>;

/* Loyalty points --------------------------------------------------------------- */

export const LOYALTY_ENTRY_TYPES = ['EARN', 'REDEEM', 'REVERSE', 'REFUND', 'ADJUST'] as const;

export const loyaltyEntrySchema = z.object({
  id: uuidSchema,
  type: z.enum(LOYALTY_ENTRY_TYPES),
  /** Signed: positive adds points. */
  points: z.number().int(),
  balanceAfter: z.number().int(),
  referenceType: z.string(),
  referenceId: uuidSchema,
  referenceNumber: z.string().nullable(),
  note: z.string().nullable(),
  createdAt: isoDateTimeSchema,
});
export type LoyaltyEntry = z.infer<typeof loyaltyEntrySchema>;
export const loyaltyHistorySchema = z.object({
  balance: z.number().int(),
  items: z.array(loyaltyEntrySchema),
  nextCursor: z.string().nullable(),
});
export type LoyaltyHistory = z.infer<typeof loyaltyHistorySchema>;

export const adjustLoyaltyRequestSchema = z.object({
  /** Client-generated; a retry returns the same result. */
  id: uuidSchema,
  points: z
    .number({ error: 'validation.loyalty.points' })
    .int({ error: 'validation.loyalty.points' })
    .min(-1_000_000, { error: 'validation.loyalty.points' })
    .max(1_000_000, { error: 'validation.loyalty.points' })
    .refine((v) => v !== 0, { error: 'validation.loyalty.points' }),
  reason: z
    .string({ error: 'validation.required' })
    .trim()
    .min(3, { error: 'validation.reason.too_short' })
    .max(300, { error: 'validation.text.too_long' }),
});
export type AdjustLoyaltyRequest = z.input<typeof adjustLoyaltyRequestSchema>;
