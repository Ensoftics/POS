import { FEATURE_FLAGS, NOTIFICATION_KINDS } from '@pos/domain';
import { z } from 'zod';
import { isoDateTimeSchema, pageSchema, uuidSchema } from './common';

export const notificationSchema = z.object({
  id: uuidSchema,
  kind: z.enum(NOTIFICATION_KINDS),
  /** Parameters for the translated text (counts, names, amounts). */
  data: z.record(z.string(), z.unknown()),
  /** In-app path to open, e.g. "/inventory?filter=LOW". */
  link: z.string().nullable(),
  readAt: isoDateTimeSchema.nullable(),
  createdAt: isoDateTimeSchema,
});
export type Notification = z.infer<typeof notificationSchema>;
export const notificationPageSchema = pageSchema(notificationSchema);
export type NotificationPage = z.infer<typeof notificationPageSchema>;

export const listNotificationsQuerySchema = z.object({
  unreadOnly: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
  cursor: uuidSchema.optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
export type ListNotificationsQuery = z.input<typeof listNotificationsQuerySchema>;

export const unreadCountSchema = z.object({ unread: z.number().int() });
export type UnreadCount = z.infer<typeof unreadCountSchema>;

export const notificationPreferencesSchema = z.object({
  /** Morning e-mail with stock alerts and (for managers) yesterday's sales. */
  emailDigest: z.boolean(),
});
export type NotificationPreferences = z.infer<typeof notificationPreferencesSchema>;

/* Platform: feature flags ------------------------------------------------------ */

export const featureFlagKeySchema = z.enum(FEATURE_FLAGS);

export const platformFeatureFlagSchema = z.object({
  key: featureFlagKeySchema,
  description: z.string(),
  defaultEnabled: z.boolean(),
  version: z.number().int(),
  /** Businesses with their own setting. */
  overrides: z.number().int(),
});
export type PlatformFeatureFlag = z.infer<typeof platformFeatureFlagSchema>;
export const platformFeatureFlagListSchema = z.object({
  items: z.array(platformFeatureFlagSchema),
});
export type PlatformFeatureFlagList = z.infer<typeof platformFeatureFlagListSchema>;

export const updateFeatureFlagRequestSchema = z.object({
  defaultEnabled: z.boolean(),
  version: z.number().int().min(1),
});
export type UpdateFeatureFlagRequest = z.input<typeof updateFeatureFlagRequestSchema>;

export const tenantFeatureSchema = z.object({
  key: featureFlagKeySchema,
  enabled: z.boolean(),
  /** True when this business has its own setting instead of the default. */
  overridden: z.boolean(),
});
export type TenantFeature = z.infer<typeof tenantFeatureSchema>;

/** `enabled: null` removes the business's own setting (back to the default). */
export const setTenantFeatureRequestSchema = z.object({
  enabled: z.boolean().nullable(),
  reason: z
    .string({ error: 'validation.required' })
    .trim()
    .min(3, { error: 'validation.reason.too_short' })
    .max(500, { error: 'validation.text.too_long' }),
});
export type SetTenantFeatureRequest = z.input<typeof setTenantFeatureRequestSchema>;
