import { AsyncLocalStorage } from 'node:async_hooks';
import type { Permission, SubscriptionStatus, TenantRole } from '@pos/domain';

/** The authenticated caller, resolved server-side from a verified token and live DB state. */
export interface AuthPrincipal {
  userId: string;
  tenantId: string;
  membershipId: string;
  sessionId: string;
  role: TenantRole;
  permissions: readonly Permission[];
  /** Branches the member may work at; null = every branch (owners always). */
  branchIds: readonly string[] | null;
  isPlatformAdmin: boolean;
  /** Null only if the business has no subscription row (treated as inactive). */
  subscriptionStatus: SubscriptionStatus | null;
}

export interface RequestContextData {
  requestId: string;
  ip: string | null;
  userAgent: string | null;
  principal?: AuthPrincipal;
}

const storage = new AsyncLocalStorage<RequestContextData>();

export const RequestContext = {
  run<T>(data: RequestContextData, fn: () => T): T {
    return storage.run(data, fn);
  },
  get(): RequestContextData | undefined {
    return storage.getStore();
  },
  setPrincipal(principal: AuthPrincipal): void {
    const store = storage.getStore();
    if (store) store.principal = principal;
  },
};
