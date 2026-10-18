import { z } from 'zod';
import { TENANT_ROLES } from '@pos/domain';
import { CLIENT_TYPES, personNameSchema, rawPasswordSchema } from './auth';
import { emailSchema, isoDateTimeSchema, uuidSchema } from './common';

/* Members --------------------------------------------------------------------- */

export const staffMemberSchema = z.object({
  membershipId: uuidSchema,
  userId: uuidSchema,
  fullName: z.string(),
  email: z.string(),
  role: z.enum(TENANT_ROLES),
  status: z.enum(['ACTIVE', 'DISABLED']),
  /** Branches the member may work at; empty = every branch. */
  branchIds: z.array(uuidSchema),
  lastLoginAt: isoDateTimeSchema.nullable(),
  isSelf: z.boolean(),
  /** Whether the caller may change this member (role rules). */
  manageable: z.boolean(),
  version: z.number().int(),
});
export type StaffMember = z.infer<typeof staffMemberSchema>;

export const invitationSchema = z.object({
  id: uuidSchema,
  email: z.string(),
  role: z.enum(TENANT_ROLES),
  branchIds: z.array(uuidSchema),
  invitedByName: z.string().nullable(),
  createdAt: isoDateTimeSchema,
  expiresAt: isoDateTimeSchema,
  expired: z.boolean(),
});
export type Invitation = z.infer<typeof invitationSchema>;

export const staffListSchema = z.object({
  members: z.array(staffMemberSchema),
  invitations: z.array(invitationSchema),
});
export type StaffList = z.infer<typeof staffListSchema>;

const branchIdsSchema = z
  .array(uuidSchema)
  .max(100)
  .transform((ids) => [...new Set(ids)]);

export const createInvitationRequestSchema = z.object({
  email: emailSchema,
  role: z.enum(TENANT_ROLES),
  /** Empty = every branch. Owners always work at every branch. */
  branchIds: branchIdsSchema.default([]),
});
export type CreateInvitationRequest = z.input<typeof createInvitationRequestSchema>;

export const updateStaffRequestSchema = z.object({
  version: z.number().int().min(1),
  role: z.enum(TENANT_ROLES).optional(),
  status: z.enum(['ACTIVE', 'DISABLED']).optional(),
  branchIds: branchIdsSchema.optional(),
});
export type UpdateStaffRequest = z.input<typeof updateStaffRequestSchema>;

/* Accepting an invitation ------------------------------------------------------ */

export const invitationPreviewSchema = z.object({
  businessName: z.string(),
  email: z.string(),
  role: z.enum(TENANT_ROLES),
  /** True when the e-mail already has an account: accept with its password. */
  existingAccount: z.boolean(),
});
export type InvitationPreview = z.infer<typeof invitationPreviewSchema>;

/** The token travels in a body, never a URL, so it stays out of access logs. */
export const invitationTokenRequestSchema = z.object({ token: z.string().min(20).max(200) });
export type InvitationTokenRequest = z.input<typeof invitationTokenRequestSchema>;

export const acceptInvitationRequestSchema = z.object({
  token: z.string().min(20).max(200),
  /** Required for a new account. */
  fullName: personNameSchema.optional(),
  /** New account: the password to set (checked against the policy). Existing account: its password. */
  password: rawPasswordSchema,
  clientType: z.enum(CLIENT_TYPES).default('WEB'),
  deviceName: z.string().trim().max(100).optional(),
  deviceId: uuidSchema.optional(),
});
export type AcceptInvitationRequest = z.input<typeof acceptInvitationRequestSchema>;

/* Devices ---------------------------------------------------------------------- */

export const deviceSchema = z.object({
  id: uuidSchema,
  name: z.string(),
  branchId: uuidSchema,
  branchName: z.string(),
  registerId: uuidSchema,
  registerName: z.string(),
  registeredByName: z.string().nullable(),
  lastSeenAt: isoDateTimeSchema,
  revoked: z.boolean(),
  createdAt: isoDateTimeSchema,
});
export type Device = z.infer<typeof deviceSchema>;
export const deviceListSchema = z.object({ items: z.array(deviceSchema) });
export type DeviceList = z.infer<typeof deviceListSchema>;

export const registerDeviceRequestSchema = z.object({
  name: z
    .string({ error: 'validation.required' })
    .trim()
    .min(1, { error: 'validation.required' })
    .max(100, { error: 'validation.text.too_long' }),
  registerId: uuidSchema,
});
export type RegisterDeviceRequest = z.input<typeof registerDeviceRequestSchema>;
