import { describe, expect, it } from 'vitest';
import { ageReceivable, averageCostAfterReceipt, costOf, marginBp } from './reports';

describe('weighted-average cost', () => {
  it('blends receipts by quantity with four decimals', () => {
    // 10 at 100.00, then 5 at 130.00 -> 110.00
    const first = averageCostAfterReceipt({
      onHand: '0',
      averageCost4: null,
      received: '10',
      unitCostMinor: 10_000,
    });
    expect(first).toBe(100_000_000n);
    const second = averageCostAfterReceipt({
      onHand: '10',
      averageCost4: first,
      received: '5',
      unitCostMinor: 13_000,
    });
    expect(second).toBe(110_000_000n);
    // 3 at 1.00 + 1 at 2.00 -> 1.25 (kept exactly)
    const exact = averageCostAfterReceipt({
      onHand: '3',
      averageCost4: 1_000_000n,
      received: '1',
      unitCostMinor: 200,
    });
    expect(exact).toBe(1_250_000n);
  });

  it('ignores negative stock and handles part quantities', () => {
    expect(
      averageCostAfterReceipt({
        onHand: '-2',
        averageCost4: 5n,
        received: '4',
        unitCostMinor: 900,
      }),
    ).toBe(9_000_000n);
    expect(costOf('2.5', 1_250_000n)).toBe(313); // 2.5 x 1.25 = 3.125 -> 3.13
    expect(costOf('1', 110_000_000n)).toBe(11_000);
  });

  it('computes margins in basis points', () => {
    expect(marginBp(20_000, 5_000)).toBe(2_500);
    expect(marginBp(0, 0)).toBeNull();
    expect(marginBp(30_000, 10_000)).toBe(3_333);
  });
});

describe('ageReceivable', () => {
  const asOf = new Date('2026-10-17T12:00:00Z');
  const day = (n: number) => new Date(asOf.getTime() - n * 86_400_000).toISOString();

  it('settles the oldest charges first and ages what is left', () => {
    const result = ageReceivable(
      [
        { amountMinor: 10_000, createdAt: day(100) },
        { amountMinor: 5_000, createdAt: day(45) },
        { amountMinor: 2_000, createdAt: day(5) },
        { amountMinor: -12_000, createdAt: day(2) }, // pays the 100-day charge and 2,000 of the next
      ],
      asOf,
    );
    expect(result).toEqual({
      '0_30': 2_000,
      '31_60': 3_000,
      '61_90': 0,
      OVER_90: 0,
      totalMinor: 5_000,
    });
  });

  it('applies earlier store credit to later charges', () => {
    expect(
      ageReceivable(
        [
          { amountMinor: -4_000, createdAt: day(70) },
          { amountMinor: 10_000, createdAt: day(65) },
        ],
        asOf,
      ),
    ).toEqual({ '0_30': 0, '31_60': 0, '61_90': 6_000, OVER_90: 0, totalMinor: 6_000 });
  });
});
