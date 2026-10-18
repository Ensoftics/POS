import type { Device, StaffList } from '@pos/contracts';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { authStore } from '../../lib/auth-store';
import { callsTo, mockApi, renderAt, session, signedInAs, signedOut } from '../../test/render';

const PERMISSIONS = ['tenant.read', 'settings.read', 'branches.read', 'staff.manage'] as const;
const BRANCH_A = '33333333-3333-4333-8333-333333333333';
const BRANCH_B = '55555555-5555-4555-8555-555555555555';
const bodyOf = (call: unknown[] | undefined) => JSON.parse(String((call?.[1] as RequestInit).body));
const method = (call: unknown[]) => (call[1] as RequestInit).method ?? 'GET';

const branches = {
  items: [BRANCH_A, BRANCH_B].map((id, i) => ({
    id,
    code: i ? 'KDY' : 'MAIN',
    name: i ? 'Kandy' : 'Colombo',
    addressLine1: null,
    city: null,
    phone: null,
    status: 'ACTIVE',
    version: 1,
    createdAt: '2026-01-01T00:00:00.000Z',
    registers: [],
  })),
};

function staffList(): StaffList {
  return {
    members: [
      {
        membershipId: '11111111-1111-4111-8111-111111111111',
        userId: '6f1b2c4e-1c1a-4b7a-9a43-0f1e2d3c4b5a',
        fullName: 'Ama Silva',
        email: 'ama@example.com',
        role: 'OWNER',
        status: 'ACTIVE',
        branchIds: [],
        lastLoginAt: '2026-10-01T08:00:00.000Z',
        isSelf: true,
        manageable: false,
        version: 1,
      },
      {
        membershipId: '22222222-2222-4222-8222-222222222222',
        userId: '7f1b2c4e-1c1a-4b7a-9a43-0f1e2d3c4b5a',
        fullName: 'Kamal Perera',
        email: 'kamal@example.com',
        role: 'CASHIER',
        status: 'ACTIVE',
        branchIds: [BRANCH_B],
        lastLoginAt: null,
        isSelf: false,
        manageable: true,
        version: 4,
      },
    ],
    invitations: [
      {
        id: '99999999-9999-4999-8999-999999999999',
        email: 'nimali@example.com',
        role: 'INVENTORY_STAFF',
        branchIds: [],
        invitedByName: 'Ama Silva',
        createdAt: '2026-10-10T08:00:00.000Z',
        expiresAt: '2026-10-17T08:00:00.000Z',
        expired: false,
      },
    ],
  };
}

function api(
  extra: (url: string, init: RequestInit) => { status: number; body?: unknown } | null = () => null,
) {
  return mockApi((url, init) => {
    const handled = extra(url, init);
    if (handled) return handled;
    if (url.includes('/branches')) return { status: 200, body: branches };
    if (url.endsWith('/staff')) return { status: 200, body: staffList() };
    return { status: 404 };
  });
}

afterEach(() => vi.restoreAllMocks());

