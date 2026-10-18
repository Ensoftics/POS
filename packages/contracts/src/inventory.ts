import { z } from 'zod';
import { ADJUSTMENT_REASONS, DECREASE_ONLY_REASONS, MOVEMENT_TYPES } from '@pos/domain';
import { isoDateTimeSchema, pageSchema, uuidSchema } from './common';
import { moneyMinorSchema } from './catalog';
import { phoneSchema } from './tenant';
import { emailSchema } from './common';

/* Shared ------------------------------------------------------------------ */

const QUANTITY = /^\d{1,9}(\.\d{1,3})?$/;
const SIGNED_QUANTITY = /^-?\d{1,9}(\.\d{1,3})?$/;

/** Strictly positive decimal string, e.g. "12" or "2.5". */
export const positiveQuantitySchema = z
  .string({ error: 'validation.required' })
  .trim()
  .regex(QUANTITY, { error: 'validation.quantity.invalid' })
  .refine((value) => Number(value) > 0, { error: 'validation.quantity.positive' });

/** Signed, non-zero decimal string for adjustments, e.g. "-3" or "1.5". */
export const signedQuantitySchema = z
  .string({ error: 'validation.required' })
  .trim()
  .regex(SIGNED_QUANTITY, { error: 'validation.quantity.invalid' })
  .refine((value) => Number(value) !== 0, { error: 'validation.quantity.non_zero' });

/** Zero or positive decimal string (stock counts). */
export const countQuantitySchema = z
  .string()
  .trim()
  .regex(QUANTITY, { error: 'validation.quantity.invalid' });

export const isoDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, { error: 'validation.date.invalid' })
  .refine((value) => !Number.isNaN(Date.parse(`${value}T00:00:00Z`)), {
    error: 'validation.date.invalid',
  });

const nullableText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, { error: 'validation.text.too_long' })
    .transform((value) => (value === '' ? null : value))
    .nullable()
    .optional();

/** Describes the item on document lines so clients need no extra lookups. */
const itemFields = {
  variantId: uuidSchema,
  productName: z.string(),
  sku: z.string(),
  /** e.g. "White / M"; empty for single-variant products. */
  variantLabel: z.string(),
  /** Unit code of the product (piece, metre, ...). */
  unit: z.string(),
};

const RECORD_STATUSES = ['ACTIVE', 'ARCHIVED'] as const;

/* Suppliers ---------------------------------------------------------------- */

export const supplierSchema = z.object({
  id: uuidSchema,
  name: z.string(),
  contactName: z.string().nullable(),
  phone: z.string().nullable(),
  email: z.string().nullable(),
  address: z.string().nullable(),
  taxNumber: z.string().nullable(),
  notes: z.string().nullable(),
  status: z.enum(RECORD_STATUSES),
  version: z.number().int(),
});
export type Supplier = z.infer<typeof supplierSchema>;
export const supplierPageSchema = pageSchema(supplierSchema);
export type SupplierPage = z.infer<typeof supplierPageSchema>;

const supplierFields = {
  name: z
    .string({ error: 'validation.required' })
    .trim()
    .min(1, { error: 'validation.required' })
    .max(120, { error: 'validation.text.too_long' }),
  contactName: nullableText(120),
  phone: z
    .union([z.literal(''), phoneSchema])
    .transform((value) => (value === '' ? null : value))
    .nullable()
    .optional(),
  email: z
    .union([z.literal(''), emailSchema])
    .transform((value) => (value === '' ? null : value))
    .nullable()
    .optional(),
  address: nullableText(300),
  taxNumber: nullableText(40),
  notes: nullableText(1000),
};

export const createSupplierRequestSchema = z.object(supplierFields);
export type CreateSupplierRequest = z.input<typeof createSupplierRequestSchema>;

export const updateSupplierRequestSchema = z.object({
  version: z.number().int().min(1),
  ...supplierFields,
  name: supplierFields.name.optional(),
  status: z.enum(RECORD_STATUSES).optional(),
});
export type UpdateSupplierRequest = z.input<typeof updateSupplierRequestSchema>;

