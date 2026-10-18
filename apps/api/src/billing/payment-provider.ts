/**
 * A hosted-checkout payment provider. Card details are entered on the provider's
 * own page; this system only sends the amount and receives signed notifications.
 */
export interface CheckoutInput {
  invoiceId: string;
  description: string;
  amountMinor: number;
  currency: string;
  customer: {
    firstName: string;
    lastName: string;
    email: string;
    phone: string;
    address: string;
    city: string;
    country: string;
  };
  returnUrl: string;
  cancelUrl: string;
  notifyUrl: string;
}

export interface CheckoutRedirect {
  url: string;
  fields: Record<string, string>;
}

export type PaymentOutcome = 'PAID' | 'PENDING' | 'FAILED' | 'CANCELLED' | 'CHARGEBACK';

/** A notification whose signature has been verified. */
export interface PaymentNotification {
  provider: string;
  /** Unique per provider and state change: the idempotency key. */
  eventId: string;
  invoiceId: string;
  paymentId: string;
  outcome: PaymentOutcome;
  amountMinor: number;
  currency: string;
  method: string | null;
}

export abstract class PaymentProvider {
  abstract readonly name: string;
  /** False when credentials are missing: checkout is then refused, never faked. */
  abstract isConfigured(): boolean;
  abstract checkout(input: CheckoutInput): CheckoutRedirect;
  /** Verifies and normalises a notification; throws InvalidNotificationError otherwise. */
  abstract parseNotification(body: Record<string, unknown>): PaymentNotification;
}

export class InvalidNotificationError extends Error {
  constructor(reason: string) {
    super(`Invalid payment notification: ${reason}`);
    this.name = 'InvalidNotificationError';
  }
}

/** "1234.50" → 123450. Two decimals only; anything else is rejected. */
export function decimalToMinor(value: string): number | null {
  const match = /^(\d{1,12})(?:\.(\d{1,2}))?$/.exec(value.trim());
  if (!match) return null;
  return Number(match[1]) * 100 + Number((match[2] ?? '').padEnd(2, '0'));
}

/** 123450 → "1234.50" (no thousands separators). */
export function minorToDecimal(minor: number): string {
  return `${Math.trunc(minor / 100)}.${String(minor % 100).padStart(2, '0')}`;
}
