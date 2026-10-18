import { z } from 'zod';
import { BASIS_POINTS, DISCOUNT_KINDS, MAX_MINOR_UNITS, PAYMENT_METHODS } from '@pos/domain';
import { isoDateTimeSchema, pageSchema, uuidSchema } from './common';
import { CATALOG_STATUSES } from './catalog';
import { approvalSchema, cashMovementSchema } from './approvals';
import { isoDateSchema, positiveQuantitySchema } from './inventory';

const nullableText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, { error: 'validation.text.too_long' })
    .transform((value) => (value === '' ? null : value))
    .nullable()
    .optional();

const minorAmountSchema = z
  .number({ error: 'validation.money.invalid' })
  .int({ error: 'validation.money.invalid' })
  .min(0, { error: 'validation.money.negative' })
  .max(MAX_MINOR_UNITS, { error: 'validation.money.too_large' });

const basisPointsSchema = z
  .number({ error: 'validation.percent.invalid' })
  .int({ error: 'validation.percent.invalid' })
  .min(0, { error: 'validation.percent.invalid' })
  .max(BASIS_POINTS, { error: 'validation.percent.invalid' });

/* Tax rates --------------------------------------------------------------- */

export const taxRateSchema = z.object({
  id: uuidSchema,
  name: z.string(),
  /** Basis points: 1800 = 18 %. */
  rateBp: z.number().int(),
  isDefault: z.boolean(),
  status: z.enum(CATALOG_STATUSES),
  version: z.number().int(),
});
export type TaxRate = z.infer<typeof taxRateSchema>;
export const taxRateListSchema = z.object({ items: z.array(taxRateSchema) });
export type TaxRateList = z.infer<typeof taxRateListSchema>;

const taxRateName = z
  .string({ error: 'validation.required' })
  .trim()
  .min(1, { error: 'validation.required' })
  .max(60, { error: 'validation.text.too_long' });

export const createTaxRateRequestSchema = z.object({
  name: taxRateName,
  rateBp: basisPointsSchema,
  isDefault: z.boolean().optional(),
});
export type CreateTaxRateRequest = z.input<typeof createTaxRateRequestSchema>;

export const updateTaxRateRequestSchema = z.object({
  version: z.number().int().min(1),
  name: taxRateName.optional(),
  rateBp: basisPointsSchema.optional(),
  isDefault: z.boolean().optional(),
  status: z.enum(CATALOG_STATUSES).optional(),
});
export type UpdateTaxRateRequest = z.input<typeof updateTaxRateRequestSchema>;

/* Discounts and payments -------------------------------------------------- */

/** PERCENT: basis points (0–10000). AMOUNT: minor units. */
export const discountSchema = z
  .object({
    kind: z.enum(DISCOUNT_KINDS),
    value: z.number().int({ error: 'validation.discount.invalid' }).min(0, {
      error: 'validation.discount.invalid',
    }),
  })
  .superRefine((discount, ctx) => {
    const max = discount.kind === 'PERCENT' ? BASIS_POINTS : MAX_MINOR_UNITS;
    if (discount.value > max)
      ctx.addIssue({ code: 'custom', path: ['value'], message: 'validation.discount.invalid' });
  });
export type DiscountDto = z.infer<typeof discountSchema>;

export const paymentRequestSchema = z.object({
  method: z.enum(PAYMENT_METHODS),
  amountMinor: minorAmountSchema.refine((value) => value > 0, {
    error: 'validation.payment.amount_positive',
  }),
  /** Terminal approval code or transfer reference. Never a card number. */
  reference: nullableText(40).refine(
    (value) => !value || !/\d{12,}/.test(value.replace(/[\s-]/g, '')),
    {
      error: 'validation.payment.reference_looks_like_card',
    },
  ),
});
export type PaymentRequest = z.input<typeof paymentRequestSchema>;

export const salePaymentSchema = z.object({
  method: z.enum(PAYMENT_METHODS),
  amountMinor: z.number().int(),
  reference: z.string().nullable(),
});

/* Shifts ------------------------------------------------------------------- */

export const shiftSummarySchema = z.object({
  saleCount: z.number().int(),
  salesTotalMinor: z.number().int(),
  discountMinor: z.number().int(),
  taxMinor: z.number().int(),
  /** Amount received per method (cash before change). */
  payments: z.array(z.object({ method: z.enum(PAYMENT_METHODS), amountMinor: z.number().int() })),
  cashReceivedMinor: z.number().int(),
  changeGivenMinor: z.number().int(),
  returnCount: z.number().int(),
  refundsTotalMinor: z.number().int(),
  /** Refunds paid per method from this shift. */
  refunds: z.array(z.object({ method: z.enum(PAYMENT_METHODS), amountMinor: z.number().int() })),
  cashRefundedMinor: z.number().int(),
  payInMinor: z.number().int(),
  payOutMinor: z.number().int(),
  /** Payments collected from customers on this shift, and the cash part of them. */
  collectionsMinor: z.number().int(),
  collectionsCashMinor: z.number().int(),
  /** Float + cash received − change − cash refunds + pay-ins − pay-outs + cash collections. */
  expectedCashMinor: z.number().int(),
});
export type ShiftSummary = z.infer<typeof shiftSummarySchema>;

