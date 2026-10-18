import { z } from 'zod';
import {
  checkBarcode,
  MAX_MINOR_UNITS,
  normaliseBarcode,
  UNIT_CODES,
  VARIANT_ATTRIBUTES,
  variantAttributesKey,
} from '@pos/domain';
import { isoDateTimeSchema, pageSchema, uuidSchema } from './common';
import { LOCATION_STATUSES } from './locations';

export const CATALOG_STATUSES = LOCATION_STATUSES; // ACTIVE | ARCHIVED

const nullableText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, { error: 'validation.text.too_long' })
    .transform((value) => (value === '' ? null : value))
    .nullable()
    .optional();

const nameSchema = z
  .string({ error: 'validation.required' })
  .trim()
  .min(1, { error: 'validation.required' })
  .max(120, { error: 'validation.text.too_long' });

/* Categories ------------------------------------------------------------- */

export const categorySchema = z.object({
  id: uuidSchema,
  name: z.string(),
  parentId: uuidSchema.nullable(),
  status: z.enum(CATALOG_STATUSES),
  version: z.number().int(),
});
export type Category = z.infer<typeof categorySchema>;
export const categoryListSchema = z.object({ items: z.array(categorySchema) });
export type CategoryList = z.infer<typeof categoryListSchema>;

export const createCategoryRequestSchema = z.object({
  name: nameSchema.max(60, { error: 'validation.text.too_long' }),
  parentId: uuidSchema.nullable().optional(),
});
export type CreateCategoryRequest = z.input<typeof createCategoryRequestSchema>;

export const updateCategoryRequestSchema = z.object({
  version: z.number().int().min(1),
  name: nameSchema.max(60, { error: 'validation.text.too_long' }).optional(),
  parentId: uuidSchema.nullable().optional(),
  status: z.enum(CATALOG_STATUSES).optional(),
});
export type UpdateCategoryRequest = z.input<typeof updateCategoryRequestSchema>;

/* Variants --------------------------------------------------------------- */

/** Money crosses the API as integer minor units of the tenant currency. */
export const moneyMinorSchema = z
  .number({ error: 'validation.money.invalid' })
  .int({ error: 'validation.money.invalid' })
  .min(0, { error: 'validation.money.negative' })
  .max(MAX_MINOR_UNITS, { error: 'validation.money.too_large' });

/** Quantities cross the API as decimal strings with up to 3 decimals. */
export const quantitySchema = z
  .string()
  .trim()
  .regex(/^\d{1,9}(\.\d{1,3})?$/, { error: 'validation.quantity.invalid' });

export const skuSchema = z
  .string({ error: 'validation.required' })
  .trim()
  .toUpperCase()
  .regex(/^[A-Z0-9][A-Z0-9._\-/]{0,39}$/, { error: 'validation.sku.invalid' });

export const barcodeSchema = z
  .string()
  .transform(normaliseBarcode)
  .superRefine((value, ctx) => {
    const issue = checkBarcode(value);
    if (issue) ctx.addIssue({ code: 'custom', message: `validation.barcode.${issue}` });
  });

const nullableBarcode = z
  .union([z.literal(''), barcodeSchema])
  .transform((value) => (value === '' ? null : value))
  .nullable()
  .optional();

export const variantAttributesSchema = z.partialRecord(
  z.enum(VARIANT_ATTRIBUTES, { error: 'validation.attribute.unknown' }),
  z
    .string()
    .trim()
    .min(1, { error: 'validation.required' })
    .max(40, { error: 'validation.text.too_long' }),
);
export type VariantAttributesDto = z.infer<typeof variantAttributesSchema>;

const variantFields = {
  sku: skuSchema,
  barcode: nullableBarcode,
  attributes: variantAttributesSchema.default({}),
  priceMinor: moneyMinorSchema,
  costMinor: moneyMinorSchema.nullable().optional(),
  packSize: z.number().int().min(1).max(10_000).nullable().optional(),
  reorderLevel: quantitySchema.nullable().optional(),
};

