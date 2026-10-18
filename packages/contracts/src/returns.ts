import { z } from 'zod';
import { PAYMENT_METHODS } from '@pos/domain';
import { approvalSchema, reasonSchema } from './approvals';
import { isoDateTimeSchema, pageSchema, uuidSchema } from './common';
import { positiveQuantitySchema } from './inventory';
import { paymentRequestSchema } from './sales';

/* Returns and voids -------------------------------------------------------- */

export const createReturnRequestSchema = z
  .object({
    /** Client-generated; a retry returns the original return. */
    id: uuidSchema,
    /** The cashier's open shift: cash refunds come out of its drawer. */
    shiftId: uuidSchema,
    reason: reasonSchema,
    lines: z
      .array(
        z.object({
          saleLineId: uuidSchema,
          quantity: positiveQuantitySchema,
          /** False for damaged items that cannot be resold. */
          restock: z.boolean().default(true),
        }),
      )
      .min(1, { error: 'validation.lines.required' })
      .max(200, { error: 'validation.lines.too_many' }),
    refunds: z.array(paymentRequestSchema).max(10, { error: 'validation.payment.too_many' }),
    approval: approvalSchema.optional(),
  })
  .superRefine((value, ctx) => {
    const seen = new Set<string>();
    value.lines.forEach((line, index) => {
      if (seen.has(line.saleLineId))
        ctx.addIssue({
          code: 'custom',
          path: ['lines', index, 'saleLineId'],
          message: 'validation.lines.duplicate_item',
        });
      seen.add(line.saleLineId);
    });
  });
export type CreateReturnRequest = z.input<typeof createReturnRequestSchema>;

/** Voids the whole sale in its own, still-open shift; refunds mirror the original payments. */
export const voidSaleRequestSchema = z.object({
  id: uuidSchema,
  reason: reasonSchema,
  approval: approvalSchema.optional(),
});
export type VoidSaleRequest = z.input<typeof voidSaleRequestSchema>;

export const RETURN_KINDS = ['RETURN', 'VOID'] as const;

const refundSchema = z.object({
  method: z.enum(PAYMENT_METHODS),
  amountMinor: z.number().int(),
  reference: z.string().nullable(),
});

export const saleReturnSchema = z.object({
  id: uuidSchema,
  number: z.string(),
  kind: z.enum(RETURN_KINDS),
  saleId: uuidSchema,
  saleNumber: z.string(),
  shiftId: uuidSchema,
  shiftNumber: z.string(),
  branchName: z.string(),
  registerName: z.string(),
  cashierName: z.string().nullable(),
  approvedByName: z.string().nullable(),
  reason: z.string(),
  refundMinor: z.number().int(),
  taxMinor: z.number().int(),
  createdAt: isoDateTimeSchema,
  lines: z.array(
    z.object({
      saleLineId: uuidSchema,
      variantId: uuidSchema,
      productName: z.string(),
      sku: z.string(),
      variantLabel: z.string(),
      unit: z.string(),
      quantity: z.string(),
      restock: z.boolean(),
      refundMinor: z.number().int(),
      taxMinor: z.number().int(),
    }),
  ),
  refunds: z.array(refundSchema),
});
export type SaleReturn = z.infer<typeof saleReturnSchema>;
export const saleReturnPageSchema = pageSchema(saleReturnSchema);
export type SaleReturnPage = z.infer<typeof saleReturnPageSchema>;

export const listReturnsQuerySchema = z.object({
  saleId: uuidSchema.optional(),
  shiftId: uuidSchema.optional(),
  cursor: uuidSchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});
export type ListReturnsQuery = z.input<typeof listReturnsQuerySchema>;

export const saleLookupQuerySchema = z.object({
  number: z.string().trim().min(1, { error: 'validation.required' }).max(20),
});