export const SHIFT_STATUSES = ['OPEN', 'CLOSED'] as const;

export const SALE_CONFLICT_TYPES = [
  'PRICE_CHANGED',
  'STOCK_SHORT',
  'SHIFT_CLOSED',
  'APPROVAL_MISSING',
  'ITEM_ARCHIVED',
  'CREDIT_LIMIT_EXCEEDED',
  'EXPIRED_SOLD',
] as const;
export type SaleConflictType = (typeof SALE_CONFLICT_TYPES)[number];

export const shiftSchema = z.object({
  id: uuidSchema,
  number: z.string(),
  status: z.enum(SHIFT_STATUSES),
  branchId: uuidSchema,
  branchName: z.string(),
  registerId: uuidSchema,
  registerName: z.string(),
  openingFloatMinor: z.number().int(),
  openedAt: isoDateTimeSchema,
  openedById: uuidSchema,
  openedByName: z.string(),
  closedAt: isoDateTimeSchema.nullable(),
  closedByName: z.string().nullable(),
  /** Set at close: expected and counted drawer cash and the difference (counted − expected). */
  expectedCashMinor: z.number().int().nullable(),
  countedCashMinor: z.number().int().nullable(),
  differenceMinor: z.number().int().nullable(),
  closingNotes: z.string().nullable(),
  version: z.number().int(),
  summary: shiftSummarySchema,
  cashMovements: z.array(cashMovementSchema),
});
export type Shift = z.infer<typeof shiftSchema>;
export const shiftPageSchema = pageSchema(shiftSchema);
export type ShiftPage = z.infer<typeof shiftPageSchema>;

export const currentShiftQuerySchema = z.object({ registerId: uuidSchema });
export const currentShiftResponseSchema = z.object({ shift: shiftSchema.nullable() });
export type CurrentShiftResponse = z.infer<typeof currentShiftResponseSchema>;

export const openShiftRequestSchema = z.object({
  registerId: uuidSchema,
  openingFloatMinor: minorAmountSchema,
});
export type OpenShiftRequest = z.input<typeof openShiftRequestSchema>;

export const closeShiftRequestSchema = z.object({
  version: z.number().int().min(1),
  countedCashMinor: minorAmountSchema,
  notes: nullableText(1000),
});
export type CloseShiftRequest = z.input<typeof closeShiftRequestSchema>;

export const listShiftsQuerySchema = z.object({
  branchId: uuidSchema.optional(),
  registerId: uuidSchema.optional(),
  status: z.enum(SHIFT_STATUSES).optional(),
  cursor: uuidSchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});
export type ListShiftsQuery = z.input<typeof listShiftsQuerySchema>;

/* Sales -------------------------------------------------------------------- */

export const saleLineRequestSchema = z.object({
  variantId: uuidSchema,
  quantity: positiveQuantitySchema,
  discount: discountSchema.nullable().optional(),
});

/**
 * A sale as submitted by a till. `id` is generated by the client: re-sending the
 * same request returns the original sale. `expectedTotalMinor` is the total the
 * cashier showed the customer; if prices changed meanwhile the API refuses with
 * TOTAL_MISMATCH instead of charging a different amount.
 */
export const offlineCaptureSchema = z.object({
  /** When the till completed the sale (its own clock). */
  capturedAt: z.iso.datetime({ error: 'validation.date.invalid', offset: true }),
  pricesIncludeTax: z.boolean(),
  /** The price and tax rate the till charged, one per sale line, in order. */
  lines: z.array(z.object({ unitPriceMinor: minorAmountSchema, taxRateBp: basisPointsSchema })),
});
export type OfflineCapture = z.infer<typeof offlineCaptureSchema>;

export const createSaleRequestSchema = z
  .object({
    id: uuidSchema,
    shiftId: uuidSchema,
    /** The customer buying; required when paying on account. */
    customerId: uuidSchema.optional(),
    lines: z
      .array(saleLineRequestSchema)
      .min(1, { error: 'validation.lines.required' })
      .max(200, { error: 'validation.lines.too_many' }),
    discount: discountSchema.nullable().optional(),
    payments: z.array(paymentRequestSchema).max(10, { error: 'validation.payment.too_many' }),
    expectedTotalMinor: minorAmountSchema,
    notes: nullableText(500),
    /** Needed when the discounts exceed the business's approval limit. */
    approval: approvalSchema.optional(),
    /**
     * Present when the sale was completed on a till without a connection. The
     * customer has already paid these prices, so the API records the sale as it
     * happened and lists any differences for a manager to review.
     */
    offline: offlineCaptureSchema.optional(),
  })
  .superRefine((value, ctx) => {
    if (value.offline && value.offline.lines.length !== value.lines.length)
      ctx.addIssue({
        code: 'custom',
        path: ['offline', 'lines'],
        message: 'validation.offline.lines',
      });
  });
