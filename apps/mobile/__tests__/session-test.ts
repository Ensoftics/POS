import { bootstrapSession, signOut } from '@/lib/api';
import { sessionStore } from '@/lib/session';
import { mobileSession, respond, secureStoreMap } from '../test/fixtures';

const KEY = 'pos.refreshToken';

describe('mobile session lifecycle', () => {
  const fetchMock = jest.fn();
  beforeEach(() => {
    secureStoreMap().clear();
    fetchMock.mockReset();
    globalThis.fetch = fetchMock as unknown as typeof fetch;
  });

  it('starts signed out when no token is stored', async () => {
    await bootstrapSession();
    expect(sessionStore.getState()).toEqual({ status: 'anonymous' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('resumes the session and stores the rotated refresh token', async () => {
    secureStoreMap().set(KEY, 'old-refresh-token-0123456789');
    fetchMock.mockResolvedValue(respond(200, mobileSession()));
    await bootstrapSession();

    expect(sessionStore.getState().status).toBe('authenticated');
    expect(secureStoreMap().get(KEY)).toBe('rotated-refresh-token-0123456789');
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toMatch(/\/auth\/refresh$/);
    expect(JSON.parse(init.body)).toEqual({ refreshToken: 'old-refresh-token-0123456789' });
    expect(init.credentials).toBe('omit');
  });

  it('forgets an expired session', async () => {
    secureStoreMap().set(KEY, 'old-refresh-token-0123456789');
    fetchMock.mockResolvedValue(respond(401, { error: { code: 'SESSION_EXPIRED', message: 'x' } }));
    await bootstrapSession();
    expect(sessionStore.getState()).toEqual({ status: 'anonymous', reason: 'expired' });
    expect(secureStoreMap().has(KEY)).toBe(false);
  });

  it('keeps the stored session when the server is unreachable', async () => {
    secureStoreMap().set(KEY, 'old-refresh-token-0123456789');
    fetchMock.mockRejectedValue(new TypeError('Network request failed'));
    await bootstrapSession();
    expect(sessionStore.getState()).toEqual({ status: 'offline' });
    expect(secureStoreMap().get(KEY)).toBe('old-refresh-token-0123456789');
  });

  it('signs out locally even when the server cannot be reached', async () => {
    secureStoreMap().set(KEY, 'old-refresh-token-0123456789');
    fetchMock.mockRejectedValue(new TypeError('Network request failed'));
    await signOut();
    expect(sessionStore.getState()).toEqual({ status: 'anonymous', reason: 'signed_out' });
    expect(secureStoreMap().has(KEY)).toBe(false);
  });
});