describe('Staff settings', () => {
  it('lists the team with roles, branches and pending invitations', async () => {
    signedInAs({ permissions: [...PERMISSIONS] });
    api();
    renderAt('/settings/staff');
    expect(await screen.findByText('Kamal Perera')).toBeInTheDocument();
    expect(
      await screen.findByText(
        (_, el) => el?.tagName === 'P' && el.textContent === 'Cashier · Kandy',
      ),
    ).toBeInTheDocument();
    expect(screen.getByText('Not signed in yet')).toBeInTheDocument();
    expect(screen.getByText('You')).toBeInTheDocument();
    // Nobody changes their own access.
    expect(
      screen.queryByRole('button', { name: 'Change access: Ama Silva' }),
    ).not.toBeInTheDocument();
    expect(screen.getByText('nimali@example.com')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Staff' })).toBeInTheDocument();
  });

  it('invites someone to chosen branches', async () => {
    signedInAs({ permissions: [...PERMISSIONS] });
    const fetch = api((url, init) =>
      url.endsWith('/staff/invitations') && init.method === 'POST'
        ? { status: 201, body: { ...staffList().invitations[0], ...JSON.parse(String(init.body)) } }
        : null,
    );
    renderAt('/settings/staff');
    await userEvent.click(await screen.findByRole('button', { name: 'Invite staff' }));
    await userEvent.type(screen.getByLabelText('Email address'), 'sunil@example.com');
    await userEvent.selectOptions(screen.getByLabelText('Role'), 'MANAGER');
    const group = await screen.findByRole('group', { name: 'Branches' });
    await userEvent.click(within(group).getByLabelText('Kandy'));
    await userEvent.click(screen.getByRole('button', { name: 'Send invitation' }));

    expect(await screen.findByText(/Invitation sent to sunil@example.com/)).toBeInTheDocument();
    const [post] = callsTo(fetch, '/staff/invitations').filter((c) => method(c) === 'POST');
    expect(bodyOf(post)).toEqual({
      email: 'sunil@example.com',
      role: 'MANAGER',
      branchIds: [BRANCH_B],
    });
  });

  it('offers managers only the roles below them', async () => {
    signedInAs({ role: 'MANAGER', permissions: [...PERMISSIONS] });
    api();
    renderAt('/settings/staff');
    await userEvent.click(await screen.findByRole('button', { name: 'Invite staff' }));
    const options = within(screen.getByLabelText('Role')).getAllByRole('option');
    expect(options.map((o) => o.textContent)).toEqual(['Cashier', 'Inventory staff']);
  });

  it('changes a member’s role and branches with the current version', async () => {
    signedInAs({ permissions: [...PERMISSIONS] });
    const fetch = api((url, init) =>
      init.method === 'PATCH'
        ? {
            status: 200,
            body: { ...staffList().members[1], ...JSON.parse(String(init.body)), version: 5 },
          }
        : null,
    );
    renderAt('/settings/staff');
    await userEvent.click(
      await screen.findByRole('button', { name: 'Change access: Kamal Perera' }),
    );
    await userEvent.selectOptions(screen.getByLabelText('Role'), 'INVENTORY_STAFF');
    const group = await screen.findByRole('group', { name: 'Branches' });
    await userEvent.click(within(group).getByLabelText('Colombo'));
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(
      await screen.findByText('Access updated. Kamal Perera must sign in again.'),
    ).toBeInTheDocument();
    const [patch] = callsTo(fetch, '/staff/22222222').filter((c) => method(c) === 'PATCH');
    expect(bodyOf(patch)).toEqual({
      version: 4,
      role: 'INVENTORY_STAFF',
      branchIds: expect.arrayContaining([BRANCH_A, BRANCH_B]),
    });
  });

  it('disables a member after confirmation and shows server refusals', async () => {
    signedInAs({ permissions: [...PERMISSIONS] });
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    api((_url, init) =>
      init.method === 'PATCH'
        ? { status: 409, body: { error: { code: 'LAST_OWNER', message: 'x' } } }
        : null,
    );
    renderAt('/settings/staff');
    await userEvent.click(await screen.findByRole('button', { name: 'Disable: Kamal Perera' }));
    expect(window.confirm).toHaveBeenCalledWith(
      'Disable Kamal Perera? They are signed out of every device at once.',
    );
    expect(
      await screen.findByText('A business needs at least one active owner.'),
    ).toBeInTheDocument();
  });

  it('hides staff tabs from people who cannot manage staff', async () => {
    signedInAs({ role: 'CASHIER', permissions: ['tenant.read', 'settings.read'] });
    api();
    renderAt('/settings/business');
    await screen.findByRole('link', { name: 'Business' });
    expect(screen.queryByRole('link', { name: 'Staff' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Devices' })).not.toBeInTheDocument();
  });
});

describe('Devices settings', () => {
  const device: Device = {
    id: '77777777-7777-4777-8777-777777777777',
    name: 'Front counter',
    branchId: BRANCH_A,
    branchName: 'Colombo',
    registerId: '44444444-4444-4444-8444-444444444444',
    registerName: 'Register 1',
    registeredByName: 'Kamal Perera',
    lastSeenAt: '2026-10-16T08:00:00.000Z',
    revoked: false,
    createdAt: '2026-10-01T08:00:00.000Z',
  };

  it('blocks a till after confirmation', async () => {
    signedInAs({ permissions: [...PERMISSIONS] });
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    let revoked = false;
    const fetch = api((url, init) => {
      if (url.endsWith('/revoke') && init.method === 'POST') {
        revoked = true;
        return { status: 200, body: { ...device, revoked: true } };
      }
      if (url.endsWith('/devices'))
        return { status: 200, body: { items: [{ ...device, revoked }] } };
      return null;
    });
    renderAt('/settings/devices');
    expect(await screen.findByText('Colombo · Register 1')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Block: Front counter' }));
    expect(await screen.findByText('Front counter is blocked.')).toBeInTheDocument();
    expect(callsTo(fetch, `/devices/${device.id}/revoke`)).toHaveLength(1);
    expect(
      await screen.findByRole('button', { name: 'Allow again: Front counter' }),
    ).toBeInTheDocument();
  });
});

describe('Accept invitation', () => {
  const TOKEN = 'a'.repeat(43);
  const preview = (existingAccount: boolean) => ({
    businessName: 'Lotus Cosmetics',
    email: 'kamal@example.com',
    role: 'CASHIER',
    existingAccount,
  });

  it('creates an account, signs in and clears the token from the address bar', async () => {
    signedOut();
    window.history.replaceState(null, '', `/accept-invite?token=${TOKEN}`);
    const fetch = mockApi((url, init) => {
      if (url.endsWith('/auth/invitations/preview')) return { status: 200, body: preview(false) };
      if (url.endsWith('/auth/invitations/accept'))
        return { status: 200, body: session({ role: 'CASHIER' }) };
      void init;
      return { status: 200, body: { items: [] } };
    });
    renderAt('/accept-invite');
    expect(
      await screen.findByRole('heading', { name: 'Join Lotus Cosmetics' }),
    ).toBeInTheDocument();
    expect(window.location.search).toBe('');
    expect(bodyOf(callsTo(fetch, '/auth/invitations/preview')[0])).toEqual({ token: TOKEN });

    await userEvent.type(screen.getByLabelText('Your full name'), 'Kamal Perera');
    await userEvent.type(screen.getByLabelText('Choose a password'), 'saffron-kite-harbour-9');
    await userEvent.click(screen.getByRole('button', { name: 'Join business' }));

    await waitFor(() => expect(authStore.getState().status).toBe('authenticated'));
    expect(bodyOf(callsTo(fetch, '/auth/invitations/accept')[0])).toEqual({
      token: TOKEN,
      password: 'saffron-kite-harbour-9',
      fullName: 'Kamal Perera',
      clientType: 'WEB',
    });
  });

  it('asks an existing account for its password only', async () => {
    signedOut();
    window.history.replaceState(null, '', `/accept-invite?token=${TOKEN}`);
    mockApi(() => ({ status: 200, body: preview(true) }));
    renderAt('/accept-invite');
    expect(
      await screen.findByText('This email already has an account. Enter its password to join.'),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText('Your full name')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Your password')).toBeInTheDocument();
  });

  it('explains a used or expired link', async () => {
    signedOut();
    window.history.replaceState(null, '', `/accept-invite?token=${TOKEN}`);
    mockApi(() => ({ status: 400, body: { error: { code: 'INVITATION_INVALID', message: 'x' } } }));
    renderAt('/accept-invite');
    expect(
      await screen.findByText(
        'This invitation link is invalid, used or expired. Ask for a new one.',
      ),
    ).toBeInTheDocument();
  });
});
