import {
  type CanActivate,
  createParamDecorator,
  type ExecutionContext,
  Injectable,
} from '@nestjs/common';
import type { Request } from 'express';
import { AppException } from '../common/app-exception';
import { PlatformAuthService, type PlatformPrincipal } from './platform-auth.service';

type PlatformRequest = Request & { platformPrincipal?: PlatformPrincipal };

/**
 * Guards platform console routes. These routes are @Public() to the tenant
 * guards and use this guard instead, so a tenant token never opens them and a
 * platform token never opens tenant routes (different audiences).
 */
@Injectable()
export class PlatformGuard implements CanActivate {
  constructor(private readonly auth: PlatformAuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<PlatformRequest>();
    const [scheme, token] = request.header('authorization')?.split(' ') ?? [];
    if (scheme !== 'Bearer' || !token) throw AppException.unauthenticated();
    request.platformPrincipal = await this.auth.resolve(token);
    return true;
  }
}

export const CurrentPlatformPrincipal = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): PlatformPrincipal => {
    const principal = ctx.switchToHttp().getRequest<PlatformRequest>().platformPrincipal;
    if (!principal) throw AppException.unauthenticated();
    return principal;
  },
);