export const variantInputSchema = z.object(variantFields);
export type VariantInput = z.input<typeof variantInputSchema>;

export const variantSchema = z.object({
  id: uuidSchema,
  productId: uuidSchema,
  sku: z.string(),
  barcode: z.string().nullable(),
  attributes: variantAttributesSchema,
  priceMinor: z.number().int(),
  /** Null for roles that may not see costs (cashiers), or when not set. */
  costMinor: z.number().int().nullable(),
  packSize: z.number().int().nullable(),
  reorderLevel: z.string().nullable(),
  status: z.enum(CATALOG_STATUSES),
  version: z.number().int(),
});
export type Variant = z.infer<typeof variantSchema>;

export const createVariantRequestSchema = variantInputSchema.extend({ productId: uuidSchema });
export type CreateVariantRequest = z.input<typeof createVariantRequestSchema>;

export const updateVariantRequestSchema = z.object({
  version: z.number().int().min(1),
  sku: variantFields.sku.optional(),
  barcode: variantFields.barcode,
  attributes: variantAttributesSchema.optional(),
  priceMinor: variantFields.priceMinor.optional(),
  costMinor: variantFields.costMinor,
  packSize: variantFields.packSize,
  reorderLevel: variantFields.reorderLevel,
  status: z.enum(CATALOG_STATUSES).optional(),
});
export type UpdateVariantRequest = z.input<typeof updateVariantRequestSchema>;

/* Product images ---------------------------------------------------------- */

export const MAX_PRODUCT_IMAGES = 8;
/** Accepted upload types; every image is re-encoded to WebP with its metadata removed. */
export const PRODUCT_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;

/** Links are stable for an image and work without a sign-in header (e.g. in <img>). */
export const productImageSchema = z.object({
  id: uuidSchema,
  /** Up to 1600 px on the longest side. */
  url: z.url(),
  /** Up to 400 px on the longest side, for lists and the till. */
  thumbUrl: z.url(),
  width: z.number().int(),
  height: z.number().int(),
});
export type ProductImage = z.infer<typeof productImageSchema>;

/** The new order of all of a product's images; the first is the main image. */
export const reorderProductImagesRequestSchema = z.object({
  imageIds: z.array(uuidSchema).min(1).max(MAX_PRODUCT_IMAGES),
});
export type ReorderProductImagesRequest = z.input<typeof reorderProductImagesRequestSchema>;

/* Products --------------------------------------------------------------- */

export const productSchema = z.object({
  id: uuidSchema,
  name: z.string(),
  brand: z.string().nullable(),
  description: z.string().nullable(),
  unit: z.enum(UNIT_CODES),
  categoryId: uuidSchema.nullable(),
  categoryName: z.string().nullable(),
  /** Null: the tenant's default tax rate applies. */
  taxRateId: uuidSchema.nullable(),
  status: z.enum(CATALOG_STATUSES),
  version: z.number().int(),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
  variants: z.array(variantSchema),
  /** In display order; the first is the main image. */
  images: z.array(productImageSchema).optional(),
});
export type Product = z.infer<typeof productSchema>;
export const productPageSchema = pageSchema(productSchema);
export type ProductPage = z.infer<typeof productPageSchema>;

export const listProductsQuerySchema = z.object({
  q: z.string().trim().max(100).optional(),
  categoryId: uuidSchema.optional(),
  status: z.enum(['ACTIVE', 'ARCHIVED', 'ALL']).default('ACTIVE'),
  cursor: uuidSchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});
export type ListProductsQuery = z.input<typeof listProductsQuerySchema>;

