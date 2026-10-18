import { z } from 'zod';
import {
  BUSINESS_TYPES,
  checkPassword,
  PASSWORD_MAX_LENGTH,
  PERMISSIONS,
  TENANT_ROLES,
  type PasswordContext,
} from '@pos/domain';
import { subscriptionSummarySchema } from './billing';
import { emailSchema, isoDateTimeSchema, uuidSchema } from './common';
import { tenantSummarySchema } from './tenant';

export const CLIENT_TYPES = ['WEB', 'MOBILE'] as const;
export type ClientType = (typeof CLIENT_TYPES)[number];

/** Header the web client sends on cookie-authenticated auth calls (forces a CORS preflight). */
export const CSRF_HEADER = 'x-pos-client';
export const REFRESH_COOKIE = 'pos_rt';

export const personNameSchema = z
  .string({ error: 'validation.required' })
  .trim()
  .min(2, { error: 'validation.name.too_short' })
  .max(120, { error: 'validation.name.too_long' });

// The max here only guards payload size; the domain policy measures length in code points.
export const rawPasswordSchema = z
  .string({ error: 'validation.required' })
  .min(1, { error: 'validation.required' })
  .max(PASSWORD_MAX_LENGTH * 4, { error: 'validation.password.too_long' });

/** New-password field: length and deny-list rules, reported on the field itself. */
export const newPasswordSchema = rawPasswordSchema.superRefine((password, ctx) => {
  for (const issue of checkPassword(password)) {
    ctx.addIssue({ code: 'custom', message: `validation.password.${issue}` });
  }
});

/** Identity rule needs sibling fields, so it runs at object level once fields are valid. */
function addIdentityIssue(password: string, context: PasswordContext, ctx: z.RefinementCtx) {
  if (checkPassword(password, context).includes('contains_identity')) {
    ctx.addIssue({
      code: 'custom',
      path: ['password'],
      message: 'validation.password.contains_identity',
    });
  }
}

export const registerRequestSchema = z
  .object({
    businessName: z
      .string({ error: 'validation.required' })
      .trim()
      .min(2, { error: 'validation.businessName.too_short' })
      .max(120, { error: 'validation.businessName.too_long' }),
    ownerFullName: personNameSchema,
    email: emailSchema,
    password: newPasswordSchema,
    businessType: z.enum(BUSINESS_TYPES).optional(),
    acceptTerms: z.literal(true, { error: 'validation.terms.required' }),
    clientType: z.enum(CLIENT_TYPES).default('WEB'),
    deviceName: z.string().trim().max(100).optional(),
    /** The till's install id (Android); a revoked device cannot sign in. */
    deviceId: uuidSchema.optional(),
  })
  .superRefine((value, ctx) =>
    addIdentityIssue(value.password, { email: value.email, fullName: value.ownerFullName }, ctx),
  );
export type RegisterRequest = z.input<typeof registerRequestSchema>;

export const loginRequestSchema = z.object({
  email: emailSchema,
  password: rawPasswordSchema,
  /** Required only when the user belongs to more than one business. */
  tenantId: uuidSchema.optional(),
  clientType: z.enum(CLIENT_TYPES).default('WEB'),
  deviceName: z.string().trim().max(100).optional(),
  /** The till's install id (Android); a revoked device cannot sign in. */
  deviceId: uuidSchema.optional(),
});
export type LoginRequest = z.input<typeof loginRequestSchema>;

export const refreshRequestSchema = z.object({
  /** Mobile clients send the token in the body; web uses the httpOnly cookie. */
  refreshToken: z.string().min(20).max(200).optional(),
});
export type RefreshRequest = z.input<typeof refreshRequestSchema>;

export const forgotPasswordRequestSchema = z.object({ email: emailSchema });
export type ForgotPasswordRequest = z.input<typeof forgotPasswordRequestSchema>;

export const resetPasswordRequestSchema = z.object({
  token: z.string().min(20, { error: 'validation.resetToken.invalid' }).max(200),
  password: newPasswordSchema,
});
export type ResetPasswordRequest = z.input<typeof resetPasswordRequestSchema>;

export const userProfileSchema = z.object({
  id: uuidSchema,
  email: z.string(),
  fullName: z.string(),
  isPlatformAdmin: z.boolean(),
  /** Absent from older servers; treat as verified. */
  emailVerified: z.boolean().optional(),
});
export type UserProfile = z.infer<typeof userProfileSchema>;

export const membershipSummarySchema = z.object({
  tenantId: uuidSchema,
  tenantName: z.string(),
  tenantSlug: z.string(),
  role: z.enum(TENANT_ROLES),
});
export type MembershipSummary = z.infer<typeof membershipSummarySchema>;

export const authContextSchema = z.object({
  user: userProfileSchema,
  tenant: tenantSummarySchema,
  role: z.enum(TENANT_ROLES),
  permissions: z.array(z.enum(PERMISSIONS)),
  memberships: z.array(membershipSummarySchema),
  /** Branches this member may work at; null or absent means every branch. */
  branchIds: z.array(uuidSchema).nullable().optional(),
  subscription: subscriptionSummarySchema.nullable().optional(),
  /** Feature flags switched on for this business. */
  features: z.array(z.string()).optional(),
});
export type AuthContext = z.infer<typeof authContextSchema>;

export const authSessionResponseSchema = authContextSchema.extend({
  accessToken: z.string(),
  accessTokenExpiresAt: isoDateTimeSchema,
  /** Only returned to MOBILE clients; web receives it as an httpOnly cookie. */
  refreshToken: z.string().optional(),
  refreshTokenExpiresAt: isoDateTimeSchema,
});
export type AuthSessionResponse = z.infer<typeof authSessionResponseSchema>;

export const tenantSelectionResponseSchema = z.object({
  requiresTenantSelection: z.literal(true),
  tenants: z.array(membershipSummarySchema),
});
export type TenantSelectionResponse = z.infer<typeof tenantSelectionResponseSchema>;

export const loginResponseSchema = z.union([
  authSessionResponseSchema,
  tenantSelectionResponseSchema,
]);
export type LoginResponse = z.infer<typeof loginResponseSchema>;

export function isTenantSelection(response: LoginResponse): response is TenantSelectionResponse {
  return 'requiresTenantSelection' in response;
}

export const acceptedResponseSchema = z.object({ accepted: z.literal(true) });
export type AcceptedResponse = z.infer<typeof acceptedResponseSchema>;
