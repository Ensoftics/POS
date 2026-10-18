import { z } from 'zod';

/**
 * Validation messages are i18n keys (e.g. `validation.required`) so that every
 * client can render them in English, Sinhala or Tamil.
 */
export const emailSchema = z
  .string({ error: 'validation.required' })
  .trim()
  .toLowerCase()
  .min(1, { error: 'validation.required' })
  .max(254, { error: 'validation.email.invalid' })
  .pipe(z.email({ error: 'validation.email.invalid' }));

export const uuidSchema = z.uuid({ error: 'validation.uuid.invalid' });

export const isoDateTimeSchema = z.string();

export const paginationQuerySchema = z.object({
  cursor: uuidSchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});
export type PaginationQuery = z.output<typeof paginationQuerySchema>;

export function pageSchema<T extends z.ZodType>(item: T) {
  return z.object({
    items: z.array(item),
    nextCursor: z.string().nullable(),
  });
}
export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}
