import { createHash, randomBytes } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { isTenantRole, type TenantRole } from '@pos/domain';
import { APP_CONFIG, type AppConfig } from '../config/app-config';

export const JWT_ISSUER = 'pos-api';
export const JWT_AUDIENCE = 'pos-clients';

export interface AccessTokenClaims {
  /** User ID */
  sub: string;
  /** Tenant ID */
  tid: string;
  /** Session family ID */
  sid: string;
  /** Role at issue time (informational; authorisation re-reads the live role) */
  role: TenantRole;
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** 256-bit opaque token, URL-safe. Only its SHA-256 is persisted. */
export function generateOpaqueToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString('base64url');
  return { token, hash: hashToken(token) };
}

@Injectable()
export class TokenService {
  constructor(
    private readonly jwt: JwtService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async signAccessToken(claims: AccessTokenClaims): Promise<{ token: string; expiresAt: Date }> {
    const ttl = this.config.ACCESS_TOKEN_TTL_SECONDS;
    const token = await this.jwt.signAsync({ ...claims }, { expiresIn: ttl });
    return { token, expiresAt: new Date(Date.now() + ttl * 1000) };
  }

  /** Throws on invalid signature, wrong issuer/audience, wrong algorithm or expiry. */
  async verifyAccessToken(token: string): Promise<AccessTokenClaims> {
    const payload = await this.jwt.verifyAsync<Record<string, unknown>>(token);
    const { sub, tid, sid, role } = payload;
    if (
      typeof sub !== 'string' ||
      typeof tid !== 'string' ||
      typeof sid !== 'string' ||
      !isTenantRole(role)
    ) {
      throw new Error('Malformed access token claims');
    }
    return { sub, tid, sid, role };
  }
}
