import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import '@/lib/i18n';
import LoginScreen from '@/app/login';
import { resetDeviceIdCache } from '@/lib/device-id';
import { sessionStore } from '@/lib/session';
import { mobileSession, respond, secureStoreMap } from '../test/fixtures';

jest.mock('expo-router', () => {
  const { Text } = jest.requireActual('react-native');
  return {
    Link: ({ children }: { children: React.ReactNode }) => <Text>{children}</Text>,
    Redirect: ({ href }: { href: string }) => <Text>{`redirect:${href}`}</Text>,
  };
});

describe('LoginScreen', () => {
  const fetchMock = jest.fn();
  beforeEach(async () => {
    secureStoreMap().clear();
    resetDeviceIdCache();
    fetchMock.mockReset();
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    await sessionStore.clear();
  });

  it('validates input before calling the API', async () => {
    await render(<LoginScreen />);
    await fireEvent.press(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findAllByText('This field is required')).toHaveLength(2);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('shows a translated error for wrong credentials', async () => {
    fetchMock.mockResolvedValue(
      respond(401, { error: { code: 'INVALID_CREDENTIALS', message: 'x' } }),
    );
    await render(<LoginScreen />);
    await fireEvent.changeText(screen.getByLabelText('Email'), 'kasun@example.com');
    await fireEvent.changeText(screen.getByLabelText('Password'), 'wrong-password');
    await fireEvent.press(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByText('Email or password is incorrect.')).toBeOnTheScreen();
  });

  it('signs in as a mobile client and stores the refresh token securely', async () => {
    fetchMock.mockResolvedValue(respond(200, mobileSession('fresh-refresh-token-0123456789')));
    await render(<LoginScreen />);
    await fireEvent.changeText(screen.getByLabelText('Email'), ' Kasun@Example.com ');
    await fireEvent.changeText(screen.getByLabelText('Password'), 'blue-mango-river-42');
    await fireEvent.press(screen.getByRole('button', { name: 'Sign in' }));

    expect(await screen.findByText('redirect:/')).toBeOnTheScreen();
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body).toMatchObject({ email: 'kasun@example.com', clientType: 'MOBILE' });
    // The install's device id goes with every sign-in so a blocked till cannot sign in.
    expect(body.deviceId).toMatch(/^[0-9a-f-]{36}$/);
    expect(secureStoreMap().get('pos.device.id')).toBe(body.deviceId);
    await waitFor(() =>
      expect(secureStoreMap().get('pos.refreshToken')).toBe('fresh-refresh-token-0123456789'),
    );
  });

  it('explains that a blocked device cannot sign in', async () => {
    fetchMock.mockResolvedValue(respond(403, { error: { code: 'DEVICE_REVOKED', message: 'x' } }));
    await render(<LoginScreen />);
    await fireEvent.changeText(screen.getByLabelText('Email'), 'kasun@example.com');
    await fireEvent.changeText(screen.getByLabelText('Password'), 'blue-mango-river-42');
    await fireEvent.press(screen.getByRole('button', { name: 'Sign in' }));
    expect(
      await screen.findByText(/This device has been blocked by the business/),
    ).toBeOnTheScreen();
  });

  it('lets the user choose between businesses', async () => {
    fetchMock
      .mockResolvedValueOnce(
        respond(200, {
          requiresTenantSelection: true,
          tenants: [
            {
              tenantId: '0b9c7f43-8f43-4a63-9f6a-3b0d6f1c2a11',
              tenantName: 'Nimal Textiles',
              tenantSlug: 'n',
              role: 'CASHIER',
            },
            {
              tenantId: '9f9c7f43-8f43-4a63-9f6a-3b0d6f1c2a99',
              tenantName: 'Lotus Cosmetics',
              tenantSlug: 'l',
              role: 'MANAGER',
            },
          ],
        }),
      )
      .mockResolvedValueOnce(respond(200, mobileSession()));
    await render(<LoginScreen />);
    await fireEvent.changeText(screen.getByLabelText('Email'), 'kasun@example.com');
    await fireEvent.changeText(screen.getByLabelText('Password'), 'blue-mango-river-42');
    await fireEvent.press(screen.getByRole('button', { name: 'Sign in' }));

    await fireEvent.press(await screen.findByRole('button', { name: 'Lotus Cosmetics · Manager' }));
    expect(await screen.findByText('redirect:/')).toBeOnTheScreen();
    expect(JSON.parse(fetchMock.mock.calls[1][1].body).tenantId).toBe(
      '9f9c7f43-8f43-4a63-9f6a-3b0d6f1c2a99',
    );
  });
});
