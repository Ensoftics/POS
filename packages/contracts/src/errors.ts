import { z } from 'zod';

/** Stable machine-readable error codes. Clients map these to localised text. */
export const ERROR_CODES = [
  'VALIDATION_FAILED',
  'UNAUTHENTICATED',
  'INVALID_CREDENTIALS',
  'ACCOUNT_LOCKED',
  'ACCOUNT_DISABLED',
  'SESSION_EXPIRED',
  'FORBIDDEN',
  'NO_ACTIVE_MEMBERSHIP',
  'TENANT_SUSPENDED',
  'NOT_FOUND',
  'CONFLICT',
  'VERSION_CONFLICT',
  'DUPLICATE_CODE',
  'LAST_ACTIVE_BRANCH',
  'BRANCH_ARCHIVED',
  'DUPLICATE_NAME',
  'DUPLICATE_SKU',
  'DUPLICATE_BARCODE',
  'DUPLICATE_VARIANT',
  'CATEGORY_DEPTH',
  'INSUFFICIENT_STOCK',
  'INVALID_STATE',
  'SHIFT_ALREADY_OPEN',
  'SHIFT_NOT_OPEN',
  'TOTAL_MISMATCH',
  'IDEMPOTENCY_CONFLICT',
  'TAX_RATE_IN_USE',
  'APPROVAL_REQUIRED',
  'APPROVAL_INVALID',
  'APPROVAL_LOCKED',
  'CREDIT_LIMIT_EXCEEDED',
  'DUPLICATE_PHONE',
  'ALREADY_MEMBER',
  'LAST_OWNER',
  'ROLE_NOT_ALLOWED',
  'DEVICE_REVOKED',
  'BRANCH_NOT_ALLOWED',
  'INVITATION_INVALID',
  'PLAN_LIMIT_REACHED',
  'INSUFFICIENT_POINTS',
  'EXPIRED_STOCK',
  'SUBSCRIPTION_INACTIVE',
  'EMAIL_NOT_VERIFIED',
  'PAYMENTS_UNAVAILABLE',
  'STORAGE_UNAVAILABLE',
  'MESSAGING_UNAVAILABLE',
  'IMAGE_LIMIT_REACHED',
  'INVALID_VERIFICATION_TOKEN',
  'EMAIL_IN_USE',
  'INVALID_RESET_TOKEN',
  'RATE_LIMITED',
  'INTERNAL_ERROR',
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];

export const validationIssueSchema = z.object({
  path: z.string(),
  message: z.string(),
});
export type ValidationIssue = z.infer<typeof validationIssueSchema>;

export const errorResponseSchema = z.object({
  error: z.object({
    code: z.enum(ERROR_CODES),
    message: z.string(),
    requestId: z.string().optional(),
    issues: z.array(validationIssueSchema).optional(),
  }),
});
export type ErrorResponse = z.infer<typeof errorResponseSchema>;
