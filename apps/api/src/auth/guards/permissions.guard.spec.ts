import type { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { permissionsForRole, type Permission, type TenantRole } from '@pos/domain';
import { AppException } from '../../common/app-exception';
import { PermissionsGuard } from './permissions.guard';

function contextFor(role: TenantRole | null, required: Permission[] | undefined): ExecutionContext {
  const handler = () => undefined;
  if (required) Reflect.defineMetadata('pos:requiredPermissions', required, handler);
  const principal = role
    ? {
        role,
        permissions: permissionsForRole(role),
        userId: 'u',
        tenantId: 't',
        membershipId: 'm',
        sessionId: 's',
        isPlatformAdmin: false,
        subscriptionStatus: 'ACTIVE',
      }
    : undefined;
  return {
    getHandler: () => handler,
    getClass: () => class {},
    switchToHttp: () => ({ getRequest: () => ({ principal }) }),
  } as unknown as ExecutionContext;
}

describe('PermissionsGuard', () => {
  const guard = new PermissionsGuard(new Reflector());

  it('allows routes without requirements', () => {
    expect(guard.canActivate(contextFor('CASHIER', undefined))).toBe(true);
  });

  it('allows roles holding every required permission', () => {
    expect(guard.canActivate(contextFor('OWNER', ['audit.read', 'tenant.update']))).toBe(true);
  });

  it('forbids roles missing any required permission', () => {
    expect(() => guard.canActivate(contextFor('MANAGER', ['audit.read', 'tenant.update']))).toThrow(
      AppException,
    );
    expect(() => guard.canActivate(contextFor('CASHIER', ['audit.read']))).toThrow(/permission/);
  });

  it('requires authentication when permissions are declared', () => {
    expect(() => guard.canActivate(contextFor(null, ['tenant.read']))).toThrow(/Authentication/);
  });
});
