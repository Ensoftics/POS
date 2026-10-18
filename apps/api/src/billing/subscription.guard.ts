import {
  type CanActivate,
  type ExecutionContext,
  HttpStatus,
  Injectable,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { isSubscriptionUsable } from '@pos/domain';
import type { Request } from 'express';
import type { RequestWithPrincipal } from '../auth/auth.decorators';
import { AppException } from '../common/app-exception';

export const ALLOW_WHEN_INACTIVE = 'pos:allowWhenInactive';
/** The route stays usable when the subscription is suspended or cancelled (billing, sign-out). */
export const AllowWhenInactive = () => SetMetadata(ALLOW_WHEN_INACTIVE, true);

const READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Global guard: a suspended or cancelled subscription makes the business
 * read-only. Reading (including reports and exports) keeps working so nothing
 * is held hostage; changes are refused with SUBSCRIPTION_INACTIVE until paid.
 */
@Injectable()
export class SubscriptionGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request & RequestWithPrincipal>();
    const principal = request.principal;
    if (!principal || READ_METHODS.has(request.method)) return true;
    if (principal.subscriptionStatus && isSubscriptionUsable(principal.subscriptionStatus))
      return true;
    const allowed = this.reflector.getAllAndOverride<boolean>(ALLOW_WHEN_INACTIVE, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (allowed) return true;
    throw new AppException(
      'SUBSCRIPTION_INACTIVE',
      HttpStatus.PAYMENT_REQUIRED,
      'This business account is read-only until a plan is paid.',
    );
  }
}
