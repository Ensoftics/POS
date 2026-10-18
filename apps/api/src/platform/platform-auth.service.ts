import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { PlatformSession, platformLoginRequestSchema } from '@pos/contracts';
import type { z } from 'zod';
import { LOCKOUT_MINUTES, MAX_FAILED_LOGINS } from '../auth/auth.service';
import { PasswordHasher } from '../auth/password-hasher';
import { JWT_ISSUER } from '../auth/token.service';
import { AppException } from '../common/app-exception';
import { RequestContext } from '../common/request-context';
import { APP_CONFIG, type AppConfig } from '../config/app-config';
import { PrismaService } from '../prisma/prisma.service';
import { PlatformAuditService } from './platform-audit.service';
import { base32Decode, decryptSecret, verifyTotp } from './totp';

/** Platform tokens use their own audience, so tenant routes reject them and vice versa. */
export const PLATFORM_AUDIENCE = 'pos-platform';

/** How often "last seen" is written, to keep idle tracking cheap. */
const TOUCH_INTERVAL_MS = 60_000;

export interface PlatformPrincipal {
  userId: string;
  sessionId: string;
  email: string;
}

type LoginInput = z.output<typeof platformLoginRequestSchema>;

const invalid = () =>
  // One answer for every failure, so the response does not reveal which part was wrong.
  new AppException(
    'INVALID_CREDENTIALS',
    HttpStatus.UNAUTHORIZED,
    'Email, password or authenticator code is incorrect.',
  );
const sessionEnded = () =>
  new AppException('SESSION_EXPIRED', HttpStatus.UNAUTHORIZED, 'Your session has ended.');

/**
 * Sign-in for platform staff: password plus an authenticator code, each code
 * usable once. Sessions are short (idle timeout and absolute limit), held in
 * memory by the console, and checked against the database on every request.
 */
@Injectable()
export class PlatformAuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly hasher: PasswordHasher,
    private readonly jwt: JwtService,
    private readonly audit: PlatformAuditService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async login(input: LoginInput): Promise<PlatformSession> {
    const user = await this.prisma.asSystem((tx) =>
      tx.user.findUnique({ where: { email: input.email } }),
    );
    if (!user || !user.isPlatformAdmin || !user.totpSecretEnc) {
      await this.hasher.verifyDummy(input.password);
      throw invalid();
    }
    const now = new Date();
    const locked = !!user.lockedUntil && user.lockedUntil > now;
    const passwordOk = await this.hasher.verify(input.password, user.passwordHash);
    let step: number | null = null;
    if (passwordOk) {
      const secret = base32Decode(decryptSecret(user.totpSecretEnc, this.config.JWT_ACCESS_SECRET));
      step = verifyTotp(secret, input.code, now, user.totpLastStep);
    }
    if (!passwordOk || step === null) {
      if (!locked) await this.recordFailure(user.id);
      throw invalid();
    }
    if (locked)
      throw new AppException(
        'ACCOUNT_LOCKED',
        HttpStatus.LOCKED,
        `Too many failed attempts. Try again in ${LOCKOUT_MINUTES} minutes.`,
      );
    if (user.status !== 'ACTIVE') throw invalid();

    const context = RequestContext.get();
    const expiresAt = new Date(now.getTime() + this.config.PLATFORM_SESSION_HOURS * 3_600_000);
    const session = await this.prisma.asSystem(async (tx) => {
      // Consuming the time step makes the code single-use, even under concurrent logins.
      const { count } = await tx.user.updateMany({
        where: {
          id: user.id,
          OR: [{ totpLastStep: null }, { totpLastStep: { lt: step! } }],
        },
        data: { totpLastStep: step!, failedLoginCount: 0, lockedUntil: null },
      });
      if (count === 0) throw invalid();
      const row = await tx.platformSession.create({
        data: {
          userId: user.id,
          expiresAt,
          ip: context?.ip ?? null,
          userAgent: context?.userAgent?.slice(0, 255) ?? null,
        },
      });
      await this.audit.record(tx, {
        actorUserId: user.id,
        action: 'platform.login',
        entityType: 'platform_session',
        entityId: row.id,
      });
      return row;
    });
    const accessToken = await this.jwt.signAsync(
      { sub: user.id, sid: session.id, scope: 'platform' },
      {
        audience: PLATFORM_AUDIENCE,
        issuer: JWT_ISSUER,
        expiresIn: Math.floor((expiresAt.getTime() - now.getTime()) / 1000),
      },
    );
    return {
      accessToken,
      expiresAt: expiresAt.toISOString(),
      user: { id: user.id, email: user.email, fullName: user.fullName },
    };
  }

  /** Verifies the token and the live session; enforces the idle timeout. */
  async resolve(token: string): Promise<PlatformPrincipal> {
    let claims: Record<string, unknown>;
    try {
      claims = await this.jwt.verifyAsync(token, {
        audience: PLATFORM_AUDIENCE,
        issuer: JWT_ISSUER,
      });
    } catch {
      throw sessionEnded();
    }
    if (
      claims.scope !== 'platform' ||
      typeof claims.sid !== 'string' ||
      typeof claims.sub !== 'string'
    )
      throw sessionEnded();
    const now = new Date();
    const idleMs = this.config.PLATFORM_IDLE_MINUTES * 60_000;
    return this.prisma.asSystem(async (tx) => {
      const session = await tx.platformSession.findUnique({
        where: { id: claims.sid as string },
        include: { user: { select: { email: true, status: true, isPlatformAdmin: true } } },
      });
      if (
        !session ||
        session.userId !== claims.sub ||
        session.revokedAt ||
        session.expiresAt <= now ||
        now.getTime() - session.lastSeenAt.getTime() > idleMs ||
        session.user.status !== 'ACTIVE' ||
        // Revoking platform access ends every console session at once.
        !session.user.isPlatformAdmin
      )
        throw sessionEnded();
      if (now.getTime() - session.lastSeenAt.getTime() > TOUCH_INTERVAL_MS)
        await tx.platformSession.update({ where: { id: session.id }, data: { lastSeenAt: now } });
      return { userId: session.userId, sessionId: session.id, email: session.user.email };
    });
  }

  async logout(principal: PlatformPrincipal): Promise<void> {
    await this.prisma.asSystem(async (tx) => {
      await tx.platformSession.updateMany({
        where: { id: principal.sessionId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      await this.audit.record(tx, {
        actorUserId: principal.userId,
        action: 'platform.logout',
        entityType: 'platform_session',
        entityId: principal.sessionId,
      });
    });
  }

  async me(principal: PlatformPrincipal) {
    const user = await this.prisma.asSystem((tx) =>
      tx.user.findUniqueOrThrow({
        where: { id: principal.userId },
        select: { id: true, email: true, fullName: true },
      }),
    );
    return user;
  }

  private async recordFailure(userId: string): Promise<void> {
    await this.prisma.asSystem(async (tx) => {
      const updated = await tx.user.update({
        where: { id: userId },
        data: { failedLoginCount: { increment: 1 } },
        select: { failedLoginCount: true },
      });
      await this.audit.record(tx, {
        actorUserId: userId,
        action: 'platform.login_failed',
        entityType: 'user',
        entityId: userId,
        metadata: { consecutiveFailures: updated.failedLoginCount },
      });
      if (updated.failedLoginCount >= MAX_FAILED_LOGINS)
        await tx.user.update({
          where: { id: userId },
          data: {
            failedLoginCount: 0,
            lockedUntil: new Date(Date.now() + LOCKOUT_MINUTES * 60_000),
          },
        });
    });
  }
}
