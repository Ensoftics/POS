import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import { AppException } from '../common/app-exception';
import { APP_CONFIG, type AppConfig } from '../config/app-config';
import { Mailer } from '../mail/mailer';
import { verifyEmailEmail } from '../mail/templates';
import { PrismaService, type Tx } from '../prisma/prisma.service';
import { generateOpaqueToken, hashToken } from './token.service';

/** Per-account cap on verification e-mails. */
export const MAX_VERIFICATION_EMAILS_PER_HOUR = 5;

const invalidToken = () =>
  new AppException(
    'INVALID_VERIFICATION_TOKEN',
    HttpStatus.BAD_REQUEST,
    'This verification link is invalid or has expired. Send a new one.',
  );

/**
 * Proves that a person owns their e-mail address before money is involved.
 * Only the token's hash is stored; the newest link replaces earlier ones.
 */
@Injectable()
export class EmailVerificationService {
  private readonly logger = new Logger(EmailVerificationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly mailer: Mailer,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  /** Creates a link inside the caller's transaction; send it with `deliver` after commit. */
  async issue(tx: Tx, userId: string): Promise<string | null> {
    const recent = await tx.emailVerificationToken.count({
      where: { userId, createdAt: { gt: new Date(Date.now() - 60 * 60_000) } },
    });
    if (recent >= MAX_VERIFICATION_EMAILS_PER_HOUR) return null;
    await tx.emailVerificationToken.deleteMany({ where: { userId, usedAt: null } });
    const { token, hash } = generateOpaqueToken();
    await tx.emailVerificationToken.create({
      data: {
        userId,
        tokenHash: hash,
        expiresAt: new Date(Date.now() + this.config.EMAIL_VERIFICATION_TTL_HOURS * 3_600_000),
      },
    });
    return token;
  }

  deliver(to: string, fullName: string, token: string, userId: string): void {
    const verifyUrl = `${this.config.WEB_APP_URL}/verify-email?token=${encodeURIComponent(token)}`;
    this.mailer
      .send(
        verifyEmailEmail({
          to,
          fullName,
          verifyUrl,
          ttlHours: this.config.EMAIL_VERIFICATION_TTL_HOURS,
        }),
      )
      .catch((error: unknown) =>
        // Never log the message: it contains the link.
        this.logger.error({ msg: 'verification email failed', userId, error: String(error) }),
      );
  }

  /** Sends a new link to a signed-in person who has not verified yet. */
  async resend(userId: string): Promise<void> {
    const issued = await this.prisma.asSystem(async (tx) => {
      const user = await tx.user.findUniqueOrThrow({
        where: { id: userId },
        select: { email: true, fullName: true, emailVerifiedAt: true },
      });
      if (user.emailVerifiedAt) return null;
      const token = await this.issue(tx, userId);
      return token ? { user, token } : null;
    });
    if (issued) this.deliver(issued.user.email, issued.user.fullName, issued.token, userId);
  }

  async verify(token: string): Promise<void> {
    await this.prisma.asSystem(async (tx) => {
      const record = await tx.emailVerificationToken.findUnique({
        where: { tokenHash: hashToken(token) },
      });
      if (!record || record.usedAt || record.expiresAt <= new Date()) throw invalidToken();
      const claimed = await tx.emailVerificationToken.updateMany({
        where: { id: record.id, usedAt: null },
        data: { usedAt: new Date() },
      });
      if (claimed.count === 0) throw invalidToken();
      const { count } = await tx.user.updateMany({
        where: { id: record.userId, emailVerifiedAt: null },
        data: { emailVerifiedAt: new Date() },
      });
      if (count > 0)
        await this.audit.record(tx, {
          tenantId: null,
          actorUserId: record.userId,
          action: 'auth.email_verified',
          entityType: 'user',
          entityId: record.userId,
        });
    });
  }
}
