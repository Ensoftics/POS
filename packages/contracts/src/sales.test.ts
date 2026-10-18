import { describe, expect, it } from 'vitest';
import {
  createSaleRequestSchema,
  createTaxRateRequestSchema,
  discountSchema,
  paymentRequestSchema,
} from './index';

const A = '11111111-1111-4111-8111-111111111111';
const V = '33333333-3333-4333-8333-333333333333';

const messages = (result: { error?: { issues: { message: string; path: PropertyKey[] }[] } }) =>
  result.error?.issues.map((issue) => `${issue.path.join('.')}:${issue.message}`) ?? [];

describe('sales requests', () => {
  const sale = {
    id: A,
    shiftId: A,
    lines: [{ variantId: V, quantity: '1' }],
    payments: [{ method: 'CASH', amountMinor: 1000 }],
    expectedTotalMinor: 1000,
  };

  it('accepts a minimal sale and requires at least one line', () => {
    expect(createSaleRequestSchema.safeParse(sale).success).toBe(true);
    expect(messages(createSaleRequestSchema.safeParse({ ...sale, lines: [] }))).toContain(
      'lines:validation.lines.required',
    );
  });

  it('limits percentage discounts to 100 %', () => {
    expect(discountSchema.safeParse({ kind: 'PERCENT', value: 10_000 }).success).toBe(true);
    expect(messages(discountSchema.safeParse({ kind: 'PERCENT', value: 10_001 }))).toContain(
      'value:validation.discount.invalid',
    );
    expect(discountSchema.safeParse({ kind: 'AMOUNT', value: 250_000 }).success).toBe(true);
    expect(discountSchema.safeParse({ kind: 'AMOUNT', value: 1.5 }).success).toBe(false);
  });

  it('rejects zero payments and card numbers in references', () => {
    expect(messages(paymentRequestSchema.safeParse({ method: 'CASH', amountMinor: 0 }))).toContain(
      'amountMinor:validation.payment.amount_positive',
    );
    expect(
      messages(
        paymentRequestSchema.safeParse({
          method: 'CARD',
          amountMinor: 100,
          reference: '4111 1111 1111 1111',
        }),
      ),
    ).toContain('reference:validation.payment.reference_looks_like_card');
    expect(
      paymentRequestSchema.safeParse({ method: 'CARD', amountMinor: 100, reference: 'APP-829341' })
        .success,
    ).toBe(true);
  });

  it('validates tax rates as basis points', () => {
    expect(createTaxRateRequestSchema.safeParse({ name: 'VAT', rateBp: 1800 }).success).toBe(true);
    expect(
      messages(createTaxRateRequestSchema.safeParse({ name: 'VAT', rateBp: 10_001 })),
    ).toContain('rateBp:validation.percent.invalid');
  });
});
