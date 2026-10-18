import { describe, expect, it } from 'vitest';
import {
  canManageRole,
  canUseBranch,
  checkPassword,
  permissionsForRole,
  roleHasPermission,
  slugifyBusinessName,
  TENANT_SLUG_PATTERN,
  withSlugSuffix,
} from './index';

describe('password policy', () => {
  it('accepts a long passphrase', () => {
    expect(checkPassword('correct horse battery staple')).toEqual([]);
  });

  it('rejects short, common and identity-derived passwords', () => {
    expect(checkPassword('short')).toContain('too_short');
    expect(checkPassword('Password123')).toContain('too_common');
    expect(checkPassword('nimal-shop-2024', { email: 'nimal@example.com' })).toContain(
      'contains_identity',
    );
    expect(checkPassword('perera-secure-99', { fullName: 'Kamal Perera' })).toContain(
      'contains_identity',
    );
  });

  it('measures length in code points', () => {
    // 10 Sinhala code points
    expect(checkPassword('අආඇඈඉඊඋඌඍඎ')).toEqual([]);
  });

  it('rejects overlong passwords', () => {
    expect(checkPassword('a'.repeat(129))).toContain('too_long');
  });
});

describe('roles', () => {
  it('grants owners every permission', () => {
    expect(roleHasPermission('OWNER', 'audit.read')).toBe(true);
    expect(roleHasPermission('OWNER', 'tenant.update')).toBe(true);
  });

  it('denies cashiers administrative permissions', () => {
    expect(roleHasPermission('CASHIER', 'audit.read')).toBe(false);
    expect(roleHasPermission('CASHIER', 'tenant.update')).toBe(false);
    expect(permissionsForRole('CASHIER')).toEqual([
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
    ]);
    // Credit limits are set by owners and managers only.
    expect(roleHasPermission('CASHIER', 'customers.credit')).toBe(false);
    expect(roleHasPermission('CASHIER', 'approvals.grant')).toBe(false);
    expect(roleHasPermission('MANAGER', 'approvals.grant')).toBe(true);
    expect(roleHasPermission('CASHIER', 'shifts.manage')).toBe(false);
    expect(roleHasPermission('INVENTORY_STAFF', 'sales.create')).toBe(false);
  });
});

describe('staff rules', () => {
  it('lets owners manage everyone and managers only front-line staff', () => {
    expect(canManageRole('OWNER', 'OWNER')).toBe(true);
    expect(canManageRole('MANAGER', 'CASHIER')).toBe(true);
    expect(canManageRole('MANAGER', 'INVENTORY_STAFF')).toBe(true);
    expect(canManageRole('MANAGER', 'MANAGER')).toBe(false);
    expect(canManageRole('MANAGER', 'OWNER')).toBe(false);
    expect(canManageRole('CASHIER', 'CASHIER')).toBe(false);
    expect(roleHasPermission('CASHIER', 'staff.manage')).toBe(false);
  });

  it('restricts members to their branches when a list is set', () => {
    expect(canUseBranch(null, 'b1')).toBe(true);
    expect(canUseBranch(['b1'], 'b1')).toBe(true);
    expect(canUseBranch(['b1'], 'b2')).toBe(false);
    expect(canUseBranch([], 'b1')).toBe(false);
  });
});

describe('slugs', () => {
  it('normalises Latin names', () => {
    expect(slugifyBusinessName('  Nimal Textiles & Co. ')).toBe('nimal-textiles-co');
    expect(slugifyBusinessName('Café Beauté')).toBe('cafe-beaute');
  });

  it('falls back for non-Latin names', () => {
    expect(slugifyBusinessName('රූපලාවණ්‍ය')).toBe('shop');
    expect(slugifyBusinessName('அழகு கடை')).toBe('shop');
  });

  it('produces slugs that satisfy the pattern', () => {
    const slug = withSlugSuffix(slugifyBusinessName('A'.repeat(80)), 'X7K2Q9');
    expect(slug).toMatch(TENANT_SLUG_PATTERN);
  });
});
