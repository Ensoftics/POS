import { createParamDecorator, type ExecutionContext, SetMetadata } from '@nestjs/common';
import type { Permission } from '@pos/domain';
import { AppException } from '../common/app-exception';
import type { AuthPrincipal } from '../common/request-context';

export const IS_PUBLIC = 'pos:isPublic';
export const REQUIRED_PERMISSIONS = 'pos:requiredPermissions';
export const SENSITIVE_RATE_LIMIT = 'pos:sensitiveRateLimit';
export const SELF_SERVICE = 'pos:selfService';

/** Route does not require an access token. */
export const Public = () => SetMetadata(IS_PUBLIC, true);

/** Caller's live role must grant every listed permission. */
export const RequirePermissions = (...permissions: Permission[]) =>
  SetMetadata(REQUIRED_PERMISSIONS, permissions);

/**
 * Any signed-in member may call this route because it only touches the caller's
 * own data (profile, sessions, notifications). Every route must carry
 * @RequirePermissions, @SelfService or @Public; a test enforces it.
 */
export const SelfService = () => SetMetadata(SELF_SERVICE, true);

/** Applies the stricter per-IP `auth` throttler (login, register, password reset). */
export const SensitiveRateLimit = () => SetMetadata(SENSITIVE_RATE_LIMIT, true);

export interface RequestWithPrincipal {
  principal?: AuthPrincipal;
}

export const CurrentPrincipal = createParamDecorator((_data: unknown, ctx: ExecutionContext) => {
  const principal = ctx.switchToHttp().getRequest<RequestWithPrincipal>().principal;
  if (!principal) throw AppException.unauthenticated();
  return principal;
});