export type CreateSaleRequest = z.input<typeof createSaleRequestSchema>;

export const saleLineSchema = z.object({
  id: uuidSchema,
  variantId: uuidSchema,
  productName: z.string(),
  sku: z.string(),
  variantLabel: z.string(),
  unit: z.string(),
  quantity: z.string(),
  unitPriceMinor: z.number().int(),
  /** unit price × quantity, before discounts. */
  grossMinor: z.number().int(),
  discount: discountSchema.nullable(),
  lineDiscountMinor: z.number().int(),
  cartDiscountMinor: z.number().int(),
  taxName: z.string().nullable(),
  taxRateBp: z.number().int(),
  taxMinor: z.number().int(),
  totalMinor: z.number().int(),
  /** Returned so far, across all returns of this sale. */
  returnedQuantity: z.string(),
  refundedMinor: z.number().int(),
  refundedTaxMinor: z.number().int(),
});
export type SaleLine = z.infer<typeof saleLineSchema>;

export const taxSummaryLineSchema = z.object({
  name: z.string().nullable(),
  rateBp: z.number().int(),
  /** Line amounts excluding tax. */
  taxableMinor: z.number().int(),
  taxMinor: z.number().int(),
});

export const saleSchema = z.object({
  id: uuidSchema,
  number: z.string(),
  status: z.enum(['COMPLETED']),
  branchId: uuidSchema,
  branchName: z.string(),
  registerId: uuidSchema,
  registerName: z.string(),
  shiftId: uuidSchema,
  shiftNumber: z.string(),
  cashierName: z.string().nullable(),
  customerId: uuidSchema.nullable(),
  customerName: z.string().nullable(),
  currency: z.string(),
  pricesIncludeTax: z.boolean(),
  discount: discountSchema.nullable(),
  subtotalMinor: z.number().int(),
  discountMinor: z.number().int(),
  taxMinor: z.number().int(),
  totalMinor: z.number().int(),
  paidMinor: z.number().int(),
  changeMinor: z.number().int(),
  /** Loyalty points earned on the sale and used to pay for it (absent from older data). */
  pointsEarned: z.number().int().optional(),
  pointsRedeemed: z.number().int().optional(),
  notes: z.string().nullable(),
  createdAt: isoDateTimeSchema,
  lines: z.array(saleLineSchema),
  payments: z.array(salePaymentSchema),
  taxSummary: z.array(taxSummaryLineSchema),
  approvedByName: z.string().nullable(),
  /** Derived from returns; the sale record itself never changes. */
  returnStatus: z.enum(['NONE', 'PARTIAL', 'FULL']),
  capturedOffline: z.boolean(),
  syncedAt: isoDateTimeSchema.nullable(),
  conflicts: z.array(
    z.object({ id: uuidSchema, type: z.enum(SALE_CONFLICT_TYPES), resolved: z.boolean() }),
  ),
  voided: z.boolean(),
  refundedMinor: z.number().int(),
  /** What may still be refunded per original payment method. */
  refundable: z.array(z.object({ method: z.enum(PAYMENT_METHODS), amountMinor: z.number().int() })),
  returns: z.array(
    z.object({
      id: uuidSchema,
      number: z.string(),
      kind: z.enum(['RETURN', 'VOID']),
      refundMinor: z.number().int(),
      createdAt: isoDateTimeSchema,
    }),
  ),
});
export type Sale = z.infer<typeof saleSchema>;
export const salePageSchema = pageSchema(saleSchema);
export type SalePage = z.infer<typeof salePageSchema>;

export const listSalesQuerySchema = z.object({
  branchId: uuidSchema.optional(),
  shiftId: uuidSchema.optional(),
  customerId: uuidSchema.optional(),
  /** Business days in the tenant's timezone, inclusive. */
  from: isoDateSchema.optional(),
  to: isoDateSchema.optional(),
  /** Sale number, exact or prefix (e.g. INV-000123). */
  q: z.string().trim().max(20).optional(),
  cursor: uuidSchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});
export type ListSalesQuery = z.input<typeof listSalesQuerySchema>;

/** Everything a printed receipt shows, including the business identity. */
export const receiptSchema = z.object({
  business: z.object({
    name: z.string(),
    legalName: z.string().nullable(),
    taxRegistrationNumber: z.string().nullable(),
    addressLines: z.array(z.string()),
    branchName: z.string(),
    branchAddress: z.string().nullable(),
    branchPhone: z.string().nullable(),
    footer: z.string().nullable(),
    timezone: z.string(),
  }),
  sale: saleSchema,
  /** The customer's points after this sale (now), when the sale had a customer and loyalty is on. */
  loyaltyBalance: z.number().int().nullable().optional(),
});
export type Receipt = z.infer<typeof receiptSchema>;
