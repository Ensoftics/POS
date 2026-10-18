import type { BillingOverview } from '@pos/contracts';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { authStore } from '../../lib/auth-store';
import { callsTo, mockApi, renderAt, session, signedInAs, signedOut } from '../../test/render';

const PERMISSIONS = ['tenant.read', 'settings.read', 'billing.manage'] as const;
const INVOICE = '99999999-9999-4999-8999-999999999999';
const bodyOf = (call: unknown[] | undefined) => JSON.parse(String((call?.[1] as RequestInit).body));

const plan = (code: string, name: string, monthly: number, limits: number[]) => ({
  code,
  name,
  priceMonthlyMinor: monthly,
  priceYearlyMinor: monthly * 10,
  currency: 'LKR',
  limits: { branches: limits[0]!, registers: limits[1]!, staff: limits[2]!, devices: limits[3]! },
});

function overview(overrides: Partial<BillingOverview> = {}): BillingOverview {
  const growth = plan('GROWTH', 'Growth', 650_000, [3, 8, 20, 10]);
  return {
    subscription: {
      status: 'TRIALING',
      planName: 'Growth',
      trialEndsAt: new Date(Date.now() + 5 * 86_400_000).toISOString(),
      currentPeriodEnd: null,
      graceEndsAt: null,
      cancelAtPeriodEnd: false,
      plan: growth,
      interval: 'MONTH',
      currentPeriodStart: null,
      version: 1,
    },
    usage: { branches: 3, registers: 2, staff: 4, devices: 0 },
    plans: [plan('STARTER', 'Starter', 250_000, [1, 2, 5, 2]), growth],
    invoices: [],
    paymentsAvailable: true,
    emailVerified: true,
    ...overrides,
  };
}

afterEach(() => vi.restoreAllMocks());

describe('Billing settings', () => {
  it('shows the trial, usage against limits and plan prices', async () => {
    signedInAs({ permissions: [...PERMISSIONS] });
    mockApi((url) =>
      url.endsWith('/billing') ? { status: 200, body: overview() } : { status: 404 },
    );
    renderAt('/settings/billing');
    expect(await screen.findByText(/Free trial until .* \(5 days left\)/)).toBeInTheDocument();
    expect(screen.getByRole('progressbar', { name: 'Branches' })).toHaveAttribute(
      'aria-valuenow',
      '3',
    );
    expect(screen.getByText('3 of 3')).toBeInTheDocument();
    expect(screen.getByText(/LKR\s6,500\.00 per month/)).toBeInTheDocument();
    await userEvent.click(screen.getByLabelText('Yearly'));
    expect(screen.getByText(/LKR\s65,000\.00 per year/)).toBeInTheDocument();
    expect(screen.getByText('Your plan')).toBeInTheDocument();
  });

  it('opens the hosted checkout with a form POST', async () => {
    signedInAs({ permissions: [...PERMISSIONS] });
    const submit = vi.spyOn(HTMLFormElement.prototype, 'submit').mockImplementation(() => {});
    const fetch = mockApi((url, init) => {
      if (url.endsWith('/billing/checkout'))
        return {
          status: 200,
          body: {
            invoice: {
              id: INVOICE,
              number: 'SUB-000001',
              planName: 'Starter',
              interval: 'YEAR',
              status: 'OPEN',
              subtotalMinor: 2_500_000,
              taxRateBp: 0,
              taxMinor: 0,
              totalMinor: 2_500_000,
              currency: 'LKR',
              periodStart: null,
              periodEnd: null,
              paidAt: null,
              createdAt: '2026-10-17T00:00:00.000Z',
            },
            redirect: {
              method: 'POST',
              url: 'https://sandbox.payhere.lk/pay/checkout',
              fields: { merchant_id: '1211149', order_id: INVOICE, hash: 'ABC' },
            },
          },
        };
      void init;
      return {
        status: 200,
        body: overview({ usage: { branches: 1, registers: 1, staff: 1, devices: 0 } }),
      };
    });
    renderAt('/settings/billing');
    await userEvent.click(await screen.findByLabelText('Yearly'));
    await userEvent.click(screen.getByRole('button', { name: 'Pay for Starter' }));

    await waitFor(() => expect(submit).toHaveBeenCalled());
    expect(bodyOf(callsTo(fetch, '/billing/checkout')[0])).toEqual({
      planCode: 'STARTER',
      interval: 'YEAR',
    });
    const form = submit.mock.contexts[0] as HTMLFormElement;
    expect(form.action).toBe('https://sandbox.payhere.lk/pay/checkout');
    expect(form.method).toBe('post');
    expect((form.elements.namedItem('order_id') as HTMLInputElement).value).toBe(INVOICE);
    expect(screen.getByText('Taking you to PayHere…')).toBeInTheDocument();
  });

  it('explains why paying is not possible yet', async () => {
    signedInAs({ permissions: [...PERMISSIONS] });
    mockApi(() => ({ status: 200, body: overview({ emailVerified: false }) }));
    renderAt('/settings/billing');
    expect(
      await screen.findByText('Confirm your email address before paying.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Pay for Growth' })).toBeDisabled();
  });

  it('shows the server’s reason when a smaller plan does not fit', async () => {
    signedInAs({ permissions: [...PERMISSIONS] });
    mockApi((url) =>
      url.endsWith('/billing/checkout')
        ? {
            status: 400,
            body: {
              error: {
                code: 'VALIDATION_FAILED',
                message: 'x',
                issues: [{ path: 'planCode', message: 'validation.plan.too_many_branches' }],
              },
            },
          }
        : { status: 200, body: overview() },
    );
    renderAt('/settings/billing');
    await userEvent.click(await screen.findByRole('button', { name: 'Pay for Starter' }));
    expect(await screen.findByText('Please correct the highlighted fields.')).toBeInTheDocument();
  });

  it('waits for the payment confirmation after returning from PayHere', async () => {
    signedInAs({ permissions: [...PERMISSIONS] });
    let calls = 0;
    const paid = {
      id: INVOICE,
      number: 'SUB-000001',
      planName: 'Growth',
      interval: 'MONTH' as const,
      status: 'PAID' as const,
      subtotalMinor: 650_000,
      taxRateBp: 0,
      taxMinor: 0,
      totalMinor: 650_000,
      currency: 'LKR',
      periodStart: '2026-10-22T00:00:00.000Z',
      periodEnd: '2026-11-22T00:00:00.000Z',
      paidAt: '2026-10-17T00:00:00.000Z',
      createdAt: '2026-10-17T00:00:00.000Z',
    };
    mockApi((url) => {
      if (url.endsWith('/auth/me'))
        return { status: 200, body: session({ permissions: [...PERMISSIONS] }) };
      calls += 1;
      return {
        status: 200,
        body: overview(
          calls > 1
            ? { invoices: [paid] }
            : { invoices: [{ ...paid, status: 'OPEN', paidAt: null }] },
        ),
      };
    });
    renderAt(`/settings/billing?checkout=return&invoice=${INVOICE}`);
    expect(await screen.findByText(/waiting for PayHere to confirm/)).toBeInTheDocument();
    expect(
      await screen.findByText('Payment received. Your plan is active.', {}, { timeout: 8_000 }),
    ).toBeInTheDocument();
    expect(screen.getByText('SUB-000001')).toBeInTheDocument();
  });

  it('cancels at the period end after confirmation', async () => {
    signedInAs({ permissions: [...PERMISSIONS] });
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const fetch = mockApi((url) =>
      url.endsWith('/billing/cancel')
        ? { status: 200, body: { ...overview().subscription, cancelAtPeriodEnd: true, version: 2 } }
        : { status: 200, body: overview() },
    );
    renderAt('/settings/billing');
    await userEvent.click(await screen.findByRole('button', { name: 'Cancel at period end' }));
    expect(await screen.findByText(/The subscription will end on/)).toBeInTheDocument();
    expect(bodyOf(callsTo(fetch, '/billing/cancel')[0])).toEqual({ version: 1 });
  });
});

