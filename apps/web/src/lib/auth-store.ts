import type { AuthContext, AuthSessionResponse, TenantSummary } from '@pos/contracts';
import { useSyncExternalStore } from 'react';

export type AnonymousReason = 'signed_out' | 'expired' | 'password_reset';

export type AuthState =
  | { status: 'loading' }
  | { status: 'anonymous'; reason?: AnonymousReason }
  | { status: 'authenticated'; context: AuthContext };

/**
 * Session state outside React so the API client can update it during token renewal.
 * The access token is kept in memory only; the refresh token lives in an httpOnly cookie.
 */
let state: AuthState = { status: 'loading' };
let accessToken: string | null = null;
const listeners = new Set<() => void>();

function setState(next: AuthState) {
  state = next;
  for (const listener of listeners) listener();
}

export const authStore = {
  getState: (): AuthState => state,
  getAccessToken: (): string | null => accessToken,
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  applySession(session: AuthSessionResponse): void {
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
  /** Replaces the context with a fresh `/auth/me` (after payment or e-mail confirmation). */
  updateContext(context: AuthContext): void {
    if (state.status === 'authenticated') setState({ ...state, context });
  },
  updateTenant(tenant: TenantSummary): void {
    if (state.status === 'authenticated')
      setState({ ...state, context: { ...state.context, tenant } });
  },
  clear(reason?: AnonymousReason): void {
    accessToken = null;
    setState({ status: 'anonymous', reason });
  },
};

export function useAuth(): AuthState {
  return useSyncExternalStore(authStore.subscribe, authStore.getState, authStore.getState);
}

/** Use inside routes guarded by RequireAuth. */
export function useAuthContext(): AuthContext {
  const auth = useAuth();
  if (auth.status !== 'authenticated')
    throw new Error('useAuthContext used outside an authenticated route');
  return auth.context;
}
