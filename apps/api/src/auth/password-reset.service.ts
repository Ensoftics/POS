import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { checkPassword } from '@pos/domain';
import { AuditService } from '../audit/audit.service';
import { AppException } from '../common/app-exception';
import { RequestContext } from '../common/request-context';
import { APP_CONFIG, type AppConfig } from '../config/app-config';
import { Mailer } from '../mail/mailer';
import { passwordChangedEmail, passwordResetEmail } from '../mail/templates';
import { PrismaService } from '../prisma/prisma.service';
import { PasswordHasher } from './password-hasher';
import { SessionService } from './session.service';
import { generateOpaqueToken, hashToken } from './token.service';

/** Per-account cap on reset emails, independent of the per-IP rate limit. */
export const MAX_RESET_REQUESTS_PER_HOUR = 5;

const invalidToken = () =>
  new AppException(
    'INVALID_RESET_TOKEN',
    HttpStatus.BAD_REQUEST,
    'This reset link is invalid or has expired. Request a new one.',
  );

@Injectable()
export class PasswordResetService {
  private readonly logger = new Logger(PasswordResetService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly hasher: PasswordHasher,
    private readonly sessions: SessionService,
    private readonly audit: AuditService,
    private readonly mailer: Mailer,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  /**
   * Always resolves without revealing whether the email exists. Email delivery
   * happens after the response so timing does not leak account existence either.
   */
  async request(email: string): Promise<void> {
    const ttlMinutes = this.config.PASSWORD_RESET_TTL_MINUTES;
    const issued = await this.prisma.asSystem(async (tx) => {
      const user = await tx.user.findUnique({
        where: { email },
        select: { id: true, fullName: true, status: true },
      });
      if (!user || user.status !== 'ACTIVE') return null;

      const recent = await tx.passwordResetToken.count({
        where: { userId: user.id, createdAt: { gt: new Date(Date.now() - 60 * 60_000) } },
      });
      if (recent >= MAX_RESET_REQUESTS_PER_HOUR) return null;

      // Only the newest link works.
      await tx.passwordResetToken.updateMany({
        where: { userId: user.id, usedAt: null, invalidated: false },
        data: { invalidated: true },
      });
      const { token, hash } = generateOpaqueToken();
      await tx.passwordResetToken.create({
        data: {
          userId: user.id,
          tokenHash: hash,
          expiresAt: new Date(Date.now() + ttlMinutes * 60_000),
          requestIp: RequestContext.get()?.ip ?? null,
        },
      });
      await this.audit.record(tx, {
        tenantId: null,
        actorUserId: user.id,
        action: 'auth.password_reset_requested',
        entityType: 'user',
        entityId: user.id,
      });
      return { token, user };
    });

    if (!issued) return;
    const resetUrl = `${this.config.WEB_APP_URL}/reset-password?token=${encodeURIComponent(issued.token)}`;
    this.sendInBackground(
      passwordResetEmail({ to: email, fullName: issued.user.fullName, resetUrl, ttlMinutes }),
      issued.user.id,
    );
  }

  /** Sets a new password, consumes the token and signs the user out everywhere. */
  async reset(token: string, password: string): Promise<void> {
    const record = await this.prisma.asSystem((tx) =>
      tx.passwordResetToken.findUnique({
        where: { tokenHash: hashToken(token) },
        include: { user: { select: { id: true, email: true, fullName: true, status: true } } },
      }),
    );
    if (
      !record ||
      record.usedAt ||
      record.invalidated ||
      record.expiresAt <= new Date() ||
      record.user.status !== 'ACTIVE'
    ) {
      throw invalidToken();
    }
    if (
      checkPassword(password, {
        email: record.user.email,
        fullName: record.user.fullName,
      }).includes('contains_identity')
    ) {
      throw AppException.validation([
        { path: 'password', message: 'validation.password.contains_identity' },
      ]);
    }

    const passwordHash = await this.hasher.hash(password);
    await this.prisma.asSystem(async (tx) => {
      const claimed = await tx.passwordResetToken.updateMany({
        where: { id: record.id, usedAt: null, invalidated: false },
        data: { usedAt: new Date() },
      });
      if (claimed.count === 0) throw invalidToken();

      await tx.user.update({
        where: { id: record.userId },
        data: {
          passwordHash,
          passwordChangedAt: new Date(),
          failedLoginCount: 0,
          lockedUntil: null,
        },
      });
      // The reset link reached this address, which proves the person owns it.
      await tx.user.updateMany({
        where: { id: record.userId, emailVerifiedAt: null },
        data: { emailVerifiedAt: new Date() },
      });
      const revoked = await this.sessions.revokeAllForUser(tx, record.userId, 'PASSWORD_RESET');
      await this.audit.record(tx, {
        tenantId: null,
        actorUserId: record.userId,
        action: 'auth.password_reset_completed',
        entityType: 'user',
        entityId: record.userId,
        metadata: { revokedSessions: revoked },
      });
    });

    this.sendInBackground(
      passwordChangedEmail({ to: record.user.email, fullName: record.user.fullName }),
      record.userId,
    );
  }

  private sendInBackground(message: Parameters<Mailer['send']>[0], userId: string): void {
    this.mailer.send(message).catch((error: unknown) => {
      // Never log the message body: it contains the reset link.
      this.logger.error({
        msg: 'email delivery failed',
        subject: message.subject,
        userId,
        error: String(error),
      });
    });
  }
}