describe('Account banners', () => {
  it('shows read-only mode on every page with a link to billing', async () => {
    signedInAs({
      permissions: [...PERMISSIONS],
      subscription: {
        status: 'SUSPENDED',
        planName: 'Growth',
        trialEndsAt: null,
        currentPeriodEnd: null,
        graceEndsAt: null,
        cancelAtPeriodEnd: false,
      },
    });
    mockApi(() => ({ status: 200, body: { items: [] } }));
    renderAt('/activity');
    expect(await screen.findByText(/Read-only until a plan is paid/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Plan & billing' })).toHaveAttribute(
      'href',
      '/settings/billing',
    );
  });

  it('asks owners to confirm their e-mail and can resend the link', async () => {
    signedInAs({
      permissions: [...PERMISSIONS],
      user: { ...session().user, emailVerified: false },
    });
    const fetch = mockApi((url) =>
      url.endsWith('/auth/email/verification')
        ? { status: 202, body: { accepted: true } }
        : { status: 200, body: { items: [] } },
    );
    renderAt('/activity');
    expect(await screen.findByText(/We sent a link to ama@example.com/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Send again' }));
    expect(await screen.findByText('Sent. Check your inbox.')).toBeInTheDocument();
    expect(callsTo(fetch, '/auth/email/verification')).toHaveLength(1);
  });
});

describe('Verify email page', () => {
  it('confirms the address from the link and clears the token from the address bar', async () => {
    signedOut();
    const token = 'b'.repeat(43);
    window.history.replaceState(null, '', `/verify-email?token=${token}`);
    const fetch = mockApi(() => ({ status: 200, body: { accepted: true } }));
    renderAt('/verify-email');
    expect(await screen.findByText('Your email address is confirmed.')).toBeInTheDocument();
    expect(window.location.search).toBe('');
    expect(bodyOf(callsTo(fetch, '/auth/email/verify')[0])).toEqual({ token });
    expect(authStore.getState().status).toBe('anonymous');
  });

  it('explains an expired link', async () => {
    signedOut();
    window.history.replaceState(null, '', `/verify-email?token=${'c'.repeat(43)}`);
    mockApi(() => ({
      status: 400,
      body: { error: { code: 'INVALID_VERIFICATION_TOKEN', message: 'x' } },
    }));
    renderAt('/verify-email');
    expect(
      await screen.findByText(/This confirmation link is invalid or has expired/),
    ).toBeInTheDocument();
  });
});
