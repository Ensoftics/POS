import { createHash, timingSafeEqual } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../config/app-config';
import {
  type CheckoutInput,
  type CheckoutRedirect,
  decimalToMinor,
  InvalidNotificationError,
  minorToDecimal,
  type PaymentNotification,
  type PaymentOutcome,
  PaymentProvider,
} from './payment-provider';

const CHECKOUT_URLS = {
  sandbox: 'https://sandbox.payhere.lk/pay/checkout',
  live: 'https://www.payhere.lk/pay/checkout',
} as const;

const OUTCOMES: Record<string, PaymentOutcome> = {
  '2': 'PAID',
  '0': 'PENDING',
  '-1': 'CANCELLED',
  '-2': 'FAILED',
  '-3': 'CHARGEBACK',
};

const md5Upper = (value: string) =>
  createHash('md5').update(value, 'utf8').digest('hex').toUpperCase();

/**
 * PayHere (Sri Lanka) hosted checkout, one payment per billing period.
 * The checkout hash and the notification signature follow PayHere's scheme:
 * MD5 over the merchant id, order id, amount, currency (and status), with the
 * upper-cased MD5 of the merchant secret appended. MD5 is the provider's choice;
 * the secret itself never leaves the server.
 */
@Injectable()
export class PayHereProvider extends PaymentProvider {
  readonly name = 'PAYHERE';

  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {
    super();
  }

  isConfigured(): boolean {
    return !!this.config.PAYHERE_MERCHANT_ID && !!this.config.PAYHERE_MERCHANT_SECRET;
  }

  checkout(input: CheckoutInput): CheckoutRedirect {
    const merchantId = this.config.PAYHERE_MERCHANT_ID!;
    const amount = minorToDecimal(input.amountMinor);
    return {
      url: CHECKOUT_URLS[this.config.PAYHERE_MODE],
      fields: {
        merchant_id: merchantId,
        return_url: input.returnUrl,
        cancel_url: input.cancelUrl,
        notify_url: input.notifyUrl,
        order_id: input.invoiceId,
        items: input.description,
        currency: input.currency,
        amount,
        first_name: input.customer.firstName,
        last_name: input.customer.lastName,
        email: input.customer.email,
        phone: input.customer.phone,
        address: input.customer.address,
        city: input.customer.city,
        country: input.customer.country,
        hash: this.checkoutHash(merchantId, input.invoiceId, amount, input.currency),
      },
    };
  }

  checkoutHash(merchantId: string, orderId: string, amount: string, currency: string): string {
    return md5Upper(
      merchantId + orderId + amount + currency + md5Upper(this.config.PAYHERE_MERCHANT_SECRET!),
    );
  }

  notificationSignature(fields: {
    merchantId: string;
    orderId: string;
    amount: string;
    currency: string;
    statusCode: string;
  }): string {
    return md5Upper(
      fields.merchantId +
        fields.orderId +
        fields.amount +
        fields.currency +
        fields.statusCode +
        md5Upper(this.config.PAYHERE_MERCHANT_SECRET!),
    );
  }

  parseNotification(body: Record<string, unknown>): PaymentNotification {
    if (!this.isConfigured()) throw new InvalidNotificationError('provider not configured');
    const field = (name: string) => {
      const value = body[name];
      return typeof value === 'string' ? value : '';
    };
    const merchantId = field('merchant_id');
    const orderId = field('order_id');
    const paymentId = field('payment_id');
    const amount = field('payhere_amount');
    const currency = field('payhere_currency');
    const statusCode = field('status_code');
    const signature = field('md5sig');
    if (!merchantId || !orderId || !paymentId || !amount || !currency || !statusCode || !signature)
      throw new InvalidNotificationError('missing fields');
    if (merchantId !== this.config.PAYHERE_MERCHANT_ID)
      throw new InvalidNotificationError('unknown merchant');

    const expected = Buffer.from(
      this.notificationSignature({ merchantId, orderId, amount, currency, statusCode }),
    );
    const given = Buffer.from(signature.toUpperCase());
    if (expected.length !== given.length || !timingSafeEqual(expected, given))
      throw new InvalidNotificationError('bad signature');

    const outcome = OUTCOMES[statusCode];
    const amountMinor = decimalToMinor(amount);
    if (!outcome || amountMinor === null) throw new InvalidNotificationError('unexpected values');
    if (!/^[0-9a-f-]{36}$/i.test(orderId)) throw new InvalidNotificationError('unknown order');
    const method = field('method');
    return {
      provider: this.name,
      // One payment moves through states (pending → paid → charged back): each is one event.
      eventId: `${paymentId}:${statusCode}`,
      invoiceId: orderId.toLowerCase(),
      paymentId,
      outcome,
      amountMinor,
      currency,
      // Only the method label is kept; card numbers and holder names are ignored.
      method: method ? method.slice(0, 20) : null,
    };
  }
}
