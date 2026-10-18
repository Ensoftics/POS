import { z } from 'zod';
import { LOCATION_CODE_PATTERN, normaliseLocationCode } from '@pos/domain';
import { isoDateTimeSchema, uuidSchema } from './common';
import { phoneSchema } from './tenant';

export const LOCATION_STATUSES = ['ACTIVE', 'ARCHIVED'] as const;
export type LocationStatus = (typeof LOCATION_STATUSES)[number];

export const locationCodeSchema = z
  .string({ error: 'validation.required' })
  .transform(normaliseLocationCode)
  .pipe(z.string().regex(LOCATION_CODE_PATTERN, { error: 'validation.code.invalid' }));

const locationNameSchema = z
  .string({ error: 'validation.required' })
  .trim()
  .min(2, { error: 'validation.name.too_short' })
  .max(80, { error: 'validation.text.too_long' });

const nullableText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, { error: 'validation.text.too_long' })
    .transform((value) => (value === '' ? null : value))
    .nullable()
    .optional();

const nullablePhone = z
  .union([z.literal(''), phoneSchema])
  .transform((value) => (value === '' ? null : value))
  .nullable()
  .optional();

export const registerSchema = z.object({
  id: uuidSchema,
  branchId: uuidSchema,
  code: z.string(),
  name: z.string(),
  status: z.enum(LOCATION_STATUSES),
  version: z.number().int(),
  createdAt: isoDateTimeSchema,
});
export type Register = z.infer<typeof registerSchema>;

export const branchSchema = z.object({
  id: uuidSchema,
  code: z.string(),
  name: z.string(),
  addressLine1: z.string().nullable(),
  city: z.string().nullable(),
  phone: z.string().nullable(),
  status: z.enum(LOCATION_STATUSES),
  version: z.number().int(),
  createdAt: isoDateTimeSchema,
  registers: z.array(registerSchema),
});
export type Branch = z.infer<typeof branchSchema>;

export const branchListSchema = z.object({ items: z.array(branchSchema) });
export type BranchList = z.infer<typeof branchListSchema>;

export const listBranchesQuerySchema = z.object({
  includeArchived: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),
});

export const createBranchRequestSchema = z.object({
  code: locationCodeSchema,
  name: locationNameSchema,
  addressLine1: nullableText(160),
  city: nullableText(80),
  phone: nullablePhone,
});
export type CreateBranchRequest = z.input<typeof createBranchRequestSchema>;

export const updateBranchRequestSchema = z.object({
  version: z.number().int().min(1),
  code: locationCodeSchema.optional(),
  name: locationNameSchema.optional(),
  addressLine1: nullableText(160),
  city: nullableText(80),
  phone: nullablePhone,
  status: z.enum(LOCATION_STATUSES).optional(),
});
export type UpdateBranchRequest = z.input<typeof updateBranchRequestSchema>;

export const createRegisterRequestSchema = z.object({
  branchId: uuidSchema,
  code: locationCodeSchema,
  name: locationNameSchema,
});
export type CreateRegisterRequest = z.input<typeof createRegisterRequestSchema>;

export const updateRegisterRequestSchema = z.object({
  version: z.number().int().min(1),
  code: locationCodeSchema.optional(),
  name: locationNameSchema.optional(),
  status: z.enum(LOCATION_STATUSES).optional(),
});
export type UpdateRegisterRequest = z.input<typeof updateRegisterRequestSchema>;
