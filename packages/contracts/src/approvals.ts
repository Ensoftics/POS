import { z } from 'zod';
import { APPROVAL_PIN_PATTERN, MAX_MINOR_UNITS } from '@pos/domain';
import { isoDateTimeSchema, uuidSchema } from './common';

/* Approvals --------------------------------------------------------------- */

/**
 * A manager's approval given at the till: who approves and their PIN. Required
 * when the caller lacks `approvals.grant` and the action needs approval.
 */
export const approvalSchema = z.object({
  approverId: uuidSchema,
  pin: z.string().regex(APPROVAL_PIN_PATTERN, { error: 'validation.pin.invalid' }),
});
export type ApprovalDto = z.infer<typeof approvalSchema>;

export const approverListSchema = z.object({
  items: z.array(z.object({ userId: uuidSchema, fullName: z.string(), role: z.string() })),
});
export type ApproverList = z.infer<typeof approverListSchema>;

export const setApprovalPinRequestSchema = z.object({
  currentPassword: z.string().min(1, { error: 'validation.required' }).max(128),
  pin: z.string().regex(APPROVAL_PIN_PATTERN, { error: 'validation.pin.invalid' }),
});
export type SetApprovalPinRequest = z.input<typeof setApprovalPinRequestSchema>;

export const approvalPinStatusSchema = z.object({ hasPin: z.boolean() });

/** Actions that may need approval; sent with APPROVAL_REQUIRED so clients can explain why. */
export const APPROVAL_ACTIONS = ['DISCOUNT', 'RETURN', 'VOID', 'PAY_OUT'] as const;
export type ApprovalAction = (typeof APPROVAL_ACTIONS)[number];

export const reasonSchema = z
  .string({ error: 'validation.required' })
  .trim()
  .min(1, { error: 'validation.required' })
  .max(200, { error: 'validation.text.too_long' });

/* Cash movements ------------------------------------------------------------ */

export const CASH_MOVEMENT_TYPES = ['PAY_IN', 'PAY_OUT'] as const;

export const createCashMovementRequestSchema = z.object({
  id: uuidSchema,
  type: z.enum(CASH_MOVEMENT_TYPES),
  amountMinor: z
    .number({ error: 'validation.money.invalid' })
    .int({ error: 'validation.money.invalid' })
    .min(1, { error: 'validation.payment.amount_positive' })
    .max(MAX_MINOR_UNITS, { error: 'validation.money.too_large' }),
  reason: reasonSchema,
  approval: approvalSchema.optional(),
});
export type CreateCashMovementRequest = z.input<typeof createCashMovementRequestSchema>;

export const cashMovementSchema = z.object({
  id: uuidSchema,
  type: z.enum(CASH_MOVEMENT_TYPES),
  amountMinor: z.number().int(),
  reason: z.string(),
  createdByName: z.string().nullable(),
  approvedByName: z.string().nullable(),
  createdAt: isoDateTimeSchema,
});
export type CashMovement = z.infer<typeof cashMovementSchema>;
