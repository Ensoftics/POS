import type { Branch } from '@pos/contracts';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { callsTo, mockApi, renderAt, settingsFixture, signedInAs } from '../../test/render';

const OWNER_PERMISSIONS = [
  'tenant.read',
  'tenant.update',
  'tenant.onboarding.complete',
  'audit.read',
  'settings.read',
  'settings.update',
  'branches.read',
  'branches.manage',
] as const;

const bodyOf = (call: unknown[] | undefined) => JSON.parse(String((call?.[1] as RequestInit).body));

function branch(overrides: Partial<Branch> = {}): Branch {
  return {
    id: '33333333-3333-4333-8333-333333333333',
    code: 'MAIN',
    name: 'Main branch',
    addressLine1: null,
    city: null,
    phone: null,
    status: 'ACTIVE',
    version: 1,
    createdAt: '2026-01-01T00:00:00.000Z',
    registers: [
      {
        id: '44444444-4444-4444-8444-444444444444',
        branchId: '33333333-3333-4333-8333-333333333333',
        code: 'R1',
        name: 'Register 1',
        status: 'ACTIVE',
        version: 1,
        createdAt: '2026-01-01T00:00:00.000Z',
      },
    ],
    ...overrides,
  };
}

describe('Localization settings', () => {
  it('saves currency and timezone with the current version', async () => {
    signedInAs({ permissions: [...OWNER_PERMISSIONS] });
    const fetch = mockApi((_url, init) => ({
      status: 200,
      body: settingsFixture({ ...JSON.parse(String(init.body)), version: 4 }),
    }));
    renderAt('/settings/localization');

    await userEvent.selectOptions(await screen.findByLabelText('Currency'), 'USD');
    expect(screen.getByText(/Preview: \$1,234\.50/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));

    expect(await screen.findByText('Changes saved.')).toBeInTheDocument();
    const [patch] = callsTo(fetch, '/settings').filter(
      ([, init]) => (init as RequestInit).method === 'PATCH',
    );
    expect(bodyOf(patch)).toMatchObject({ version: 3, currency: 'USD', timezone: 'Asia/Colombo' });
  });

  it('blocks disabling the default language', async () => {
    signedInAs({ permissions: [...OWNER_PERMISSIONS] });
    const fetch = mockApi(() => ({ status: 500 }));
    renderAt('/settings/localization');
    const group = await screen.findByRole('group', { name: 'Languages available to staff' });
    await userEvent.click(within(group).getByLabelText('English'));
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(
      await screen.findByText('The default language must be one of the enabled languages'),
    ).toBeInTheDocument();
    expect(
      callsTo(fetch, '/settings').every(([, init]) => (init as RequestInit).method !== 'PATCH'),
    ).toBe(true);
  });

  it('reloads the latest values after a version conflict', async () => {
    signedInAs({ permissions: [...OWNER_PERMISSIONS] });
    let current = settingsFixture();
    mockApi(
      () => {
        // Someone else saved in the meantime.
        current = settingsFixture({ version: 9, currency: 'INR' });
        return { status: 409, body: { error: { code: 'VERSION_CONFLICT', message: 'x' } } };
      },
      () => current,
    );
    renderAt('/settings/localization');
    await userEvent.selectOptions(await screen.findByLabelText('Currency'), 'USD');
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));

    expect(await screen.findByText(/Someone else changed these settings/)).toBeInTheDocument();
    await waitFor(() => expect(screen.getByLabelText('Currency')).toHaveValue('INR'));
  });

  it('is read-only for managers', async () => {
    signedInAs({
      role: 'MANAGER',
      permissions: [
        'tenant.read',
        'audit.read',
        'settings.read',
        'branches.read',
        'branches.manage',
      ],
    });
    mockApi(() => ({ status: 500 }));
    renderAt('/settings/business');
    expect(
      await screen.findByText('Only the business owner can change these settings.'),
    ).toBeInTheDocument();
    expect(screen.getByLabelText(/Registered business name/)).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Save changes' })).not.toBeInTheDocument();
  });
});

