import { z } from 'zod';
import { EMAIL_MAX_CHARS, MESSAGE_CHANNELS, SMS_MAX_CHARS } from '@pos/domain';
import { isoDateTimeSchema, pageSchema, uuidSchema } from './common';

/* Consent history ----------------------------------------------------------- */

export const CONSENT_SOURCES = ['STAFF', 'UNSUBSCRIBE_LINK'] as const;

export const consentEventSchema = z.object({
  id: uuidSchema,
  granted: z.boolean(),
  source: z.enum(CONSENT_SOURCES),
  note: z.string().nullable(),
  /** Who recorded it; null for the customer's own opt-out. */
  actorName: z.string().nullable(),
  createdAt: isoDateTimeSchema,
});
export type ConsentEvent = z.infer<typeof consentEventSchema>;
export const consentHistorySchema = z.object({ items: z.array(consentEventSchema) });
export type ConsentHistory = z.infer<typeof consentHistorySchema>;

/* Campaigns ------------------------------------------------------------------ */

export const messagingStatusSchema = z.object({
  /** Whether each channel can be used now (flag on, provider set up). */
  channels: z.object({ EMAIL: z.boolean(), SMS: z.boolean() }),
  /** Customers who agreed and have a usable address, per channel. */
  audience: z.object({ EMAIL: z.number().int(), SMS: z.number().int() }),
  smsAllowance: z.number().int(),
  smsUsedThisMonth: z.number().int(),
  /** Length of the opt-out link added to every SMS, for counting characters. */
  optOutUrlLength: z.number().int(),
});
export type MessagingStatus = z.infer<typeof messagingStatusSchema>;

export const createCampaignRequestSchema = z
  .object({
    /** Chosen by the client so a retried send creates the campaign once. */
    id: uuidSchema,
    channel: z.enum(MESSAGE_CHANNELS),
    subject: z
      .string()
      .trim()
      .max(120, { error: 'validation.text.too_long' })
      .optional()
      .transform((value) => (value ? value : undefined)),
    body: z
      .string({ error: 'validation.required' })
      .trim()
      .min(1, { error: 'validation.required' })
      .max(EMAIL_MAX_CHARS, { error: 'validation.text.too_long' }),
  })
  .superRefine((value, ctx) => {
    if (value.channel === 'EMAIL' && !value.subject)
      ctx.addIssue({ code: 'custom', path: ['subject'], message: 'validation.required' });
    if (value.channel === 'SMS' && value.body.length > SMS_MAX_CHARS)
      ctx.addIssue({ code: 'custom', path: ['body'], message: 'validation.message.sms_too_long' });
  });
export type CreateCampaignRequest = z.input<typeof createCampaignRequestSchema>;

export const campaignSchema = z.object({
  id: uuidSchema,
  channel: z.enum(MESSAGE_CHANNELS),
  subject: z.string().nullable(),
  body: z.string(),
  status: z.enum(['SENDING', 'DONE']),
  recipients: z.number().int(),
  queued: z.number().int(),
  sent: z.number().int(),
  failed: z.number().int(),
  skipped: z.number().int(),
  createdByName: z.string().nullable(),
  createdAt: isoDateTimeSchema,
  completedAt: isoDateTimeSchema.nullable(),
});
export type Campaign = z.infer<typeof campaignSchema>;
export const campaignPageSchema = pageSchema(campaignSchema);
export type CampaignPage = z.infer<typeof campaignPageSchema>;

/* Opt-out link (public) ------------------------------------------------------ */

export const unsubscribeCodeSchema = z.string().regex(/^[A-Za-z0-9]{12,16}$/);

export const unsubscribeInfoSchema = z.object({
  businessName: z.string(),
  subscribed: z.boolean(),
});
export type UnsubscribeInfo = z.infer<typeof unsubscribeInfoSchema>;

export const unsubscribeRequestSchema = z.object({ code: unsubscribeCodeSchema });
export type UnsubscribeRequest = z.input<typeof unsubscribeRequestSchema>;
