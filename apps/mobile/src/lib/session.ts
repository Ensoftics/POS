import type { AuthContext, AuthSessionResponse } from '@pos/contracts';
import * as SecureStore from 'expo-secure-store';
import { useSyncExternalStore } from 'react';

const REFRESH_TOKEN_KEY = 'pos.refreshToken';

export type SessionState =
  | { status: 'loading' }
  | { status: 'anonymous'; reason?: 'expired' | 'signed_out' }
  /** A stored session exists but the server could not be reached to resume it. */
  | { status: 'offline' }
  | { status: 'authenticated'; context: AuthContext };

/**
 * The refresh token is kept in SecureStore (Android Keystore-backed, excluded
 * from backups). The access token lives in memory only.
 */
let state: SessionState = { status: 'loading' };
let accessToken: string | null = null;
const listeners = new Set<() => void>();

function setState(next: SessionState) {
  state = next;
  for (const listener of listeners) listener();
}

export const sessionStore = {
  getState: (): SessionState => state,
  getAccessToken: (): string | null => accessToken,
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  readRefreshToken: (): Promise<string | null> => SecureStore.getItemAsync(REFRESH_TOKEN_KEY),

  /** Persists the rotated refresh token before exposing the session to the UI. */
  async applySession(session: AuthSessionResponse): Promise<void> {
    if (!session.refreshToken) throw new Error('Mobile sessions must include a refresh token');
    await SecureStore.setItemAsync(REFRESH_TOKEN_KEY, session.refreshToken);
    accessToken = session.accessToken;
    const { user, tenant, role, permissions, memberships, branchIds, subscription, features } =
      session;
    setState({
      status: 'authenticated',
      context: {
        user,
        tenant,
        role,
        permissions,
        memberships,
        branchIds: branchIds ?? null,
        subscription: subscription ?? null,
        features: features ?? [],
      },
    });
  },

  markOffline(): void {
    accessToken = null;
    setState({ status: 'offline' });
  },

  async clear(reason?: 'expired' | 'signed_out'): Promise<void> {
    accessToken = null;
    await SecureStore.deleteItemAsync(REFRESH_TOKEN_KEY).catch(() => undefined);
    setState({ status: 'anonymous', reason });
  },
};

export function useSession(): SessionState {
  return useSyncExternalStore(sessionStore.subscribe, sessionStore.getState, sessionStore.getState);
}
