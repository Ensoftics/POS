import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { authStore } from '../lib/auth-store';
import { mockApi, renderAt, session, signedOut } from '../test/render';

describe('LoginPage', () => {
  it('shows translated validation errors and does not call the API', async () => {
    signedOut();
    const fetch = mockApi(() => ({ status: 500 }));
    renderAt('/login');
    await userEvent.click(await screen.findByRole('button', { name: 'Sign in' }));

    expect((await screen.findAllByText('This field is required')).length).toBe(2);
    expect(screen.getByLabelText('Email')).toHaveAttribute('aria-invalid', 'true');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('shows the server error for wrong credentials', async () => {
    signedOut();
    mockApi(() => ({
      status: 401,
      body: { error: { code: 'INVALID_CREDENTIALS', message: 'x' } },
    }));
    renderAt('/login');
    await userEvent.type(await screen.findByLabelText('Email'), 'ama@example.com');
    await userEvent.type(screen.getByLabelText('Password'), 'wrong-password');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Email or password is incorrect.');
  });

  it('lets users with several businesses choose one', async () => {
    signedOut();
    const second = session({
      tenant: {
        ...session().tenant,
        id: '9f9c7f43-8f43-4a63-9f6a-3b0d6f1c2a99',
        name: 'Beta Textiles',
      },
    });
    const fetch = mockApi((_url, init) => {
      const body = JSON.parse(String(init.body));
      if (!body.tenantId) {
        return {
          status: 200,
          body: {
            requiresTenantSelection: true,
            tenants: [
              {
                tenantId: session().tenant.id,
                tenantName: 'Lotus Cosmetics',
                tenantSlug: 'lotus',
                role: 'OWNER',
              },
              {
                tenantId: second.tenant.id,
                tenantName: 'Beta Textiles',
                tenantSlug: 'beta',
                role: 'CASHIER',
              },
            ],
          },
        };
      }
      return { status: 200, body: second };
    });
    renderAt('/login');
    await userEvent.type(await screen.findByLabelText('Email'), 'ama@example.com');
    await userEvent.type(screen.getByLabelText('Password'), 'correct-password');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    await userEvent.click(await screen.findByRole('button', { name: /Beta Textiles/ }));
    await waitFor(() => expect(authStore.getState().status).toBe('authenticated'));
    const lastBody = JSON.parse(String(fetch.mock.calls.at(-1)![1].body));
    expect(lastBody).toMatchObject({ tenantId: second.tenant.id, clientType: 'WEB' });
  });
});

describe('RegisterPage', () => {
  it('validates the password policy on the client', async () => {
    signedOut();
    mockApi(() => ({ status: 500 }));
    renderAt('/register');
    await userEvent.type(await screen.findByLabelText('Password'), 'short');
    await userEvent.click(screen.getByRole('button', { name: 'Create account' }));
    expect(await screen.findByText('Use at least 10 characters')).toBeInTheDocument();
    expect(screen.getByText('You must accept the terms to continue')).toBeInTheDocument();
  });

  it('maps server field errors back onto the form', async () => {
    signedOut();
    mockApi(() => ({
      status: 400,
      body: {
        error: {
          code: 'VALIDATION_FAILED',
          message: 'x',
          issues: [{ path: 'email', message: 'validation.email.invalid' }],
        },
      },
    }));
    renderAt('/register');
    await userEvent.type(await screen.findByLabelText('Business name'), 'Lotus');
    await userEvent.type(screen.getByLabelText('Your full name'), 'Ama Silva');
    await userEvent.type(screen.getByLabelText('Work email'), 'ama@example.com');
    await userEvent.type(screen.getByLabelText('Password'), 'blue-mango-river-42');
    await userEvent.click(screen.getByRole('checkbox'));
    await userEvent.click(screen.getByRole('button', { name: 'Create account' }));
    expect(await screen.findByText('Enter a valid email address')).toBeInTheDocument();
  });

  it('signs the owner in and starts onboarding', async () => {
    signedOut();
    mockApi(() => ({
      status: 201,
      body: session({
        tenant: { ...session().tenant, onboardingStatus: 'PENDING', businessType: null },
      }),
    }));
    renderAt('/register');
    await userEvent.type(await screen.findByLabelText('Business name'), 'Lotus');
    await userEvent.type(screen.getByLabelText('Your full name'), 'Ama Silva');
    await userEvent.type(screen.getByLabelText('Work email'), 'ama@example.com');
    await userEvent.type(screen.getByLabelText('Password'), 'blue-mango-river-42');
    await userEvent.click(screen.getByRole('checkbox'));
    await userEvent.click(screen.getByRole('button', { name: 'Create account' }));
    expect(
      await screen.findByRole('heading', { name: 'Set up your business' }),
    ).toBeInTheDocument();
  });
});

describe('ResetPasswordPage', () => {
  it('explains when the link has no token', async () => {
    signedOut();
    renderAt('/reset-password');
    expect(await screen.findByText(/This reset link is incomplete/)).toBeInTheDocument();
  });
});
