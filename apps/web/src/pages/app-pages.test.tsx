import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { callsTo, mockApi, renderAt, session, signedInAs, signedOut } from '../test/render';

const pendingTenant = {
  ...session().tenant,
  onboardingStatus: 'PENDING' as const,
  businessType: null,
};

describe('route guards', () => {
  it('sends anonymous visitors to sign in', async () => {
    signedOut();
    const router = renderAt('/activity');
    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/login');
  });

  it('sends owners with an unfinished profile to onboarding', async () => {
    signedInAs({ tenant: pendingTenant });
    renderAt('/');
    expect(
      await screen.findByRole('heading', { name: 'Set up your business' }),
    ).toBeInTheDocument();
  });

  it('lets cashiers into a pending business without onboarding rights', async () => {
    signedInAs({ tenant: pendingTenant, role: 'CASHIER', permissions: ['tenant.read'] });
    mockApi(() => ({ status: 404 }));
    renderAt('/');
    expect(
      await screen.findByText('The business profile is not complete yet.'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Activity log' })).not.toBeInTheDocument();
  });
});

describe('OnboardingPage', () => {
  it('requires a business type and submits the profile', async () => {
    signedInAs({ tenant: pendingTenant });
    const fetch = mockApi(() => ({
      status: 200,
      body: { ...pendingTenant, businessType: 'TEXTILE', onboardingStatus: 'COMPLETED' },
    }));
    renderAt('/onboarding');

    await userEvent.click(await screen.findByRole('button', { name: 'Finish setup' }));
    expect(await screen.findByText('Choose a business type')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('radio', { name: /Textiles & clothing/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Finish setup' }));

    expect(await screen.findByRole('heading', { name: 'Hello, Ama Silva' })).toBeInTheDocument();
    const body = JSON.parse(String(fetch.mock.calls[0]![1].body));
    expect(body).toEqual({ businessName: 'Lotus Cosmetics', businessType: 'TEXTILE' });
  });
});

describe('AuditLogPage', () => {
  it('lists events with translated labels', async () => {
    signedInAs();
    mockApi(() => ({
      status: 200,
      body: {
        items: [
          {
            id: '11111111-1111-4111-8111-111111111111',
            action: 'auth.login_succeeded',
            actorUserId: null,
            actorName: 'Ama Silva',
            entityType: 'session',
            entityId: 'x',
            metadata: null,
            ip: '203.0.113.10',
            requestId: 'r',
            createdAt: '2026-10-16T10:00:00.000Z',
          },
        ],
        nextCursor: null,
      },
    }));
    renderAt('/activity');
    expect(await screen.findByText('Signed in')).toBeInTheDocument();
    expect(screen.getByText('203.0.113.10')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Load more' })).not.toBeInTheDocument();
  });

  it('shows an empty state', async () => {
    signedInAs();
    mockApi(() => ({ status: 200, body: { items: [], nextCursor: null } }));
    renderAt('/activity');
    expect(await screen.findByText('No activity recorded yet.')).toBeInTheDocument();
  });

  it('offers a retry after a failure', async () => {
    signedInAs();
    let calls = 0;
    mockApi(() => {
      calls += 1;
      return calls === 1
        ? { status: 403, body: { error: { code: 'FORBIDDEN', message: 'x' } } }
        : { status: 200, body: { items: [], nextCursor: null } };
    });
    renderAt('/activity');
    await userEvent.click(await screen.findByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(screen.getByText('No activity recorded yet.')).toBeInTheDocument());
  });

  it('tells users without permission instead of calling the API', async () => {
    signedInAs({ role: 'CASHIER', permissions: ['tenant.read'] });
    const fetch = mockApi(() => ({ status: 500 }));
    renderAt('/activity');
    expect(
      await screen.findByText('You do not have permission to view the activity log.'),
    ).toBeInTheDocument();
    expect(callsTo(fetch, '/audit-logs')).toHaveLength(0);
  });
});
