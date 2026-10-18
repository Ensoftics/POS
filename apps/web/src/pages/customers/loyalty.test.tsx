import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { callsTo, mockApi, renderAt, settingsFixture, signedInAs } from '../../test/render';

const CUSTOMER = 'c0c0c0c0-c0c0-4c0c-8c0c-c0c0c0c0c0c0';
const bodyOf = (call: unknown[] | undefined) => JSON.parse(String((call?.[1] as RequestInit).body));
const loyaltyOn = settingsFixture({
  loyalty: { enabled: true, spendPerPointMinor: 10_000, pointValueMinor: 100, minRedeemPoints: 10 },
});

const customer = {
  id: CUSTOMER,
  number: 'CUS-000001',
  name: 'Nimali Perera',
  phone: '+94771234567',
  email: null,
  address: null,
  notes: null,
  marketingConsent: false,
  marketingConsentAt: null,
  creditLimitMinor: 0,
  balanceMinor: 0,
  availableCreditMinor: 0,
  loyaltyPoints: 61,
  status: 'ACTIVE',
  version: 1,
  createdAt: '2026-10-17T08:00:00.000Z',
};
const history = (balance: number) => ({
  balance,
  items: [
    {
      id: '11111111-1111-4111-8111-111111111111',
      type: 'EARN',
      points: 11,
      balanceAfter: 61,
      referenceType: 'sale',
      referenceId: '99999999-9999-4999-8999-999999999999',
      referenceNumber: 'INV-000007',
      note: null,
      createdAt: '2026-10-17T08:00:00.000Z',
    },
  ],
  nextCursor: null,
});

describe('Customer points', () => {
  it('shows the balance and history, and lets managers adjust with a reason', async () => {
    signedInAs({
      permissions: ['tenant.read', 'settings.read', 'customers.read', 'customers.credit'],
      features: ['loyalty'],
    });
    const fetch = mockApi((url, init) => {
      if (url.includes('/loyalty/adjust')) return { status: 200, body: history(71) };
      if (url.includes('/loyalty')) return { status: 200, body: history(61) };
      if (url.endsWith(`/customers/${CUSTOMER}`)) return { status: 200, body: customer };
      void init;
      return {
        status: 200,
        body: { items: [], nextCursor: null, lines: [], openingMinor: 0, closingMinor: 0 },
      };
    }, loyaltyOn);
    renderAt(`/customers/${CUSTOMER}`);
    expect(await screen.findByText('61 points')).toBeInTheDocument();
    const list = screen.getByRole('list', { name: 'Points history' });
    expect(within(list).getByText(/Earned · INV-000007/)).toBeInTheDocument();
    expect(within(list).getByText('+11 → 61')).toBeInTheDocument();

    const form = screen.getByRole('form', { name: 'Adjust points' });
    await userEvent.type(within(form).getByLabelText('Points (minus to deduct)'), '10');
    await userEvent.type(within(form).getByLabelText('Reason'), 'Birthday gift');
    await userEvent.click(within(form).getByRole('button', { name: 'Save adjustment' }));
    expect(await screen.findByText('Points updated.')).toBeInTheDocument();
    const [post] = callsTo(fetch, '/loyalty/adjust');
    expect(bodyOf(post)).toMatchObject({ points: 10, reason: 'Birthday gift' });
    expect(bodyOf(post).id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('hides points when the business has loyalty off', async () => {
    signedInAs({
      permissions: ['tenant.read', 'settings.read', 'customers.read'],
      features: ['loyalty'],
    });
    mockApi((url) =>
      url.endsWith(`/customers/${CUSTOMER}`)
        ? { status: 200, body: customer }
        : { status: 200, body: { items: [], nextCursor: null } },
    );
    renderAt(`/customers/${CUSTOMER}`);
    expect(await screen.findByRole('heading', { name: 'Nimali Perera' })).toBeInTheDocument();
    expect(screen.queryByText('Loyalty points')).toBeNull();
  });
});

describe('Loyalty settings', () => {
  it('switches loyalty on with rates entered as money', async () => {
    signedInAs({
      permissions: ['tenant.read', 'settings.read', 'settings.update'],
      features: ['loyalty'],
    });
    const fetch = mockApi((url, init) =>
      url.endsWith('/settings') && init.method === 'PATCH'
        ? { status: 200, body: { ...loyaltyOn, version: 4 } }
        : { status: 200, body: { items: [] } },
    );
    renderAt('/settings/checkout');
    const section = (await screen.findByRole('heading', { name: 'Loyalty points' })).closest(
      'section',
    )!;
    await userEvent.click(within(section).getByLabelText('Customers earn and use points'));
    const spend = within(section).getByLabelText('Spend for 1 point');
    await userEvent.clear(spend);
    await userEvent.type(spend, '200');
    await userEvent.click(within(section).getByRole('button', { name: 'Save changes' }));
    await waitFor(() =>
      expect(
        callsTo(fetch, '/settings').filter(([, init]) => (init as RequestInit).method === 'PATCH'),
      ).toHaveLength(1),
    );
    const patch = callsTo(fetch, '/settings').find(
      ([, init]) => (init as RequestInit).method === 'PATCH',
    );
    expect(bodyOf(patch)).toMatchObject({
      version: 3,
      loyalty: {
        enabled: true,
        spendPerPointMinor: 20_000,
        pointValueMinor: 100,
        minRedeemPoints: 0,
      },
    });
  });

  it('explains when the platform has loyalty switched off', async () => {
    signedInAs({ permissions: ['tenant.read', 'settings.read', 'settings.update'], features: [] });
    mockApi(() => ({ status: 200, body: { items: [] } }));
    renderAt('/settings/checkout');
    expect(
      await screen.findByText(/Loyalty is not available for this business/),
    ).toBeInTheDocument();
  });
});
