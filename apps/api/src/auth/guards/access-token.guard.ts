import { type CanActivate, type ExecutionContext, HttpStatus, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { AppException } from '../../common/app-exception';
import { RequestContext } from '../../common/request-context';
import { IS_PUBLIC, type RequestWithPrincipal } from '../auth.decorators';
import { SessionService } from '../session.service';
import { TokenService } from '../token.service';

/** Global guard: every route requires a valid access token unless marked @Public(). */
@Injectable()
export class AccessTokenGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tokens: TokenService,
    private readonly sessions: SessionService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<Request & RequestWithPrincipal>();
    const [scheme, token] = request.header('authorization')?.split(' ') ?? [];
    if (scheme !== 'Bearer' || !token) throw AppException.unauthenticated();

    let claims;
    try {
      claims = await this.tokens.verifyAccessToken(token);
    } catch (error) {
      if (error instanceof Error && error.name === 'TokenExpiredError') {
        throw new AppException('SESSION_EXPIRED', HttpStatus.UNAUTHORIZED, 'Access token expired');
      }
      throw AppException.unauthenticated('Invalid access token');
    }

    const principal = await this.sessions.resolvePrincipal(claims);
    request.principal = principal;
    RequestContext.setPrincipal(principal);
    return true;
  }
}
