import { createApiClient, isApiError } from '@pos/api-client';
import type { AuthSessionResponse } from '@pos/contracts';
import { authStore } from './auth-store';

const RACE_RETRY_DELAY_MS = 400;

export const api = createApiClient({
  baseUrl: import.meta.env.VITE_API_BASE_URL ?? '/api/v1',
  clientType: 'WEB',
  getAccessToken: authStore.getAccessToken,
  renewAccessToken: async () => {
    try {
      return (await refreshSession()).accessToken;
    } catch {
      authStore.clear('expired');
      return null;
    }
  },
});

let inflight: Promise<AuthSessionResponse> | null = null;

/**
 * Rotates the refresh cookie and stores the new access token. Concurrent callers
 * share one request. If another tab rotated the cookie at the same moment, the
 * server rejects the stale cookie; one delayed retry picks up the new cookie.
 */
export function refreshSession(): Promise<AuthSessionResponse> {
  inflight ??= (async () => {
    try {
      const session = await api.auth.refresh().catch(async (error: unknown) => {
        if (isApiError(error) && error.code === 'SESSION_EXPIRED') {
          await new Promise((resolve) => setTimeout(resolve, RACE_RETRY_DELAY_MS));
          return api.auth.refresh();
        }
        throw error;
      });
      authStore.applySession(session);
      return session;
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

let bootstrap: Promise<void> | null = null;

/** Restores the session from the refresh cookie once per page load. */
export function bootstrapSession(): Promise<void> {
  bootstrap ??= refreshSession().then(
    () => undefined,
    () => authStore.clear(),
  );
  return bootstrap;
}

export async function signOut(): Promise<void> {
  try {
    await api.auth.logout();
  } finally {
    authStore.clear('signed_out');
  }
}
