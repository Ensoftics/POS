import type { PlatformTenantDetail } from '@pos/contracts';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { platformStore } from '../../lib/platform';
import { callsTo, mockApi, renderAt, signedOut } from '../../test/render';

const TENANT = '0b9c7f43-8f43-4a63-9f6a-3b0d6f1c2a11';
const bodyOf = (call: unknown[] | undefined) => JSON.parse(String((call?.[1] as RequestInit).body));
const headersOf = (call: unknown[] | undefined) =>
  (call?.[1] as RequestInit).headers as Record<string, string>;

const session = {
  accessToken: 'platform-token',
  expiresAt: '2030-01-01T00:00:00.000Z',
  user: { id: '6f1b2c4e-1c1a-4b7a-9a43-0f1e2d3c4b5a', email: 'ops@ensoftic.lk', fullName: 'Ops' },
};

function detail(overrides: Partial<PlatformTenantDetail> = {}): PlatformTenantDetail {
  return {
    id: TENANT,
    name: 'Lotus Cosmetics',
    slug: 'lotus-cosmetics-a1b2c3',
    status: 'ACTIVE',
    businessType: 'COSMETICS',
    createdAt: '2026-10-01T00:00:00.000Z',
    ownerEmail: 'ama@example.com',
    subscription: {
      status: 'TRIALING',
      planCode: 'GROWTH',
      planName: 'Growth',
      interval: 'MONTH',
      trialEndsAt: '2026-10-15T00:00:00.000Z',
      currentPeriodEnd: null,
      graceEndsAt: null,
      cancelAtPeriodEnd: false,
    },
    contactPhone: null,
    onboardingStatus: 'COMPLETED',
    owners: [
      { fullName: 'Ama Silva', email: 'ama@example.com', emailVerified: true, lastLoginAt: null },
    ],
    usage: { branches: 1, registers: 1, staff: 2, devices: 0 },
    limits: { branches: 3, registers: 8, staff: 20, devices: 10 },
    invoices: [],
    payments: [],
    features: [{ key: 'notifications.email', enabled: true, overridden: false }],
    ...overrides,
  };
}

const plans = {
  items: [
    {
      code: 'GROWTH',
      name: 'Growth',
      priceMonthlyMinor: 650_000,
      priceYearlyMinor: 6_500_000,
      currency: 'LKR',
      limits: { branches: 3, registers: 8, staff: 20, devices: 10 },
      isPublic: true,
      sortOrder: 2,
      version: 1,
      subscribers: 4,
    },
  ],
};

afterEach(() => {
  platformStore.clear();
  vi.restoreAllMocks();
});

