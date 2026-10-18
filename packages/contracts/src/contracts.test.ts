import { describe, expect, it } from 'vitest';
import {
  completeOnboardingRequestSchema,
  loginRequestSchema,
  registerRequestSchema,
  resetPasswordRequestSchema,
} from './index';

const validRegistration = {
  businessName: 'Lotus Cosmetics',
  ownerFullName: 'Ama Silva',
  email: '  Owner@Example.COM ',
  password: 'blue-mango-river-42',
  acceptTerms: true as const,
};

describe('registerRequestSchema', () => {
  it('normalises email and defaults client type', () => {
    const parsed = registerRequestSchema.parse(validRegistration);
    expect(parsed.email).toBe('owner@example.com');
    expect(parsed.clientType).toBe('WEB');
  });

  it('reports password policy issues as i18n keys', () => {
    const result = registerRequestSchema.safeParse({ ...validRegistration, password: 'short' });
    expect(result.success).toBe(false);
    const messages = result.error?.issues.map((issue) => issue.message);
    expect(messages).toContain('validation.password.too_short');
  });

  it('rejects passwords containing the owner identity', () => {
    const result = registerRequestSchema.safeParse({
      ...validRegistration,
      password: 'owner-is-the-best-1',
    });
    expect(result.error?.issues.map((issue) => issue.message)).toContain(
      'validation.password.contains_identity',
    );
  });

  it('requires accepting the terms', () => {
    const result = registerRequestSchema.safeParse({ ...validRegistration, acceptTerms: false });
    expect(result.error?.issues.map((issue) => issue.message)).toContain(
      'validation.terms.required',
    );
  });
});

describe('loginRequestSchema', () => {
  it('rejects malformed tenant ids', () => {
    const result = loginRequestSchema.safeParse({
      email: 'a@b.co',
      password: 'x',
      tenantId: 'not-a-uuid',
    });
    expect(result.success).toBe(false);
  });
});

describe('resetPasswordRequestSchema', () => {
  it('applies the password policy', () => {
    const result = resetPasswordRequestSchema.safeParse({ token: 'x'.repeat(43), password: '123' });
    expect(result.success).toBe(false);
  });
});

describe('completeOnboardingRequestSchema', () => {
  it('validates phone numbers', () => {
    expect(
      completeOnboardingRequestSchema.safeParse({
        businessName: 'Shop',
        businessType: 'TEXTILE',
        contactPhone: '+94 77 123 4567',
      }).success,
    ).toBe(true);
    expect(
      completeOnboardingRequestSchema.safeParse({
        businessName: 'Shop',
        businessType: 'TEXTILE',
        contactPhone: 'call me',
      }).success,
    ).toBe(false);
  });
});