describe('Product options', () => {
  it('applies the industry preset and requires at least one unit', async () => {
    signedInAs({ permissions: [...OWNER_PERMISSIONS] });
    const fetch = mockApi((_url, init) => ({
      status: 200,
      body: settingsFixture({ ...JSON.parse(String(init.body)), version: 4 }),
    }));
    renderAt('/settings/profile');

    const units = await screen.findByRole('group', { name: 'Units of measure' });
    await userEvent.click(within(units).getByLabelText('Piece'));
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(await screen.findByText('Choose at least one unit')).toBeInTheDocument();

    await userEvent.click(
      screen.getByRole('button', { name: 'Use recommended options for Cosmetics & beauty' }),
    );
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(await screen.findByText('Changes saved.')).toBeInTheDocument();
    const [patch] = callsTo(fetch, '/settings').filter(
      ([, init]) => (init as RequestInit).method === 'PATCH',
    );
    expect(bodyOf(patch).profile).toMatchObject({
      trackExpiryDates: true,
      defaultUnits: ['piece', 'pack', 'millilitre', 'gram'],
    });
  });
});

describe('Branches and registers', () => {
  it('lists branches with their registers', async () => {
    signedInAs({ permissions: [...OWNER_PERMISSIONS] });
    mockApi(() => ({ status: 200, body: { items: [branch()] } }));
    renderAt('/settings/locations');
    const card = await screen.findByRole('region', { name: /Main branch/ });
    expect(within(card).getByText('Register 1')).toBeInTheDocument();
    expect(within(card).getByText('R1')).toBeInTheDocument();
  });

  it('adds a branch and shows duplicate-code errors from the server', async () => {
    signedInAs({ permissions: [...OWNER_PERMISSIONS] });
    let attempts = 0;
    const fetch = mockApi((url, init) => {
      if (init.method === 'POST' && url.endsWith('/branches')) {
        attempts += 1;
        return attempts === 1
          ? { status: 409, body: { error: { code: 'DUPLICATE_CODE', message: 'x' } } }
          : {
              status: 201,
              body: branch({
                id: '55555555-5555-4555-8555-555555555555',
                code: 'KANDY',
                name: 'Kandy',
              }),
            };
      }
      return { status: 200, body: { items: [branch()] } };
    });
    renderAt('/settings/locations');

    await userEvent.click(await screen.findByRole('button', { name: 'Add branch' }));
    const form = screen.getByRole('region', { name: 'Add branch' });
    await userEvent.type(within(form).getByLabelText('Name'), 'Kandy');
    await userEvent.type(within(form).getByLabelText('Code'), 'main');
    await userEvent.click(within(form).getByRole('button', { name: 'Save' }));
    expect(await within(form).findByRole('alert')).toHaveTextContent('This code is already used.');

    await userEvent.clear(within(form).getByLabelText('Code'));
    await userEvent.type(within(form).getByLabelText('Code'), 'kandy');
    await userEvent.click(within(form).getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('Branch added.')).toBeInTheDocument();
    const posts = callsTo(fetch, '/branches').filter(
      ([, init]) => (init as RequestInit).method === 'POST',
    );
    expect(bodyOf(posts.at(-1))).toMatchObject({ code: 'KANDY', name: 'Kandy' });
  });

  it('hides management actions from cashiers', async () => {
    signedInAs({ role: 'CASHIER', permissions: ['tenant.read', 'settings.read', 'branches.read'] });
    mockApi(() => ({ status: 200, body: { items: [branch()] } }));
    renderAt('/settings/locations');
    await screen.findByRole('region', { name: /Main branch/ });
    expect(screen.queryByRole('button', { name: 'Add branch' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Archive' })).not.toBeInTheDocument();
  });
});