export const listSuppliersQuerySchema = z.object({
  q: z.string().trim().max(100).optional(),
  status: z.enum(['ACTIVE', 'ARCHIVED', 'ALL']).default('ACTIVE'),
  cursor: uuidSchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

/* Purchase orders ----------------------------------------------------------- */

export const PURCHASE_ORDER_STATUSES = [
  'DRAFT',
  'ORDERED',
  'PARTIALLY_RECEIVED',
  'RECEIVED',
  'CANCELLED',
] as const;
export type PurchaseOrderStatus = (typeof PURCHASE_ORDER_STATUSES)[number];

export const purchaseOrderLineSchema = z.object({
  id: uuidSchema,
  ...itemFields,
  quantityOrdered: z.string(),
  quantityReceived: z.string(),
  unitCostMinor: z.number().int(),
});

export const purchaseOrderSchema = z.object({
  id: uuidSchema,
  number: z.string(),
  supplierId: uuidSchema,
  supplierName: z.string(),
  branchId: uuidSchema,
  branchName: z.string(),
  status: z.enum(PURCHASE_ORDER_STATUSES),
  expectedDate: z.string().nullable(),
  notes: z.string().nullable(),
  totalMinor: z.number().int(),
  version: z.number().int(),
  createdAt: isoDateTimeSchema,
  orderedAt: isoDateTimeSchema.nullable(),
  lines: z.array(purchaseOrderLineSchema),
});
export type PurchaseOrder = z.infer<typeof purchaseOrderSchema>;
export const purchaseOrderPageSchema = pageSchema(purchaseOrderSchema);
export type PurchaseOrderPage = z.infer<typeof purchaseOrderPageSchema>;

const orderLineInput = z.object({
  variantId: uuidSchema,
  quantity: positiveQuantitySchema,
  unitCostMinor: moneyMinorSchema,
});

function noDuplicateVariants(lines: Array<{ variantId: string }>, ctx: z.RefinementCtx) {
  const seen = new Set<string>();
  lines.forEach((line, index) => {
    if (seen.has(line.variantId)) {
      ctx.addIssue({
        code: 'custom',
        path: ['lines', index, 'variantId'],
        message: 'validation.lines.duplicate_item',
      });
    }
    seen.add(line.variantId);
  });
}

export const createPurchaseOrderRequestSchema = z
  .object({
    supplierId: uuidSchema,
    branchId: uuidSchema,
    expectedDate: isoDateSchema.nullable().optional(),
    notes: nullableText(1000),
    lines: z
      .array(orderLineInput)
      .min(1, { error: 'validation.lines.required' })
      .max(500, { error: 'validation.lines.too_many' }),
  })
  .superRefine((value, ctx) => noDuplicateVariants(value.lines, ctx));
export type CreatePurchaseOrderRequest = z.input<typeof createPurchaseOrderRequestSchema>;

/** Drafts only. `lines`, when sent, replaces all lines. */
export const updatePurchaseOrderRequestSchema = z
  .object({
    version: z.number().int().min(1),
    supplierId: uuidSchema.optional(),
    branchId: uuidSchema.optional(),
    expectedDate: isoDateSchema.nullable().optional(),
    notes: nullableText(1000),
    lines: z
      .array(orderLineInput)
      .min(1, { error: 'validation.lines.required' })
      .max(500, { error: 'validation.lines.too_many' })
      .optional(),
  })
  .superRefine((value, ctx) => value.lines && noDuplicateVariants(value.lines, ctx));
export type UpdatePurchaseOrderRequest = z.input<typeof updatePurchaseOrderRequestSchema>;

export const listPurchaseOrdersQuerySchema = z.object({
  status: z.enum(PURCHASE_ORDER_STATUSES).optional(),
  supplierId: uuidSchema.optional(),
  cursor: uuidSchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});

export const versionOnlyRequestSchema = z.object({ version: z.number().int().min(1) });
export type VersionOnlyRequest = z.input<typeof versionOnlyRequestSchema>;

/* Goods receipts ----------------------------------------------------------- */

export const goodsReceiptLineSchema = z.object({
  id: uuidSchema,
  ...itemFields,
  quantity: z.string(),
  unitCostMinor: z.number().int(),
  batchNumber: z.string().nullable(),
  expiryDate: z.string().nullable(),
});

export const goodsReceiptSchema = z.object({
  id: uuidSchema,
  number: z.string(),
  branchId: uuidSchema,
  branchName: z.string(),
  supplierId: uuidSchema.nullable(),
  supplierName: z.string().nullable(),
  purchaseOrderId: uuidSchema.nullable(),
  purchaseOrderNumber: z.string().nullable(),
  supplierReference: z.string().nullable(),
  notes: z.string().nullable(),
  totalMinor: z.number().int(),
  createdAt: isoDateTimeSchema,
  createdByName: z.string().nullable(),
  lines: z.array(goodsReceiptLineSchema),
});
export type GoodsReceipt = z.infer<typeof goodsReceiptSchema>;
export const goodsReceiptPageSchema = pageSchema(goodsReceiptSchema);
export type GoodsReceiptPage = z.infer<typeof goodsReceiptPageSchema>;

export const createGoodsReceiptRequestSchema = z.object({
  /** Client-generated; re-sending the same id returns the original receipt (idempotent). */
  id: uuidSchema,
  branchId: uuidSchema,
  supplierId: uuidSchema.nullable().optional(),
  purchaseOrderId: uuidSchema.nullable().optional(),
  supplierReference: nullableText(60),
  notes: nullableText(1000),
  lines: z
    .array(
      z.object({
        variantId: uuidSchema,
        quantity: positiveQuantitySchema,
        unitCostMinor: moneyMinorSchema,
        batchNumber: nullableText(40),
        expiryDate: isoDateSchema.nullable().optional(),
      }),
    )
    .min(1, { error: 'validation.lines.required' })
    .max(500, { error: 'validation.lines.too_many' }),
});
export type CreateGoodsReceiptRequest = z.input<typeof createGoodsReceiptRequestSchema>;

/* Stock levels and movements ---------------------------------------------- */

export const stockBatchSchema = z.object({
  batchId: uuidSchema.nullable(),
  batchNumber: z.string().nullable(),
  expiryDate: z.string().nullable(),
  quantity: z.string(),
});

export const stockRowSchema = z.object({
  ...itemFields,
  productId: uuidSchema,
  barcode: z.string().nullable(),
  quantity: z.string(),
  reorderLevel: z.string().nullable(),
  /** At or below the reorder level. */
  low: z.boolean(),
  /** Earliest expiry date among batches with stock, if any. */
  nextExpiry: z.string().nullable(),
  batches: z.array(stockBatchSchema),
});
export type StockRow = z.infer<typeof stockRowSchema>;
export const stockPageSchema = pageSchema(stockRowSchema);
export type StockPage = z.infer<typeof stockPageSchema>;

export const listStockQuerySchema = z.object({
  branchId: uuidSchema,
  q: z.string().trim().max(100).optional(),
  filter: z.enum(['ALL', 'IN_STOCK', 'LOW', 'EXPIRING']).default('ALL'),
  /** For filter=EXPIRING. */
  days: z.coerce.number().int().min(0).max(365).default(30),
  cursor: uuidSchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export type ListStockQuery = z.input<typeof listStockQuerySchema>;

export const stockMovementSchema = z.object({
  id: uuidSchema,
  type: z.enum(MOVEMENT_TYPES),
  quantity: z.string(),
  balanceAfter: z.string(),
  branchId: uuidSchema,
  branchName: z.string(),
  ...itemFields,
  batchNumber: z.string().nullable(),
  referenceType: z.string(),
  referenceId: uuidSchema,
  referenceNumber: z.string().nullable(),
  unitCostMinor: z.number().int().nullable(),
  reason: z.string().nullable(),
  actorName: z.string().nullable(),
  createdAt: isoDateTimeSchema,
});
export type StockMovement = z.infer<typeof stockMovementSchema>;
export const stockMovementPageSchema = pageSchema(stockMovementSchema);
export type StockMovementPage = z.infer<typeof stockMovementPageSchema>;

export const listMovementsQuerySchema = z.object({
  variantId: uuidSchema.optional(),
  branchId: uuidSchema.optional(),
  cursor: uuidSchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export type ListMovementsQuery = z.input<typeof listMovementsQuerySchema>;

/* Adjustments ------------------------------------------------------------- */

export const stockAdjustmentSchema = z.object({
  id: uuidSchema,
  number: z.string(),
  branchId: uuidSchema,
  branchName: z.string(),
  reason: z.enum(ADJUSTMENT_REASONS),
  notes: z.string().nullable(),
  createdAt: isoDateTimeSchema,
  createdByName: z.string().nullable(),
  lines: z.array(
    z.object({ ...itemFields, batchNumber: z.string().nullable(), quantity: z.string() }),
  ),
});
export type StockAdjustment = z.infer<typeof stockAdjustmentSchema>;
export const stockAdjustmentPageSchema = pageSchema(stockAdjustmentSchema);
export type StockAdjustmentPage = z.infer<typeof stockAdjustmentPageSchema>;

export const createStockAdjustmentRequestSchema = z
  .object({
    id: uuidSchema,
    branchId: uuidSchema,
    reason: z.enum(ADJUSTMENT_REASONS, { error: 'validation.adjustment.reason' }),
    notes: nullableText(1000),
    lines: z
      .array(
        z.object({
          variantId: uuidSchema,
          /** Omit to let the server take expiring batches first (decreases only). */
          batchId: uuidSchema.nullable().optional(),
          quantity: signedQuantitySchema,
        }),
      )
      .min(1, { error: 'validation.lines.required' })
      .max(500, { error: 'validation.lines.too_many' }),
  })
  .superRefine((value, ctx) => {
    value.lines.forEach((line, index) => {
      const negative = line.quantity.startsWith('-');
      if (DECREASE_ONLY_REASONS.includes(value.reason) && !negative) {
        ctx.addIssue({
          code: 'custom',
          path: ['lines', index, 'quantity'],
          message: 'validation.adjustment.must_decrease',
        });
      }
      if (value.reason === 'FOUND' && negative) {
        ctx.addIssue({
          code: 'custom',
          path: ['lines', index, 'quantity'],
          message: 'validation.adjustment.must_increase',
        });
      }
    });
  });
export type CreateStockAdjustmentRequest = z.input<typeof createStockAdjustmentRequestSchema>;

/* Transfers --------------------------------------------------------------- */

export const TRANSFER_STATUSES = ['IN_TRANSIT', 'RECEIVED', 'CANCELLED'] as const;

export const stockTransferSchema = z.object({
  id: uuidSchema,
  number: z.string(),
  fromBranchId: uuidSchema,
  fromBranchName: z.string(),
  toBranchId: uuidSchema,
  toBranchName: z.string(),
  status: z.enum(TRANSFER_STATUSES),
  notes: z.string().nullable(),
  version: z.number().int(),
  createdAt: isoDateTimeSchema,
  receivedAt: isoDateTimeSchema.nullable(),
  lines: z.array(
    z.object({
      ...itemFields,
      batchNumber: z.string().nullable(),
      expiryDate: z.string().nullable(),
      quantity: z.string(),
    }),
  ),
});
export type StockTransfer = z.infer<typeof stockTransferSchema>;
export const stockTransferPageSchema = pageSchema(stockTransferSchema);
export type StockTransferPage = z.infer<typeof stockTransferPageSchema>;

export const createStockTransferRequestSchema = z
  .object({
    id: uuidSchema,
    fromBranchId: uuidSchema,
    toBranchId: uuidSchema,
    notes: nullableText(1000),
    lines: z
      .array(z.object({ variantId: uuidSchema, quantity: positiveQuantitySchema }))
      .min(1, { error: 'validation.lines.required' })
      .max(500, { error: 'validation.lines.too_many' }),
  })
  .superRefine((value, ctx) => {
    if (value.fromBranchId === value.toBranchId) {
      ctx.addIssue({
        code: 'custom',
        path: ['toBranchId'],
        message: 'validation.transfer.same_branch',
      });
    }
    noDuplicateVariants(value.lines, ctx);
  });
export type CreateStockTransferRequest = z.input<typeof createStockTransferRequestSchema>;

/* Stock counts ------------------------------------------------------------ */

export const COUNT_STATUSES = ['OPEN', 'COMPLETED', 'CANCELLED'] as const;

export const stockCountLineSchema = z.object({
  ...itemFields,
  batchId: uuidSchema.nullable(),
  batchNumber: z.string().nullable(),
  /** System quantity when the line was created (for reference only). */
  expectedQuantity: z.string(),
  countedQuantity: z.string().nullable(),
  /** Correction actually posted on completion (counted minus stock at that moment). */
  varianceQuantity: z.string().nullable(),
});

export const stockCountSchema = z.object({
  id: uuidSchema,
  number: z.string(),
  branchId: uuidSchema,
  branchName: z.string(),
  status: z.enum(COUNT_STATUSES),
  notes: z.string().nullable(),
  version: z.number().int(),
  createdAt: isoDateTimeSchema,
  completedAt: isoDateTimeSchema.nullable(),
  lines: z.array(stockCountLineSchema),
});
export type StockCount = z.infer<typeof stockCountSchema>;
export const stockCountPageSchema = pageSchema(
  stockCountSchema.omit({ lines: true }).extend({
    lineCount: z.number().int(),
  }),
);
export type StockCountPage = z.infer<typeof stockCountPageSchema>;

export const createStockCountRequestSchema = z.object({
  branchId: uuidSchema,
  notes: nullableText(1000),
});
export type CreateStockCountRequest = z.input<typeof createStockCountRequestSchema>;

export const updateStockCountRequestSchema = z.object({
  version: z.number().int().min(1),
  /** Upserts by (variantId, batchId); null clears a count. Unknown items are added. */
  lines: z
    .array(
      z.object({
        variantId: uuidSchema,
        batchId: uuidSchema.nullable().optional(),
        countedQuantity: countQuantitySchema.nullable(),
      }),
    )
    .min(1)
    .max(1000),
});
export type UpdateStockCountRequest = z.input<typeof updateStockCountRequestSchema>;

export const listDocumentsQuerySchema = z.object({
  branchId: uuidSchema.optional(),
  status: z.string().max(30).optional(),
  cursor: uuidSchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});
export type ListDocumentsQuery = z.input<typeof listDocumentsQuerySchema>;
