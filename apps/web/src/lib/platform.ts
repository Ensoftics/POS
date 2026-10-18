import { createApiClient } from '@pos/api-client';
import type { PlatformSession } from '@pos/contracts';
import { useSyncExternalStore } from 'react';

/**
 * Platform console sign-in, kept in memory only: reloading the page or closing
 * the tab signs out. Separate from the shop session, so the two never mix.
 */
type State = { session: PlatformSession | null; ended: boolean };
let state: State = { session: null, ended: false };
const listeners = new Set<() => void>();

function setState(next: State) {
  state = next;
  for (const listener of listeners) listener();
}

export const platformStore = {
  get: () => state,
  set(session: PlatformSession) {
    setState({ session, ended: false });
  },
  /** `ended` = the server ended the session (idle, expired or revoked). */
  clear(ended = false) {
    setState({ session: null, ended });
  },
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
};

export function usePlatformSession(): State {
  return useSyncExternalStore(platformStore.subscribe, platformStore.get, platformStore.get);
}

export const platformApi = createApiClient({
  baseUrl: import.meta.env.VITE_API_BASE_URL ?? '/api/v1',
  clientType: 'WEB',
  getAccessToken: () => state.session?.accessToken ?? null,
  // Platform sessions cannot be renewed: sign in again.
  renewAccessToken: async () => {
    if (state.session) platformStore.clear(true);
    return null;
  },
}).platform;
