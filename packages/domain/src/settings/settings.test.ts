import { describe, expect, it } from 'vitest';
import {
  BUSINESS_PROFILE_PRESETS,
  CURRENCIES,
  isCurrencyCode,
  isValidTimeZone,
  LOCATION_CODE_PATTERN,
  normaliseLocationCode,
  profileFor,
} from '../index';

describe('currencies', () => {
  it('defaults include LKR with two minor units', () => {
    expect(CURRENCIES.LKR.minorUnits).toBe(2);
    expect(isCurrencyCode('LKR')).toBe(true);
    expect(isCurrencyCode('lkr')).toBe(false);
    expect(isCurrencyCode('XYZ')).toBe(false);
  });
});

describe('timezones', () => {
  it('accepts IANA zones and rejects junk', () => {
    expect(isValidTimeZone('Asia/Colombo')).toBe(true);
    expect(isValidTimeZone('UTC')).toBe(true);
    expect(isValidTimeZone('Mars/Olympus')).toBe(false);
    expect(isValidTimeZone('Asia/Colombo; DROP TABLE')).toBe(false);
  });
});

describe('business profiles', () => {
  it('enables batches and expiry for cosmetics and metres for textiles', () => {
    expect(BUSINESS_PROFILE_PRESETS.COSMETICS.trackExpiryDates).toBe(true);
    expect(BUSINESS_PROFILE_PRESETS.TEXTILE.allowFractionalQuantities).toBe(true);
    expect(BUSINESS_PROFILE_PRESETS.TEXTILE.defaultUnits).toContain('metre');
  });

  it('falls back to a neutral profile', () => {
    expect(profileFor(null).variantAttributes).toEqual([]);
  });
});

describe('location codes', () => {
  it('normalises and validates', () => {
    expect(normaliseLocationCode(' col main ')).toBe('COL-MAIN');
    expect(LOCATION_CODE_PATTERN.test('COL-01')).toBe(true);
    expect(LOCATION_CODE_PATTERN.test('-BAD')).toBe(false);
    expect(LOCATION_CODE_PATTERN.test('WAY-TOO-LONG-CODE')).toBe(false);
  });
});
