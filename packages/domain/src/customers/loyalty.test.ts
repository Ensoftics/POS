import { describe, expect, it } from 'vitest';
import { cumulativePointShare, maxRedeemableMinor, pointsEarned, pointsToRedeem } from './loyalty';

const rules = { pointValueMinor: 100, minRedeemPoints: 50 };

describe('earning points', () => {
  it('gives whole points per amount spent', () => {
    expect(pointsEarned(129_950, 10_000)).toBe(12);
    expect(pointsEarned(9_999, 10_000)).toBe(0);
    expect(pointsEarned(0, 10_000)).toBe(0);
    expect(pointsEarned(-500, 10_000)).toBe(0);
  });
});

describe('paying with points', () => {
  it('spends whole points within the minimum and the balance', () => {
    expect(pointsToRedeem(7_500, rules, 100)).toEqual({ ok: true, points: 75 });
    expect(pointsToRedeem(7_550, rules, 100)).toEqual({ ok: false, issue: 'not_whole_points' });
    expect(pointsToRedeem(4_000, rules, 100)).toEqual({ ok: false, issue: 'below_minimum' });
    expect(pointsToRedeem(20_000, rules, 100)).toEqual({ ok: false, issue: 'insufficient_points' });
    expect(pointsToRedeem(0, rules, 100)).toEqual({ ok: false, issue: 'not_whole_points' });
  });

  it('suggests the most that can be paid with points', () => {
    expect(maxRedeemableMinor(120, 9_950, rules)).toBe(9_900); // 99 whole points of the amount due
    expect(maxRedeemableMinor(80, 50_000, rules)).toBe(8_000); // the whole balance
    expect(maxRedeemableMinor(40, 50_000, rules)).toBe(0); // below the minimum
    expect(maxRedeemableMinor(-5, 50_000, rules)).toBe(0);
  });
});

describe('reversing points on returns', () => {
  it('adds up exactly over several partial returns', () => {
    const earned = 7;
    const total = 70_000;
    const first = cumulativePointShare(earned, 30_000, total); // 3
    const second = cumulativePointShare(earned, 50_000, total) - first; // 5 - 3
    const last = cumulativePointShare(earned, 70_000, total) - first - second;
    expect([first, second, last]).toEqual([3, 2, 2]);
    expect(first + second + last).toBe(earned);
  });

  it('never takes more than was given', () => {
    expect(cumulativePointShare(5, 80_000, 70_000)).toBe(5);
    expect(cumulativePointShare(0, 10_000, 70_000)).toBe(0);
    expect(cumulativePointShare(5, 10_000, 0)).toBe(0);
  });
});
