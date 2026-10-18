import { describe, expect, it } from 'vitest';
import {
  createBranchRequestSchema,
  updateBranchRequestSchema,
  updateTenantSettingsRequestSchema,
} from './index';

const messages = (result: { error?: { issues: { message: string }[] } }) =>
  result.error?.issues.map((issue) => issue.message) ?? [];

describe('updateTenantSettingsRequestSchema', () => {
  it('accepts a partial update and turns blank text into null', () => {
    const parsed = updateTenantSettingsRequestSchema.parse({
      version: 3,
      legalName: '  ',
      currency: 'LKR',
      timezone: 'Asia/Colombo',
      country: 'lk',
    });
    expect(parsed).toMatchObject({ legalName: null, currency: 'LKR', country: 'LK' });
  });

  it('rejects unknown currencies and timezones', () => {
    const result = updateTenantSettingsRequestSchema.safeParse({
      version: 1,
      currency: 'XYZ',
      timezone: 'Mars/Base',
    });
    expect(messages(result)).toEqual(
      expect.arrayContaining(['validation.currency.invalid', 'validation.timezone.invalid']),
    );
  });

  it('requires the default language to be enabled', () => {
    const result = updateTenantSettingsRequestSchema.safeParse({
      version: 1,
      defaultLanguage: 'si',
      enabledLanguages: ['en'],
    });
    expect(messages(result)).toContain('validation.languages.default_not_enabled');
  });

  it('requires at least one default unit in the profile', () => {
    const result = updateTenantSettingsRequestSchema.safeParse({
      version: 1,
      profile: {
        trackBatchNumbers: false,
        trackExpiryDates: false,
        allowFractionalQuantities: false,
        variantAttributes: [],
        defaultUnits: [],
      },
    });
    expect(messages(result)).toContain('validation.units.required');
  });
});

describe('branch schemas', () => {
  it('normalises codes and optional fields', () => {
    const parsed = createBranchRequestSchema.parse({
      code: ' col 1 ',
      name: 'Colombo',
      city: '',
      phone: '',
    });
    expect(parsed).toEqual({ code: 'COL-1', name: 'Colombo', city: null, phone: null });
  });

  it('rejects invalid codes', () => {
    expect(messages(createBranchRequestSchema.safeParse({ code: '$$', name: 'X1' }))).toContain(
      'validation.code.invalid',
    );
  });

  it('requires a version on update', () => {
    expect(updateBranchRequestSchema.safeParse({ name: 'New name' }).success).toBe(false);
  });
});
