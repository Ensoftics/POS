import { describe, expect, it } from 'vitest';
import {
  allocateFefo,
  allocateForSale,
  isExpired,
  localDateIn,
  allocateFefoWithShortfall,
  daysUntilExpiry,
  fromMilli,
  toMilli,
} from '../index';

describe('milli-unit quantities', () => {
  it('converts exactly in both directions', () => {
    expect(toMilli('12.5')).toBe(12500);
    expect(toMilli('0.001')).toBe(1);
    expect(toMilli('-3')).toBe(-3000);
    expect(fromMilli(12500)).toBe('12.5');
    expect(fromMilli(-2000)).toBe('-2');
    expect(fromMilli(toMilli('0.1') + toMilli('0.2'))).toBe('0.3'); // 0.1 + 0.2 is 0.300…04 in floats
  });

  it('rejects malformed quantities', () => {
    expect(() => toMilli('1.2345')).toThrow();
    expect(() => toMilli('abc')).toThrow();
  });
});

describe('allocateFefo', () => {
  const balances = [
    { batchId: 'late', quantity: '5', expiryDate: '2027-06-01' },
    { batchId: null, quantity: '10', expiryDate: null },
    { batchId: 'soon', quantity: '2', expiryDate: '2026-12-01' },
    { batchId: 'empty', quantity: '0', expiryDate: '2026-11-01' },
  ];

  it('takes the soonest-expiring stock first and undated stock last', () => {
    expect(allocateFefo(balances, '6')).toEqual([
      { batchId: 'soon', quantity: '2' },
      { batchId: 'late', quantity: '4' },
    ]);
    expect(allocateFefo(balances, '8.5')).toEqual([
      { batchId: 'soon', quantity: '2' },
      { batchId: 'late', quantity: '5' },
      { batchId: null, quantity: '1.5' },
    ]);
  });

  it('returns null when there is not enough stock', () => {
    expect(allocateFefo(balances, '17.001')).toBeNull();
  });
});

describe('daysUntilExpiry', () => {
  it('counts whole days', () => {
    expect(daysUntilExpiry('2026-10-20', '2026-10-16')).toBe(4);
    expect(daysUntilExpiry('2026-10-10', '2026-10-16')).toBe(-6);
  });
});

describe('lineTotalMinor', () => {
  it('multiplies exactly and rounds half up', async () => {
    const { lineTotalMinor } = await import('../index');
    expect(lineTotalMinor(125050, '2')).toBe(250100);
    expect(lineTotalMinor(333, '1.5')).toBe(500); // 499.5 -> 500
    // 7,777,777,777 x 1,000,001 thousandths overflows float precision in the intermediate product.
    expect(lineTotalMinor(7_777_777_777, '1000.001')).toBe(7_777_785_554_778);
    expect(() => lineTotalMinor(999_999_999_999, '999999.999')).toThrow(RangeError);
  });
});

describe('allocateFefoWithShortfall', () => {
  const balances = [
    { batchId: 'late', quantity: '2', expiryDate: '2027-06-01' },
    { batchId: 'soon', quantity: '1', expiryDate: '2026-12-01' },
  ];

  it('behaves like FEFO when there is enough stock', () => {
    expect(allocateFefoWithShortfall(balances, '2')).toEqual(allocateFefo(balances, '2'));
  });

  it('takes all available stock, then books the shortfall as unbatched', () => {
    expect(allocateFefoWithShortfall(balances, '5')).toEqual([
      { batchId: 'soon', quantity: '1' },
      { batchId: 'late', quantity: '2' },
      { batchId: null, quantity: '2' },
    ]);
    expect(allocateFefoWithShortfall([], '1.5')).toEqual([{ batchId: null, quantity: '1.5' }]);
    expect(
      allocateFefoWithShortfall([{ batchId: null, quantity: '-1', expiryDate: null }], '2'),
    ).toEqual([{ batchId: null, quantity: '2' }]);
    expect(
      allocateFefoWithShortfall([{ batchId: null, quantity: '1', expiryDate: null }], '3'),
    ).toEqual([{ batchId: null, quantity: '3' }]);
  });
});

describe('stock for sales and expiry', () => {
  const today = '2026-10-17';
  const balances = [
    { batchId: 'old', quantity: '3', expiryDate: '2026-10-10' }, // expired
    { batchId: 'older', quantity: '1', expiryDate: '2026-09-01' }, // expired
    { batchId: 'soon', quantity: '2', expiryDate: '2026-10-17' }, // last good day
    { batchId: 'later', quantity: '5', expiryDate: '2027-03-01' },
  ];
  const online = { allowNegative: false, allowExpired: false };
  const offline = { allowNegative: true, allowExpired: true };

  it('treats the expiry date itself as still usable', () => {
    expect(isExpired('2026-10-17', today)).toBe(false);
    expect(isExpired('2026-10-16', today)).toBe(true);
    expect(isExpired(null, today)).toBe(false);
  });

  it('never picks expired batches while good stock is left', () => {
    expect(allocateForSale(balances, '4', today, online)).toEqual({
      ok: true,
      allocations: [
        { batchId: 'soon', quantity: '2' },
        { batchId: 'later', quantity: '2' },
      ],
      expired: [],
    });
  });

  it('refuses online when only expired stock would cover the sale', () => {
    expect(allocateForSale(balances, '8', today, online)).toEqual({ ok: false, reason: 'expired' });
    expect(allocateForSale(balances, '8', today, { ...online, allowNegative: true })).toEqual({
      ok: false,
      reason: 'expired',
    });
    const noExpired = balances.slice(2);
    expect(allocateForSale(noExpired, '8', today, online)).toEqual({
      ok: false,
      reason: 'insufficient',
    });
    expect(allocateForSale(noExpired, '8', today, { ...online, allowNegative: true })).toEqual({
      ok: true,
      allocations: [
        { batchId: 'soon', quantity: '2' },
        { batchId: 'later', quantity: '5' },
        { batchId: null, quantity: '1' },
      ],
      expired: [],
    });
  });

  it('records offline sales as they happened: good stock, then the latest expired, then a shortfall', () => {
    expect(allocateForSale(balances, '12.5', today, offline)).toEqual({
      ok: true,
      allocations: [
        { batchId: 'soon', quantity: '2' },
        { batchId: 'later', quantity: '5' },
        { batchId: 'old', quantity: '3' },
        { batchId: 'older', quantity: '1' },
        { batchId: null, quantity: '1.5' },
      ],
      expired: [
        { batchId: 'old', quantity: '3' },
        { batchId: 'older', quantity: '1' },
      ],
    });
    expect(allocateForSale(balances, '8', today, offline)).toMatchObject({
      expired: [{ batchId: 'old', quantity: '1' }],
    });
  });

  it('works out the local date in the business time zone', () => {
    const at = new Date('2026-10-16T20:00:00Z'); // 01:30 on the 17th in Colombo
    expect(localDateIn(at, 'Asia/Colombo')).toBe('2026-10-17');
    expect(localDateIn(at, 'UTC')).toBe('2026-10-16');
  });
});
