import { describe, expect, it } from 'vitest';
import { authContextSchema, checkoutRequestSchema, checkoutResponseSchema } from './index';

describe('billing contracts', () => {
  it('defaults checkout to a monthly period and rejects unknown intervals', () => {
    expect(checkoutRequestSchema.parse({ planCode: ' GROWTH ' })).toEqual({
      planCode: 'GROWTH',
      interval: 'MONTH',
    });
    expect(checkoutRequestSchema.safeParse({ planCode: 'GROWTH', interval: 'WEEK' }).success).toBe(
      false,
    );
  });

  it('only accepts an absolute provider URL to send the browser to', () => {
    const invoice = {
      id: '99999999-9999-4999-8999-999999999999',
      number: 'SUB-000001',
      planName: 'Growth',
      interval: 'MONTH',
      status: 'OPEN',
      subtotalMinor: 1,
      taxRateBp: 0,
      taxMinor: 0,
      totalMinor: 1,
      currency: 'LKR',
      periodStart: null,
      periodEnd: null,
      paidAt: null,
      createdAt: '2026-10-17T00:00:00.000Z',
    };
    const redirect = { method: 'POST', url: 'javascript:alert(1)', fields: {} };
    expect(checkoutResponseSchema.safeParse({ invoice, redirect }).success).toBe(false);
    expect(
      checkoutResponseSchema.safeParse({
        invoice,
        redirect: { ...redirect, url: 'https://sandbox.payhere.lk/pay/checkout' },
      }).success,
    ).toBe(true);
  });

  it('accepts sessions from servers with and without subscription details', () => {
    const base = {
      user: {
        id: '6f1b2c4e-1c1a-4b7a-9a43-0f1e2d3c4b5a',
        email: 'a@b.co',
        fullName: 'A',
        isPlatformAdmin: false,
      },
      tenant: {
        id: '0b9c7f43-8f43-4a63-9f6a-3b0d6f1c2a11',
        name: 'Lotus',
        slug: 'lotus-a1b2c3',
        status: 'ACTIVE',
        businessType: null,
        contactPhone: null,
        onboardingStatus: 'COMPLETED',
        onboardingCompletedAt: null,
        createdAt: '2026-01-01T00:00:00.000Z',
      },
      role: 'OWNER',
      permissions: ['billing.manage'],
      memberships: [],
    };
    expect(authContextSchema.safeParse(base).success).toBe(true);
    const withSubscription = authContextSchema.parse({
      ...base,
      subscription: {
        status: 'PAST_DUE',
        planName: 'Growth',
        trialEndsAt: null,
        currentPeriodEnd: '2026-10-01T00:00:00.000Z',
        graceEndsAt: '2026-10-08T00:00:00.000Z',
        cancelAtPeriodEnd: false,
      },
    });
    expect(withSubscription.subscription?.status).toBe('PAST_DUE');
  });
});
