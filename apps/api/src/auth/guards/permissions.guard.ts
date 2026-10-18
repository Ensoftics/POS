import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Permission } from '@pos/domain';
import { AppException } from '../../common/app-exception';
import { REQUIRED_PERMISSIONS, type RequestWithPrincipal } from '../auth.decorators';

/** Global guard (runs after AccessTokenGuard): enforces @RequirePermissions(). */
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<Permission[] | undefined>(
      REQUIRED_PERMISSIONS,
      [context.getHandler(), context.getClass()],
    );
    if (!required?.length) return true;

    const principal = context.switchToHttp().getRequest<RequestWithPrincipal>().principal;
    if (!principal) throw AppException.unauthenticated();
    if (!required.every((permission) => principal.permissions.includes(permission))) {
      throw AppException.forbidden();
    }
    return true;
  }
}
