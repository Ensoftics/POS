import { describe, expect, it } from 'vitest';
import { isDailyRunDue, previousDate, resolveFeatureFlags } from './notifications';

describe('feature flags', () => {
  it('uses the business override over the default and ignores unknown keys', () => {
    const defaults = [
      { key: 'notifications.daily_summary', defaultEnabled: true },
      { key: 'notifications.email', defaultEnabled: true },
      { key: 'retired.flag', defaultEnabled: true },
    ];
    expect(resolveFeatureFlags(defaults, [])).toEqual([
      'notifications.daily_summary',
      'notifications.email',
    ]);
    expect(
      resolveFeatureFlags(defaults, [{ flagKey: 'notifications.email', enabled: false }]),
    ).toEqual(['notifications.daily_summary']);
    expect(
      resolveFeatureFlags(
        [{ key: 'notifications.email', defaultEnabled: false }],
        [{ flagKey: 'notifications.email', enabled: true }],
      ),
    ).toEqual(['notifications.email']);
  });
});

describe('daily run timing', () => {
  it('starts at the local digest hour', () => {
    expect(isDailyRunDue(6)).toBe(false);
    expect(isDailyRunDue(7)).toBe(true);
    expect(isDailyRunDue(23)).toBe(true);
  });

  it('finds the previous business date across month and year ends', () => {
    expect(previousDate('2026-10-17')).toBe('2026-10-16');
    expect(previousDate('2026-03-01')).toBe('2026-02-28');
    expect(previousDate('2027-01-01')).toBe('2026-12-31');
  });
});
