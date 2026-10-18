import { PrismaClient } from '@prisma/client';
import { loadConfig } from '../config/app-config';
import { encryptSecret, generateTotpSecret, otpauthUri } from '../platform/totp';

/**
 * Grants or revokes platform console access. Run on the server by an operator;
 * there is deliberately no API for this.
 *
 *   pnpm --filter @pos/api platform:admin grant <email>       (also issues a new authenticator secret)
 *   pnpm --filter @pos/api platform:admin reset-totp <email>  (new secret; old codes stop working)
 *   pnpm --filter @pos/api platform:admin revoke <email>      (ends console sessions at once)
 *
 * The person must already have an account (e.g. created by registering) so the
 * password never passes through this tool. The secret is printed once.
 */
async function main(): Promise<void> {
  const [command, rawEmail] = process.argv.slice(2);
  const email = rawEmail?.trim().toLowerCase();
  if (!email || !['grant', 'revoke', 'reset-totp'].includes(command ?? '')) {
    console.error('Usage: platform-admin <grant|revoke|reset-totp> <email>');
    process.exitCode = 2;
    return;
  }
  const config = loadConfig();
  const prisma = new PrismaClient({ datasourceUrl: config.DATABASE_URL });
  try {
    await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.rls_bypass', 'on', true)`;
      const user = await tx.user.findUnique({ where: { email } });
      if (!user) throw new Error(`No account with e-mail ${email}. Register it first.`);
      if (command === 'revoke') {
        await tx.user.update({
          where: { id: user.id },
          data: { isPlatformAdmin: false, totpSecretEnc: null, totpLastStep: null },
        });
        await tx.platformSession.updateMany({
          where: { userId: user.id, revokedAt: null },
          data: { revokedAt: new Date() },
        });
        await tx.platformAuditLog.create({
          data: {
            action: 'platform.admin_revoked',
            entityType: 'user',
            entityId: user.id,
            metadata: { via: 'cli' },
          },
        });
        console.warn(`Platform access revoked for ${email}.`);
        return;
      }
      if (command === 'reset-totp' && !user.isPlatformAdmin)
        throw new Error(`${email} is not a platform admin.`);
      const secret = generateTotpSecret();
      await tx.user.update({
        where: { id: user.id },
        data: {
          isPlatformAdmin: true,
          totpSecretEnc: encryptSecret(secret, config.JWT_ACCESS_SECRET),
          totpLastStep: null,
        },
      });
      await tx.platformSession.updateMany({
        where: { userId: user.id, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      await tx.platformAuditLog.create({
        data: {
          action: command === 'grant' ? 'platform.admin_granted' : 'platform.totp_reset',
          entityType: 'user',
          entityId: user.id,
          metadata: { via: 'cli' },
        },
      });
      // Shown once, for the person to add to an authenticator app. Not logged anywhere else.
      console.warn(`Platform access ${command === 'grant' ? 'granted' : 'reset'} for ${email}.`);
      console.warn('Add this to an authenticator app (scan as QR or enter the key):');
      console.warn(otpauthUri(secret, email));
      console.warn(`Key: ${secret}`);
    });
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
