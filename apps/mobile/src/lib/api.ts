import { createApiClient, isApiError } from '@pos/api-client';
import type { AuthSessionResponse } from '@pos/contracts';
import { sessionStore } from './session';

/**
 * The API address baked into the build. Development falls back to the emulator's
 * host; a release build must be given an https address (tokens and sales data
 * never travel unencrypted), so a misconfigured build fails at start-up.
 */
export function resolveApiUrl(configured: string | undefined, development: boolean): string {
  if (configured && (development || configured.startsWith('https://'))) return configured;
  if (development) return 'http://10.0.2.2:4000/api/v1';
  throw new Error('EXPO_PUBLIC_API_URL must be set to an https address for release builds.');
}

export const API_URL = resolveApiUrl(process.env.EXPO_PUBLIC_API_URL, __DEV__);

export const api = createApiClient({
  baseUrl: API_URL,
  clientType: 'MOBILE',
  getAccessToken: sessionStore.getAccessToken,
  renewAccessToken: async () => {
    try {
      return (await refreshSession()).accessToken;
    } catch (error) {
      // Offline: keep the stored token so the session can resume when back online.
      if (isApiError(error) && error.isTransient) return null;
      await sessionStore.clear('expired');
      return null;
    }
  },
});

let inflight: Promise<AuthSessionResponse> | null = null;

/** Rotates the stored refresh token. Concurrent callers share one request. */
export function refreshSession(): Promise<AuthSessionResponse> {
  inflight ??= (async () => {
    try {
      const refreshToken = await sessionStore.readRefreshToken();
      if (!refreshToken) throw new Error('No stored session');
      const session = await api.auth.refresh(refreshToken);
      await sessionStore.applySession(session);
      return session;
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

/**
 * Restores the session at app start. When the server is unreachable the stored
 * token is kept and the app shows a retry screen; offline selling with cached
 * credentials arrives in Slice 7.
 */
export async function bootstrapSession(): Promise<void> {
  if (!(await sessionStore.readRefreshToken())) {
    await sessionStore.clear();
    return;
  }
  try {
    await refreshSession();
  } catch (error) {
    if (isApiError(error) && error.isTransient) sessionStore.markOffline();
    else await sessionStore.clear('expired');
  }
}

export async function signOut(): Promise<void> {
  const refreshToken = await sessionStore.readRefreshToken();
  try {
    if (refreshToken) await api.auth.logout(refreshToken);
  } catch {
    // Sign out locally even if the server is unreachable.
  } finally {
    await sessionStore.clear('signed_out');
  }
}
