import type { Notification } from '@pos/contracts';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { callsTo, mockApi, renderAt, signedInAs } from '../test/render';

const BRANCH = '33333333-3333-4333-8333-333333333333';
const bodyOf = (call: unknown[] | undefined) => JSON.parse(String((call?.[1] as RequestInit).body));

const alert: Notification = {
  id: '11111111-1111-4111-8111-111111111111',
  kind: 'INVENTORY_ALERT',
  data: { branchName: 'Main branch', low: 3, expiring: 1, days: 30 },
  link: `/inventory?branch=${BRANCH}&filter=LOW`,
  readAt: null,
  createdAt: '2026-10-17T02:00:00.000Z',
};
const summary: Notification = {
  id: '22222222-2222-4222-8222-222222222222',
  kind: 'DAILY_SUMMARY',
  data: {
    date: '2026-10-16',
    salesMinor: 1_250_000,
    saleCount: 14,
    refundsMinor: 50_000,
    currency: 'LKR',
  },
  link: '/reports',
  readAt: '2026-10-17T03:00:00.000Z',
  createdAt: '2026-10-17T02:00:00.000Z',
};

describe('Notifications', () => {
  it('shows notifications in plain words and opens the linked page after marking read', async () => {
    signedInAs({ permissions: ['tenant.read', 'inventory.read', 'reports.view'] });
    const fetch = mockApi((url, init) => {
      if (url.includes(`/notifications/${alert.id}/read`))
        return { status: 200, body: { ...alert, readAt: '2026-10-17T04:00:00.000Z' } };
      if (url.includes('/notifications'))
        return { status: 200, body: { items: [alert, summary], nextCursor: null } };
      if (url.includes('/me/notification-preferences'))
        return {
          status: 200,
          body: init.method === 'PUT' ? JSON.parse(String(init.body)) : { emailDigest: true },
        };
      return { status: 200, body: { items: [], nextCursor: null } };
    });
    renderAt('/notifications');
    expect(await screen.findByText('Stock needs attention at Main branch')).toBeInTheDocument();
    expect(screen.getByText('3 low on stock · 1 expiring within 30 days')).toBeInTheDocument();
    expect(screen.getByText('Sales on 2026-10-16')).toBeInTheDocument();
    expect(
      screen.getByText(/LKR\s12,500\.00 from 14 sales · Refunds LKR\s500\.00/),
    ).toBeInTheDocument();

    await userEvent.click(
      screen.getByRole('button', { name: 'Open: Stock needs attention at Main branch' }),
    );
    await waitFor(() => expect(callsTo(fetch, `/notifications/${alert.id}/read`)).toHaveLength(1));
    expect(await screen.findByRole('heading', { name: 'Inventory' })).toBeInTheDocument();
  });

  it('lets people turn the morning e-mail off', async () => {
    signedInAs({ permissions: ['tenant.read'] });
    const fetch = mockApi((url, init) =>
      url.includes('/me/notification-preferences')
        ? {
            status: 200,
            body: init.method === 'PUT' ? JSON.parse(String(init.body)) : { emailDigest: true },
          }
        : { status: 200, body: { items: [], nextCursor: null } },
    );
    renderAt('/notifications');
    expect(await screen.findByText(/Nothing new/)).toBeInTheDocument();
    const box = await screen.findByLabelText('Email me a morning summary');
    expect(box).toBeChecked();
    await userEvent.click(box);
    expect(await screen.findByText('Saved.')).toBeInTheDocument();
    const put = callsTo(fetch, '/me/notification-preferences').find(
      ([, init]) => (init as RequestInit).method === 'PUT',
    );
    expect(bodyOf(put)).toEqual({ emailDigest: false });
  });

  it('puts a notifications link in the header on every page', async () => {
    signedInAs({ permissions: ['tenant.read', 'audit.read'] });
    mockApi(() => ({ status: 200, body: { items: [], nextCursor: null } }));
    renderAt('/activity');
    // One in the desktop header, one beside the mobile menu button.
    const links = await screen.findAllByRole('link', { name: 'Notifications' });
    expect(links.length).toBeGreaterThan(0);
    for (const link of links) expect(link).toHaveAttribute('href', '/notifications');
  });
});