function addDuplicateIssues(
  variants: Array<z.output<typeof variantInputSchema>>,
  ctx: z.RefinementCtx,
) {
  const seen = {
    sku: new Map<string, number>(),
    barcode: new Map<string, number>(),
    combo: new Map<string, number>(),
  };
  variants.forEach((variant, index) => {
    const checks: Array<[keyof typeof seen, string | null | undefined, string, string]> = [
      ['sku', variant.sku, 'sku', 'validation.sku.duplicate'],
      ['barcode', variant.barcode, 'barcode', 'validation.barcode.duplicate'],
      [
        'combo',
        variantAttributesKey(variant.attributes),
        'attributes',
        'validation.attribute.duplicate_combination',
      ],
    ];
    for (const [kind, value, field, message] of checks) {
      if (value === null || value === undefined) continue;
      if (seen[kind].has(value))
        ctx.addIssue({ code: 'custom', path: ['variants', index, field], message });
      else seen[kind].set(value, index);
    }
  });
}

export const createProductRequestSchema = z
  .object({
    name: nameSchema,
    brand: nullableText(60),
    description: nullableText(1000),
    unit: z.enum(UNIT_CODES, { error: 'validation.unit.invalid' }),
    categoryId: uuidSchema.nullable().optional(),
    taxRateId: uuidSchema.nullable().optional(),
    variants: z
      .array(variantInputSchema)
      .min(1, { error: 'validation.variants.required' })
      .max(200, { error: 'validation.variants.too_many' }),
  })
  .superRefine((value, ctx) => addDuplicateIssues(value.variants, ctx));
export type CreateProductRequest = z.input<typeof createProductRequestSchema>;

export const updateProductRequestSchema = z.object({
  version: z.number().int().min(1),
  name: nameSchema.optional(),
  brand: nullableText(60),
  description: nullableText(1000),
  unit: z.enum(UNIT_CODES, { error: 'validation.unit.invalid' }).optional(),
  categoryId: uuidSchema.nullable().optional(),
  taxRateId: uuidSchema.nullable().optional(),
  status: z.enum(CATALOG_STATUSES).optional(),
});
export type UpdateProductRequest = z.input<typeof updateProductRequestSchema>;

/* Lookup (barcode-first checkout) ---------------------------------------- */

export const lookupQuerySchema = z.object({
  code: z.string().trim().min(1, { error: 'validation.required' }).max(48),
});
export const variantLookupSchema = z.object({ product: productSchema, variant: variantSchema });
export type VariantLookup = z.infer<typeof variantLookupSchema>;

/* CSV import -------------------------------------------------------------- */

export const MAX_IMPORT_ROWS = 5000;
export const MAX_IMPORT_BYTES = 5_000_000;

/**
 * Columns: product_name, category, brand, unit, sku, barcode, price, cost,
 * pack_size, reorder_level, status, and one `attr:<name>` column per variant attribute.
 * One row per variant; rows with the same product_name (and category) form one product.
 */
export const PRODUCT_CSV_COLUMNS = [
  'product_name',
  'category',
  'brand',
  'unit',
  'sku',
  'barcode',
  'price',
  'cost',
  'pack_size',
  'reorder_level',
  'status',
] as const;

export const productImportRequestSchema = z.object({
  csv: z
    .string()
    .min(1, { error: 'validation.required' })
    .max(MAX_IMPORT_BYTES, { error: 'validation.import.too_large' }),
  /** Validate only; nothing is written. The client shows the report, then repeats with false. */
  dryRun: z.boolean().default(true),
});
export type ProductImportRequest = z.input<typeof productImportRequestSchema>;

export const importIssueSchema = z.object({
  /** 1-based line number in the file (the header is line 1). */
  row: z.number().int(),
  column: z.string().nullable(),
  message: z.string(),
});
export type ImportIssue = z.infer<typeof importIssueSchema>;

export const productImportResultSchema = z.object({
  dryRun: z.boolean(),
  applied: z.boolean(),
  rows: z.number().int(),
  productsCreated: z.number().int(),
  variantsCreated: z.number().int(),
  variantsUpdated: z.number().int(),
  errors: z.array(importIssueSchema),
});
export type ProductImportResult = z.infer<typeof productImportResultSchema>;
