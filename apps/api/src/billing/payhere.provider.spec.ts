import { createHash } from 'node:crypto';
import type { AppConfig } from '../config/app-config';
import { decimalToMinor, InvalidNotificationError, minorToDecimal } from './payment-provider';
import { PayHereProvider } from './payhere.provider';

const md5U = (value: string) => createHash('md5').update(value).digest('hex').toUpperCase();
const ORDER = '0b9c7f43-8f43-4a63-9f6a-3b0d6f1c2a11';

function provider(overrides: Partial<AppConfig> = {}) {
  return new PayHereProvider({
    PAYHERE_MERCHANT_ID: '1211149',
    PAYHERE_MERCHANT_SECRET: 'secret',
    PAYHERE_MODE: 'sandbox',
    ...overrides,
  } as AppConfig);
}

function signed(fields: Record<string, string>) {
  const sig = md5U(
    fields.merchant_id! +
      fields.order_id! +
      fields.payhere_amount! +
      fields.payhere_currency! +
      fields.status_code! +
      md5U('secret'),
  );
  return { ...fields, md5sig: sig };
}

const base = {
  merchant_id: '1211149',
  order_id: ORDER,
  payment_id: '320025071278',
  payhere_amount: '1000.00',
  payhere_currency: 'LKR',
  status_code: '2',
};

describe('amount formatting', () => {
  it('converts between minor units and two-decimal strings', () => {
    expect(minorToDecimal(767_000)).toBe('7670.00');
    expect(minorToDecimal(5)).toBe('0.05');
    expect(decimalToMinor('7670.00')).toBe(767_000);
    expect(decimalToMinor('12.5')).toBe(1_250);
    expect(decimalToMinor('1,000.00')).toBeNull();
    expect(decimalToMinor('1.005')).toBeNull();
    expect(decimalToMinor('-1.00')).toBeNull();
  });
});

describe('PayHereProvider', () => {
  it('is unavailable without credentials', () => {
    expect(
      provider({
        PAYHERE_MERCHANT_ID: undefined,
        PAYHERE_MERCHANT_SECRET: undefined,
      }).isConfigured(),
    ).toBe(false);
    expect(() =>
      provider({
        PAYHERE_MERCHANT_ID: undefined,
        PAYHERE_MERCHANT_SECRET: undefined,
      }).parseNotification(signed(base)),
    ).toThrow(InvalidNotificationError);
  });

  it('uses the live checkout in live mode', () => {
    const redirect = provider({ PAYHERE_MODE: 'live' }).checkout({
      invoiceId: ORDER,
      description: 'Growth plan',
      amountMinor: 100_000,
      currency: 'LKR',
      customer: {
        firstName: 'Ama',
        lastName: 'Silva',
        email: 'a@example.com',
        phone: '0771234567',
        address: '1 Main St',
        city: 'Colombo',
        country: 'Sri Lanka',
      },
      returnUrl: 'https://app/r',
      cancelUrl: 'https://app/c',
      notifyUrl: 'https://api/n',
    });
    expect(redirect.url).toBe('https://www.payhere.lk/pay/checkout');
    expect(redirect.fields.hash).toBe(md5U(`1211149${ORDER}1000.00LKR${md5U('secret')}`));
  });

  it('accepts a correctly signed notification and normalises it', () => {
    expect(provider().parseNotification({ ...signed(base), card_no: '****1292' })).toEqual({
      provider: 'PAYHERE',
      eventId: '320025071278:2',
      invoiceId: ORDER,
      paymentId: '320025071278',
      outcome: 'PAID',
      amountMinor: 100_000,
      currency: 'LKR',
      method: null,
    });
  });

  it('rejects tampered, foreign or malformed notifications', () => {
    const p = provider();
    const good = signed(base);
    for (const body of [
      { ...good, payhere_amount: '1.00' },
      { ...good, md5sig: good.md5sig.toLowerCase().replace(/^./, '0') },
      signed({ ...base, merchant_id: '42' }),
      signed({ ...base, status_code: '7' }),
      signed({ ...base, order_id: 'not-an-invoice' }),
      { ...good, payment_id: '' },
    ])
      expect(() => p.parseNotification(body)).toThrow(InvalidNotificationError);
  });
});
