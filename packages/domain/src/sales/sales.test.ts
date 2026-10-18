import { describe, expect, it } from 'vitest';
import {
  allocateProportionally,
  computeCart,
  discountAmount,
  expectedCash,
  formatPercent,
  parsePercent,
  settlePayments,
  taxFor,
} from './sales';

describe('discountAmount', () => {
  it('rounds percentages half-up and passes amounts through', () => {
    expect(discountAmount(1005, { kind: 'PERCENT', value: 1000 })).toBe(101); // 100.5 -> 101
    expect(discountAmount(1004, { kind: 'PERCENT', value: 1000 })).toBe(100);
    expect(discountAmount(5000, { kind: 'AMOUNT', value: 750 })).toBe(750);
    expect(discountAmount(5000, null)).toBe(0);
  });
});

describe('allocateProportionally', () => {
  it('always sums to the amount and is deterministic', () => {
    expect(allocateProportionally(100, [1, 1, 1])).toEqual([34, 33, 33]);
    expect(allocateProportionally(10, [300, 700])).toEqual([3, 7]);
    expect(allocateProportionally(0, [5, 5])).toEqual([0, 0]);
    expect(allocateProportionally(5, [0, 0])).toEqual([0, 0]);
    const parts = allocateProportionally(99_999, [12_345, 67_891, 3, 1_000_000]);
    expect(parts.reduce((a, b) => a + b, 0)).toBe(99_999);
  });
});

describe('taxFor', () => {
  it('extracts inclusive tax and adds exclusive tax, half-up', () => {
    // 18 % inclusive in 1180.00 is 180.00
    expect(taxFor(118_000, 1800, true)).toBe(18_000);
    // 18 % on top of 1000.00 is 180.00
    expect(taxFor(100_000, 1800, false)).toBe(18_000);
    // 2.5 % of 0.30 = 0.0075 -> 0.01
    expect(taxFor(30, 250, false)).toBe(1);
    expect(taxFor(12_345, 0, true)).toBe(0);
  });
});

describe('computeCart', () => {
  it('prices a cart with line and cart discounts and inclusive tax', () => {
    const totals = computeCart({
      pricesIncludeTax: true,
      lines: [
        { unitPriceMinor: 118_000, quantity: '2', taxRateBp: 1800 }, // 2360.00
        {
          unitPriceMinor: 50_000,
          quantity: '1',
          taxRateBp: 0,
          discount: { kind: 'PERCENT', value: 1000 }, // -50.00
        },
      ],
      discount: { kind: 'AMOUNT', value: 10_000 }, // 100.00 shared 236000:45000
    });
    expect(totals.issues).toEqual([]);
    expect(totals.subtotalMinor).toBe(286_000);
    expect(totals.lines[0]!.cartDiscountMinor + totals.lines[1]!.cartDiscountMinor).toBe(10_000);
    expect(totals.lines[0]!.cartDiscountMinor).toBe(8399); // 10000 * 236000/281000 = 8398.6
    expect(totals.discountMinor).toBe(15_000);
    expect(totals.totalMinor).toBe(271_000);
    // Inclusive: tax only on the taxable line, extracted from 2276.01
    expect(totals.lines[1]!.taxMinor).toBe(0);
    expect(totals.taxMinor).toBe(taxFor(236_000 - 8399, 1800, true));
  });

  it('adds exclusive tax on top', () => {
    const totals = computeCart({
      pricesIncludeTax: false,
      lines: [{ unitPriceMinor: 100_000, quantity: '1.5', taxRateBp: 1800 }],
    });
    expect(totals.subtotalMinor).toBe(150_000);
    expect(totals.taxMinor).toBe(27_000);
    expect(totals.totalMinor).toBe(177_000);
  });

  it('reports and clamps discounts larger than what they apply to', () => {
    const totals = computeCart({
      pricesIncludeTax: true,
      lines: [
        {
          unitPriceMinor: 1000,
          quantity: '1',
          taxRateBp: 0,
          discount: { kind: 'AMOUNT', value: 2000 },
        },
        { unitPriceMinor: 1000, quantity: '1', taxRateBp: 0 },
      ],
      discount: { kind: 'AMOUNT', value: 5000 },
    });
    expect(totals.issues).toEqual([
      { line: 0, issue: 'discount_exceeds_line' },
      { line: null, issue: 'discount_exceeds_total' },
    ]);
    expect(totals.totalMinor).toBe(0);
  });

  it('allows a fully discounted cart', () => {
    const totals = computeCart({
      pricesIncludeTax: false,
      lines: [{ unitPriceMinor: 999, quantity: '3', taxRateBp: 1800 }],
      discount: { kind: 'PERCENT', value: 10_000 },
    });
    expect(totals.issues).toEqual([]);
    expect(totals.totalMinor).toBe(0);
    expect(totals.taxMinor).toBe(0);
  });
});

describe('settlePayments', () => {
  it('gives change only from cash', () => {
    expect(
      settlePayments(1000, [
        { method: 'CARD', amountMinor: 600 },
        { method: 'CASH', amountMinor: 500 },
      ]),
    ).toEqual({ ok: true, paidMinor: 1100, changeMinor: 100, cashMinor: 500 });
  });

  it('rejects underpayment and over-tendered card payments', () => {
    expect(settlePayments(1000, [{ method: 'CASH', amountMinor: 999 }])).toEqual({
      ok: false,
      issue: 'insufficient',
      dueMinor: 1,
    });
    expect(settlePayments(1000, [{ method: 'CARD', amountMinor: 1001 }])).toMatchObject({
      ok: false,
      issue: 'non_cash_exceeds_total',
    });
  });

  it('settles a zero total without payments', () => {
    expect(settlePayments(0, [])).toEqual({ ok: true, paidMinor: 0, changeMinor: 0, cashMinor: 0 });
  });

  it('computes expected drawer cash', () => {
    expect(expectedCash(500_000, 120_000, 20_000)).toBe(600_000);
  });
});

describe('percent text', () => {
  it('round-trips basis points', () => {
    expect(parsePercent('18.5')).toBe(1850);
    expect(parsePercent('2.55')).toBe(255);
    expect(parsePercent('100')).toBe(10_000);
    expect(parsePercent('100.01')).toBeNull();
    expect(parsePercent('1.234')).toBeNull();
    expect(parsePercent('-1')).toBeNull();
    expect(formatPercent(1850)).toBe('18.5');
    expect(formatPercent(1800)).toBe('18');
    expect(formatPercent(5)).toBe('0.05');
  });
});
