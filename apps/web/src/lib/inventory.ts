import { isApiError } from '@pos/api-client';
import type { Branch } from '@pos/contracts';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { api } from './api';
import { useAuthContext } from './auth-store';

export const inventoryKey = (tenantId: string) => ['inventory', tenantId] as const;

export function useActiveBranches() {
  const { tenant } = useAuthContext();
  return useQuery({
    queryKey: ['branches', tenant.id, { showArchived: false }],
    queryFn: () => api.branches.list(),
    select: (data) => data.items.filter((branch: Branch) => branch.status === 'ACTIVE'),
  });
}

/** Branch picked for inventory screens, remembered per business in this browser. */
export function useSelectedBranch(): [string | null, (id: string) => void, Branch[]] {
  const { tenant } = useAuthContext();
  const branches = useActiveBranches();
  const storageKey = `pos.inventory.branch.${tenant.id}`;
  const [selected, setSelected] = useState<string | null>(() => {
    try {
      return localStorage.getItem(storageKey);
    } catch {
      return null;
    }
  });
  const list = branches.data ?? [];
  const valid = list.some((branch) => branch.id === selected) ? selected : (list[0]?.id ?? null);

  useEffect(() => {
    if (valid && valid !== selected) setSelected(valid);
  }, [valid, selected]);

  const choose = (id: string) => {
    setSelected(id);
    try {
      localStorage.setItem(storageKey, id);
    } catch {
      // Non-fatal.
    }
  };
  return [valid, choose, list];
}

/**
 * Client-generated document id. Created once per form so that resubmitting after a
 * timeout or double click reuses it and the server returns the original document.
 */
export function newDocumentId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function')
    return crypto.randomUUID();
  return '10000000-1000-4000-8000-100000000000'.replace(/[018]/g, (c) =>
    (Number(c) ^ ((Math.random() * 16) >> (Number(c) / 4))).toString(16),
  );
}

/** Server validation issues keyed by path ("lines.2.quantity"). */
export function issuesByPath(error: unknown): Record<string, string> {
  if (!isApiError(error) || error.code !== 'VALIDATION_FAILED') return {};
  return Object.fromEntries(error.issues.map((issue) => [issue.path, issue.message]));
}
