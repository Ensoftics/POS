import { describe, expect, it } from 'vitest';
import { availableCredit, normalisePhone, runningBalances } from './customers';

describe('normalisePhone', () => {
  it('reads Sri Lankan numbers however they are typed', () => {
    for (const input of [
      '077 123 4567',
      '0771234567',
      '+94 77 123 4567',
      '0094771234567',
      '771234567',
      '94771234567',
    ])
      expect(normalisePhone(input)).toBe('+94771234567');
  });

  it('keeps international numbers and rejects nonsense', () => {
    expect(normalisePhone('+44 20 7946 0958')).toBe('+442079460958');
    expect(normalisePhone('07712')).toBeNull();
    expect(normalisePhone('077 123 45678')).toBeNull(); // too long for Sri Lanka
    expect(normalisePhone('call me')).toBeNull();
    expect(normalisePhone('0771234567', 'XX')).toBeNull();
  });
});

describe('credit', () => {
  it('counts store credit towards what may be bought on account', () => {
    expect(availableCredit(50_000, 20_000)).toBe(30_000);
    expect(availableCredit(50_000, -10_000)).toBe(60_000);
    expect(availableCredit(0, 0)).toBe(0);
    expect(availableCredit(10_000, 15_000)).toBe(0);
  });

  it('computes running balances for statements', () => {
    expect(
      runningBalances(1_000, [
        { amountMinor: 5_000 },
        { amountMinor: -2_000 },
        { amountMinor: -4_000 },
      ]),
    ).toEqual([6_000, 4_000, 0]);
  });
});
