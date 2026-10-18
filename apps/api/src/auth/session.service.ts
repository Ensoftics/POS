import { randomUUID } from 'node:crypto';
import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import type { ClientType, SessionRevokeReason } from '@prisma/client';
import { permissionsForRole } from '@pos/domain';
import { AppException } from '../common/app-exception';
import { type AuthPrincipal, RequestContext } from '../common/request-context';
import { APP_CONFIG, type AppConfig } from '../config/app-config';
import { PrismaService, type Tx } from '../prisma/prisma.service';
import { type AccessTokenClaims, generateOpaqueToken } from './token.service';

const DAY_MS = 24 * 60 * 60 * 1000;

export interface IssuedSession {
  sessionId: string;
  familyId: string;
  membershipId: string;
  clientType: ClientType;
  refreshToken: string;
  refreshTokenExpiresAt: Date;
}

interface InsertInput {
  membershipId: string;
  familyId: string;
  familyExpiresAt: Date;
  clientType: ClientType;
  deviceName?: string | null;
  deviceId?: string | null;
}

/**
 * Persists refresh-token sessions. A "family" is one login on one device; every
 * refresh rotates to a new row in the family. Access tokens carry the family ID,
 * so revoking the family's active row invalidates outstanding access tokens too.
 */
@Injectable()
export class SessionService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  /** Starts a new session family (login or registration). */
  start(
    tx: Tx,
    input: {
      membershipId: string;
      clientType: ClientType;
      deviceName?: string | null;
      deviceId?: string | null;
    },
  ): Promise<IssuedSession> {
    return this.insert(tx, {
      ...input,
      familyId: randomUUID(),
      familyExpiresAt: new Date(Date.now() + this.config.SESSION_MAX_LIFETIME_DAYS * DAY_MS),
    });
  }

  /** Issues the next session in an existing family (refresh-token rotation). */
  continueFamily(tx: Tx, input: InsertInput): Promise<IssuedSession> {
    return this.insert(tx, input);
  }

  async revokeFamily(tx: Tx, familyId: string, reason: SessionRevokeReason): Promise<number> {
    const { count } = await tx.session.updateMany({
      where: { familyId, revokedAt: null },
      data: { revokedAt: new Date(), revokedReason: reason },
    });
    return count;
  }

  /** Signs out every session of one member of a business (role change, disabled). */
  async revokeAllForMembership(tx: Tx, membershipId: string, reason: SessionRevokeReason) {
    const { count } = await tx.session.updateMany({
      where: { membershipId, revokedAt: null },
      data: { revokedAt: new Date(), revokedReason: reason },
    });
    return count;
  }

  /** Signs out every session that signed in on a device of this business. */
  async revokeAllForDevice(tx: Tx, tenantId: string, deviceId: string) {
    const { count } = await tx.session.updateMany({
      where: { deviceId, revokedAt: null, membership: { tenantId } },
      data: { revokedAt: new Date(), revokedReason: 'ADMIN' },
    });
    return count;
  }

  async revokeAllForUser(tx: Tx, userId: string, reason: SessionRevokeReason): Promise<number> {
    const { count } = await tx.session.updateMany({
      where: { membership: { userId }, revokedAt: null },
      data: { revokedAt: new Date(), revokedReason: reason },
    });
    return count;
  }

  /**
   * Resolves the caller from verified token claims against live state, so that
   * logout, role changes, disabled staff and suspended tenants take effect immediately.
   */
  async resolvePrincipal(claims: AccessTokenClaims): Promise<AuthPrincipal> {
    const session = await this.prisma.asSystem((tx) =>
      tx.session.findFirst({
        where: { familyId: claims.sid, revokedAt: null },
        select: {
          membership: {
            select: {
              id: true,
              tenantId: true,
              userId: true,
              role: true,
              status: true,
              user: { select: { status: true, isPlatformAdmin: true } },
              tenant: { select: { status: true, subscription: { select: { status: true } } } },
              branches: { select: { branchId: true } },
            },
          },
        },
      }),
    );

    const membership = session?.membership;
    if (!membership || membership.userId !== claims.sub || membership.tenantId !== claims.tid) {
      throw new AppException(
        'SESSION_EXPIRED',
        HttpStatus.UNAUTHORIZED,
        'Your session has ended. Please sign in again.',
      );
    }
    if (membership.user.status !== 'ACTIVE') {
      throw new AppException(
        'ACCOUNT_DISABLED',
        HttpStatus.UNAUTHORIZED,
        'This account has been disabled.',
      );
    }
    if (membership.status !== 'ACTIVE' || membership.tenant.status === 'CLOSED') {
      throw new AppException(
        'SESSION_EXPIRED',
        HttpStatus.UNAUTHORIZED,
        'Your session has ended. Please sign in again.',
      );
    }
    if (membership.tenant.status === 'SUSPENDED') {
      throw new AppException(
        'TENANT_SUSPENDED',
        HttpStatus.FORBIDDEN,
        'This business account is suspended.',
      );
    }

    return {
      userId: membership.userId,
      tenantId: membership.tenantId,
      membershipId: membership.id,
      sessionId: claims.sid,
      role: membership.role,
      permissions: permissionsForRole(membership.role),
      // No rows means every branch; owners are never restricted.
      branchIds:
        membership.role === 'OWNER' || membership.branches.length === 0
          ? null
          : membership.branches.map((b) => b.branchId),
      isPlatformAdmin: membership.user.isPlatformAdmin,
      subscriptionStatus: membership.tenant.subscription?.status ?? null,
    };
  }

  private async insert(tx: Tx, input: InsertInput): Promise<IssuedSession> {
    const { token, hash } = generateOpaqueToken();
    const ttlDays =
      input.clientType === 'MOBILE'
        ? this.config.REFRESH_TOKEN_TTL_DAYS_MOBILE
        : this.config.REFRESH_TOKEN_TTL_DAYS_WEB;
    const slidingExpiry = Date.now() + ttlDays * DAY_MS;
    const expiresAt = new Date(Math.min(slidingExpiry, input.familyExpiresAt.getTime()));
    const context = RequestContext.get();

    const session = await tx.session.create({
      data: {
        membershipId: input.membershipId,
        familyId: input.familyId,
        familyExpiresAt: input.familyExpiresAt,
        refreshTokenHash: hash,
        clientType: input.clientType,
        deviceName: input.deviceName ?? null,
        deviceId: input.deviceId ?? null,
        userAgent: context?.userAgent ?? null,
        ip: context?.ip ?? null,
        expiresAt,
      },
      select: { id: true },
    });

    return {
      sessionId: session.id,
      familyId: input.familyId,
      membershipId: input.membershipId,
      clientType: input.clientType,
      refreshToken: token,
      refreshTokenExpiresAt: expiresAt,
    };
  }
}
