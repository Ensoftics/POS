/**
 * Tenant-level roles. Platform super-admin is a separate flag on the user,
 * never a tenant role, so a tenant owner can never grant platform access.
 */
export const TENANT_ROLES = ['OWNER', 'MANAGER', 'CASHIER', 'INVENTORY_STAFF'] as const;
export type TenantRole = (typeof TENANT_ROLES)[number];

/**
 * Permission catalogue. New slices append permissions here; the API enforces
 * them server-side and clients only use them to hide unavailable actions.
 */
export const PERMISSIONS = [
  'tenant.read',
  'tenant.update',
  'tenant.onboarding.complete',
  'audit.read',
  'settings.read',
  'settings.update',
  'branches.read',
  'branches.manage',
  'products.read',
  'products.manage',
  'products.import',
  'inventory.read',
  'inventory.manage',
  'purchasing.manage',
  'sales.create',
  'sales.read',
  'sales.discount',
  'shifts.manage',
  'sales.refund',
  'cash.manage',
  'approvals.grant',
  'customers.read',
  'customers.manage',
  'customers.credit',
  'customers.collect',
  'customers.message',
  'reports.view',
  'reports.profit',
  'staff.manage',
  'billing.manage',
] as const;
export type Permission = (typeof PERMISSIONS)[number];

const ROLE_PERMISSIONS: Record<TenantRole, readonly Permission[]> = {
  OWNER: PERMISSIONS,
  MANAGER: [
    'tenant.read',
    'audit.read',
    'settings.read',
    'branches.read',
    'branches.manage',
    'products.read',
    'products.manage',
    'products.import',
    'inventory.read',
    'inventory.manage',
    'purchasing.manage',
    'sales.create',
    'sales.read',
    'sales.discount',
    'shifts.manage',
    'sales.refund',
    'cash.manage',
    'approvals.grant',
    'customers.read',
    'customers.manage',
    'customers.credit',
    'customers.collect',
    'customers.message',
    'reports.view',
    'reports.profit',
    'staff.manage',
  ],
  // Every role needs currency, timezone, branch and catalogue data to operate a till.
  // Cashiers open and close their own shifts; `shifts.manage` covers everyone else's.
  CASHIER: [
    'tenant.read',
    'settings.read',
    'branches.read',
    'products.read',
    'inventory.read',
    'sales.create',
    'sales.read',
    'sales.discount',
    'sales.refund',
    'cash.manage',
    'customers.read',
    'customers.manage',
    'customers.collect',
  ],
  INVENTORY_STAFF: [
    'tenant.read',
    'settings.read',
    'branches.read',
    'products.read',
    'products.manage',
    'inventory.read',
    'inventory.manage',
    'purchasing.manage',
  ],
};

export function permissionsForRole(role: TenantRole): readonly Permission[] {
  return ROLE_PERMISSIONS[role];
}

export function roleHasPermission(role: TenantRole, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].includes(permission);
}

export function isTenantRole(value: unknown): value is TenantRole {
  return typeof value === 'string' && (TENANT_ROLES as readonly string[]).includes(value);
}

/**
 * Who may invite, change or disable whom: owners manage everyone; managers manage
 * cashiers and inventory staff only, so nobody can raise a member above their own level.
 */
export function canManageRole(actor: TenantRole, target: TenantRole): boolean {
  if (actor === 'OWNER') return true;
  if (actor === 'MANAGER') return target === 'CASHIER' || target === 'INVENTORY_STAFF';
  return false;
}

/** Whether a member may work at a branch; null means every branch of the business. */
export function canUseBranch(
  allowedBranchIds: readonly string[] | null,
  branchId: string,
): boolean {
  return allowedBranchIds === null || allowedBranchIds.includes(branchId);
}
