import { z } from 'zod';
import { isoDateTimeSchema, pageSchema, uuidSchema } from './common';
import { SALE_CONFLICT_TYPES } from './sales';

/* Catalogue sync ------------------------------------------------------------ */

/**
 * Everything a till needs to sell an item without a connection. Archived items
 * are included (inactive) so devices drop them from their copy.
 */
export const catalogItemSchema = z.object({
  variantId: uuidSchema,
  productId: uuidSchema,
  productName: z.string(),
  brand: z.string().nullable(),
  sku: z.string(),
  barcode: z.string().nullable(),
  variantLabel: z.string(),
  unit: z.string(),
  priceMinor: z.number().int(),
  taxRateId: uuidSchema.nullable(),
  active: z.boolean(),
  /** Thumbnail of the product's main image; a stable link that devices may cache. */
  imageUrl: z.url().nullable().optional(),
});
export type CatalogItem = z.infer<typeof catalogItemSchema>;

/** Changes since `cursor` (opaque), oldest first. Keep calling with nextCursor until it is null. */
export const catalogSyncQuerySchema = z.object({
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(1000).default(500),
});
export type CatalogSyncQuery = z.input<typeof catalogSyncQuerySchema>;

export const catalogSyncPageSchema = z.object({
  items: z.array(catalogItemSchema),
  /** Cursor to resume from next time, also when this page was the last one. */
  cursor: z.string().nullable(),
  hasMore: z.boolean(),
});
export type CatalogSyncPage = z.infer<typeof catalogSyncPageSchema>;

/* Conflicts from offline sales -------------------------------------------- */

export const saleConflictSchema = z.object({
  id: uuidSchema,
  type: z.enum(SALE_CONFLICT_TYPES),
  detail: z.record(z.string(), z.unknown()),
  saleId: uuidSchema,
  saleNumber: z.string(),
  branchName: z.string(),
  cashierName: z.string().nullable(),
  saleTotalMinor: z.number().int(),
  capturedAt: isoDateTimeSchema,
  createdAt: isoDateTimeSchema,
  resolvedAt: isoDateTimeSchema.nullable(),
  resolvedByName: z.string().nullable(),
  resolutionNote: z.string().nullable(),
});
export type SaleConflict = z.infer<typeof saleConflictSchema>;
export const saleConflictPageSchema = pageSchema(saleConflictSchema);
export type SaleConflictPage = z.infer<typeof saleConflictPageSchema>;

export const listConflictsQuerySchema = z.object({
  status: z.enum(['OPEN', 'RESOLVED', 'ALL']).default('OPEN'),
  cursor: uuidSchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});
export type ListConflictsQuery = z.input<typeof listConflictsQuerySchema>;

export const resolveConflictRequestSchema = z.object({
  note: z
    .string({ error: 'validation.required' })
    .trim()
    .min(1, { error: 'validation.required' })
    .max(500, { error: 'validation.text.too_long' }),
});
export type ResolveConflictRequest = z.input<typeof resolveConflictRequestSchema>;
