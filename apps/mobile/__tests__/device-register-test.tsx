import type { Branch } from '@pos/contracts';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import '@/lib/i18n';
import SelectRegisterScreen from '@/app/(app)/register';
import {
  readDeviceRegister,
  resolveDeviceRegister,
  saveDeviceRegister,
} from '@/lib/device-register';
import { resetDeviceIdCache } from '@/lib/device-id';
import { sessionStore } from '@/lib/session';
import { mobileSession, respond, secureStoreMap } from '../test/fixtures';

const mockReplace = jest.fn();
jest.mock('expo-router', () => ({ router: { replace: (href: string) => mockReplace(href) } }));

const TENANT = mobileSession().tenant.id;

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

describe('device register selection', () => {
  const fetchMock = jest.fn();
  beforeEach(async () => {
    secureStoreMap().clear();
    resetDeviceIdCache();
    fetchMock.mockReset();
    mockReplace.mockReset();
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    await sessionStore.applySession(mobileSession());
  });

  const enrolled = (body: { name: string; registerId: string }, id: string) => ({
    id,
    name: body.name,
    branchId: branch().id,
    branchName: 'Main branch',
    registerId: body.registerId,
    registerName: 'Register 1',
    registeredByName: null,
    lastSeenAt: '2026-10-17T00:00:00.000Z',
    revoked: false,
    createdAt: '2026-10-17T00:00:00.000Z',
  });

  it('enrols this device for the chosen register and returns home', async () => {
    fetchMock.mockImplementation(async (url: string, init: RequestInit) => {
      if (url.includes('/devices/')) {
        const id = url.split('/devices/')[1]!;
        return respond(200, enrolled(JSON.parse(String(init.body)), id));
      }
      return respond(200, { items: [branch()] });
    });
    await render(<SelectRegisterScreen />);
    await fireEvent.press(await screen.findByRole('button', { name: 'Register 1 (R1)' }));

    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/'));
    expect(await readDeviceRegister(TENANT)).toMatchObject({
      registerCode: 'R1',
      branchCode: 'MAIN',
    });
    const put = fetchMock.mock.calls.find(([url]) => String(url).includes('/devices/'))!;
    expect(put[1].method).toBe('PUT');
    expect(JSON.parse(put[1].body)).toEqual({
      name: 'Till · Register 1',
      registerId: branch().registers[0]!.id,
    });
    // The same install id is used every time and kept in SecureStore.
    const deviceId = String(put[0]).split('/devices/')[1];
    expect(secureStoreMap().get('pos.device.id')).toBe(deviceId);
  });

  it('keeps the old choice when the business has blocked this device', async () => {
    fetchMock.mockImplementation(async (url: string) =>
      url.includes('/devices/')
        ? respond(403, { error: { code: 'DEVICE_REVOKED', message: 'x' } })
        : respond(200, { items: [branch()] }),
    );
    await render(<SelectRegisterScreen />);
    await fireEvent.press(await screen.findByRole('button', { name: 'Register 1 (R1)' }));
    expect(
      await screen.findByText(/This device has been blocked by the business/),
    ).toBeOnTheScreen();
    expect(mockReplace).not.toHaveBeenCalled();
    expect(await readDeviceRegister(TENANT)).toBeNull();
  });

  it('explains when there are no registers', async () => {
    fetchMock.mockResolvedValue(respond(200, { items: [branch({ registers: [] })] }));
    await render(<SelectRegisterScreen />);
    expect(await screen.findByText(/No active registers/)).toBeOnTheScreen();
  });

  it('offers a retry when branches cannot be loaded', async () => {
    fetchMock
      .mockRejectedValueOnce(new TypeError('Network request failed'))
      .mockResolvedValueOnce(respond(200, { items: [branch()] }));
    await render(<SelectRegisterScreen />);
    await fireEvent.press(await screen.findByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('button', { name: 'Register 1 (R1)' })).toBeOnTheScreen();
  });

  it('forgets a stored register once it is archived', async () => {
    const active = branch();
    await saveDeviceRegister(TENANT, {
      branchId: active.id,
      branchCode: 'MAIN',
      branchName: 'Main branch',
      registerId: active.registers[0]!.id,
      registerCode: 'R1',
      registerName: 'Old name',
    });
    // Still active: refreshed with the current name.
    expect((await resolveDeviceRegister(TENANT, [active]))?.registerName).toBe('Register 1');
    // Archived registers are not returned by the active-only list.
    expect(await resolveDeviceRegister(TENANT, [branch({ registers: [] })])).toBeNull();
    expect(await readDeviceRegister(TENANT)).toBeNull();
  });
});
