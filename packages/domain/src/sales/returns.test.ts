import { describe, expect, it } from 'vitest';
import {
  checkRefunds,
  discountNeedsApproval,
  expectedDrawerCash,
  lineRefund,
  refundableByMethod,
  remainingQuantity,
  suggestRefunds,
} from './returns';

const line = {
  quantity: '3',
  totalMinor: 1000, // 10.00 for 3 units: 3.33 each, not divisible
  taxMinor: 153,
  returnedQuantity: '0',
  refundedMinor: 0,
  refundedTaxMinor: 0,
};

describe('lineRefund', () => {
  it('pro-rates with cumulative rounding so partial returns add up exactly', () => {
    const first = lineRefund(line, '1');
    expect(first).toEqual({ ok: true, refundMinor: 333, taxMinor: 51 });
    const second = lineRefund(
      { ...line, returnedQuantity: '1', refundedMinor: 333, refundedTaxMinor: 51 },
      '1',
    );
    expect(second).toEqual({ ok: true, refundMinor: 334, taxMinor: 51 }); // round(666.7) − 333
    const last = lineRefund(
      { ...line, returnedQuantity: '2', refundedMinor: 667, refundedTaxMinor: 102 },
      '1',
    );
    expect(last).toEqual({ ok: true, refundMinor: 333, taxMinor: 51 });
    // 333 + 334 + 333 = 1000 and 51 × 3 = 153
  });

  it('handles fractional quantities and refuses returning more than sold', () => {
    const fabric = { ...line, quantity: '2.5', totalMinor: 112_500, taxMinor: 0 };
    expect(lineRefund(fabric, '1.25')).toMatchObject({ refundMinor: 56_250 });
    expect(lineRefund(fabric, '2.501')).toEqual({ ok: false, issue: 'exceeds_remaining' });
    expect(remainingQuantity({ quantity: '2.5', returnedQuantity: '1.25' })).toBe(1250);
  });
});

describe('refunds by method', () => {
  const payments = [
    { method: 'CARD' as const, amountMinor: 2000 },
    { method: 'CASH' as const, amountMinor: 2000 },
  ];

  it('limits each method to what was paid with it (cash net of change)', () => {
    const limits = refundableByMethod(payments, 500, [{ method: 'CASH', amountMinor: 300 }]);
    expect(Object.fromEntries(limits)).toEqual({ CARD: 2000, CASH: 1200 });
    expect(checkRefunds(1000, [{ method: 'CARD', amountMinor: 1000 }], limits)).toBeNull();
    expect(checkRefunds(1000, [{ method: 'CASH', amountMinor: 1300 }], limits)).toBe(
      'exceeds_method',
    );
    expect(checkRefunds(1000, [{ method: 'OTHER', amountMinor: 1000 }], limits)).toBe(
      'method_not_refundable',
    );
    expect(checkRefunds(1000, [{ method: 'CARD', amountMinor: 900 }], limits)).toBe('mismatch');
  });

  it('suggests cash first, then the largest other method', () => {
    const limits = refundableByMethod(payments, 500, []);
    expect(suggestRefunds(2500, limits)).toEqual([
      { method: 'CASH', amountMinor: 1500 },
      { method: 'CARD', amountMinor: 1000 },
    ]);
  });
});

describe('approval and drawer rules', () => {
  it('needs approval only above the discount limit', () => {
    expect(discountNeedsApproval(10_000, 1_000, 1000)).toBe(false); // exactly 10 %
    expect(discountNeedsApproval(10_000, 1_001, 1000)).toBe(true);
    expect(discountNeedsApproval(10_000, 9_000, null)).toBe(false);
  });

  it('includes refunds and cash movements in expected cash', () => {
    expect(
      expectedDrawerCash({
        openingFloatMinor: 500_000,
        cashReceivedMinor: 200_000,
        changeGivenMinor: 20_000,
        cashRefundedMinor: 10_000,
        payInMinor: 5_000,
        payOutMinor: 15_000,
      }),
    ).toBe(660_000);
    expect(
      expectedDrawerCash({
        openingFloatMinor: 0,
        cashReceivedMinor: 0,
        changeGivenMinor: 0,
        cashRefundedMinor: 0,
        payInMinor: 0,
        payOutMinor: 0,
        collectionsCashMinor: 7_500,
      }),
    ).toBe(7_500);
  });
});