describe('Platform console', () => {
  it('sends signed-out visitors to its own sign-in, which needs an authenticator code', async () => {
    signedOut();
    const fetch = mockApi((url) =>
      url.endsWith('/platform/auth/login')
        ? { status: 200, body: session }
        : url.endsWith('/platform/overview')
          ? {
              status: 200,
              body: {
                tenants: { total: 12, suspended: 1, closed: 0, signupsLast30Days: 4 },
                subscriptions: { TRIALING: 5, ACTIVE: 6 },
                revenue: {
                  currency: 'LKR',
                  monthlyRecurringMinor: 3_900_000,
                  paidLast30DaysMinor: 1_300_000,
                  paymentsLast30Days: 2,
                },
                paymentsConfigured: true,
                lastBillingSweepAt: null,
              },
            }
          : { status: 404 },
    );
    renderAt('/platform');
    expect(await screen.findByRole('heading', { name: 'Platform console' })).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('Email'), 'ops@ensoftic.lk');
    await userEvent.type(screen.getByLabelText('Password'), 'blue-mango-river-42');
    await userEvent.type(screen.getByLabelText('Authenticator code'), '12a3456');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(await screen.findByRole('heading', { name: 'Overview' })).toBeInTheDocument();
    expect(bodyOf(callsTo(fetch, '/platform/auth/login')[0])).toEqual({
      email: 'ops@ensoftic.lk',
      password: 'blue-mango-river-42',
      code: '123456',
    });
    expect(headersOf(callsTo(fetch, '/platform/overview')[0]).Authorization).toBe(
      'Bearer platform-token',
    );
    expect(screen.getByText(/LKR\s39,000\.00/)).toBeInTheDocument();
    expect(screen.getByText('Not yet run')).toBeInTheDocument();
  });

  it('returns to sign-in when the server ends the session', async () => {
    platformStore.set(session);
    mockApi(() => ({ status: 401, body: { error: { code: 'SESSION_EXPIRED', message: 'x' } } }));
    renderAt('/platform/tenants');
    expect(
      await screen.findByText('Your console session ended. Sign in again.'),
    ).toBeInTheDocument();
  });

  it('suspends a business with a reason and shows account details only', async () => {
    platformStore.set(session);
    let status: 'ACTIVE' | 'SUSPENDED' = 'ACTIVE';
    const fetch = mockApi((url) => {
      if (url.endsWith('/suspend')) {
        status = 'SUSPENDED';
        return { status: 200, body: { ...detail(), status } };
      }
      if (url.endsWith('/platform/plans')) return { status: 200, body: plans };
      return { status: 200, body: detail({ status }) };
    });
    renderAt(`/platform/tenants/${TENANT}`);
    expect(await screen.findByRole('heading', { name: 'Lotus Cosmetics' })).toBeInTheDocument();
    expect(screen.getByText('2 / 20')).toBeInTheDocument();

    const form = screen.getByRole('form', { name: 'Suspend business' });
    await userEvent.type(within(form).getByLabelText('Reason'), 'Chargeback investigation');
    await userEvent.click(within(form).getByRole('button', { name: 'Suspend business' }));
    expect(await screen.findByRole('form', { name: 'Reinstate business' })).toBeInTheDocument();
    expect(bodyOf(callsTo(fetch, '/suspend')[0])).toEqual({ reason: 'Chargeback investigation' });
  });

  it('shows the server’s field errors on a support action', async () => {
    platformStore.set(session);
    mockApi((url) => {
      if (url.endsWith('/close'))
        return {
          status: 400,
          body: {
            error: {
              code: 'VALIDATION_FAILED',
              message: 'x',
              issues: [{ path: 'confirmSlug', message: 'validation.confirm.mismatch' }],
            },
          },
        };
      if (url.endsWith('/platform/plans')) return { status: 200, body: plans };
      return { status: 200, body: detail() };
    });
    renderAt(`/platform/tenants/${TENANT}`);
    const form = await screen.findByRole('form', { name: 'Close business' });
    expect(
      within(form).getByText(/Type the business slug \(lotus-cosmetics-a1b2c3\)/),
    ).toBeInTheDocument();
    await userEvent.type(within(form).getByLabelText('Reason'), 'Owner asked');
    await userEvent.type(within(form).getByLabelText('Business slug'), 'wrong');
    await userEvent.click(within(form).getByRole('button', { name: 'Close business' }));
    expect(
      await within(form).findByText('This does not match. Type the exact text shown.'),
    ).toBeInTheDocument();
  });

  it('edits a plan with its version, converting prices to minor units', async () => {
    platformStore.set(session);
    const fetch = mockApi((url, init) =>
      init.method === 'PATCH'
        ? { status: 200, body: { ...plans.items[0], version: 2 } }
        : { status: 200, body: plans },
    );
    renderAt('/platform/plans');
    await userEvent.click(await screen.findByRole('button', { name: 'Edit: Growth' }));
    const price = screen.getByLabelText('Monthly price (LKR)');
    await userEvent.clear(price);
    await userEvent.type(price, '7000');
    await userEvent.click(screen.getByRole('button', { name: 'Save plan' }));
    expect(await screen.findByText('Plan saved.')).toBeInTheDocument();
    await waitFor(() => expect(callsTo(fetch, '/platform/plans/GROWTH')).toHaveLength(1));
    expect(bodyOf(callsTo(fetch, '/platform/plans/GROWTH')[0])).toMatchObject({
      version: 1,
      priceMonthlyMinor: 700_000,
      limits: { branches: 3, registers: 8, staff: 20, devices: 10 },
    });
  });

  it('turns a flag on by default with its version', async () => {
    platformStore.set(session);
    const flag = {
      key: 'notifications.daily_summary',
      description: 'Yesterday summary',
      defaultEnabled: false,
      version: 3,
      overrides: 2,
    };
    const fetch = mockApi((_url, init) => ({
      status: 200,
      body: {
        items: [init.method === 'PATCH' ? { ...flag, defaultEnabled: true, version: 4 } : flag],
      },
    }));
    renderAt('/platform/flags');
    expect(await screen.findByText('2 businesses with their own setting')).toBeInTheDocument();
    await userEvent.click(
      screen.getByRole('button', { name: 'Turn on by default: notifications.daily_summary' }),
    );
    expect(
      await screen.findByRole('button', {
        name: 'Turn off by default: notifications.daily_summary',
      }),
    ).toBeInTheDocument();
    expect(bodyOf(callsTo(fetch, '/platform/flags/notifications.daily_summary')[0])).toEqual({
      defaultEnabled: true,
      version: 3,
    });
  });
});
