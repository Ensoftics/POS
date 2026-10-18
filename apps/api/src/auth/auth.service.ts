import { randomBytes } from 'node:crypto';
import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { Prisma, type ClientType } from '@prisma/client';
import type {
  acceptInvitationRequestSchema,
  AuthContext,
  AuthSessionResponse,
  InvitationPreview,
  loginRequestSchema,
  MembershipSummary,
  registerRequestSchema,
  TenantSelectionResponse,
} from '@pos/contracts';
import {
  checkPassword,
  permissionsForRole,
  slugifyBusinessName,
  withSlugSuffix,
} from '@pos/domain';
import type { z } from 'zod';
import { AuditService } from '../audit/audit.service';
import { Entitlements } from '../billing/entitlements';
import { FeatureFlags } from '../notifications/feature-flags.service';
import { toSubscriptionSummary } from '../billing/billing.mapper';
import { AppException } from '../common/app-exception';
import type { AuthPrincipal } from '../common/request-context';
import { PrismaService, type Tx } from '../prisma/prisma.service';
import { defaultSettingsData } from '../settings/settings.mapper';
import { toTenantSummary } from '../tenant/tenant.mapper';
import { APP_CONFIG, type AppConfig } from '../config/app-config';
import { EmailVerificationService } from './email-verification.service';
import { PasswordHasher } from './password-hasher';
import { type IssuedSession, SessionService } from './session.service';
import { hashToken, TokenService } from './token.service';

type RegisterInput = z.output<typeof registerRequestSchema>;
type LoginInput = z.output<typeof loginRequestSchema>;

/** Session response that always includes the refresh token; the controller decides how to deliver it. */
export type IssuedAuth = AuthSessionResponse & { refreshToken: string; clientType: ClientType };

export const MAX_FAILED_LOGINS = 5;
export const LOCKOUT_MINUTES = 15;
/** Window in which a just-rotated refresh token is rejected quietly (concurrent tabs) rather than treated as theft. */
export const ROTATION_GRACE_MS = 30_000;

const invalidCredentials = () =>
  new AppException(
    'INVALID_CREDENTIALS',
    HttpStatus.UNAUTHORIZED,
    'Email or password is incorrect.',
  );
const sessionExpired = () =>
  new AppException(
    'SESSION_EXPIRED',
    HttpStatus.UNAUTHORIZED,
    'Your session has ended. Please sign in again.',
  );

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly hasher: PasswordHasher,
    private readonly tokens: TokenService,
    private readonly sessions: SessionService,
    private readonly audit: AuditService,
    private readonly entitlements: Entitlements,
    private readonly verification: EmailVerificationService,
    private readonly featureFlags: FeatureFlags,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  /** Creates a tenant with its owner account and signs the owner in. */
  async register(input: RegisterInput): Promise<IssuedAuth> {
    const passwordHash = await this.hasher.hash(input.password);
    try {
      const { result, verify } = await this.prisma.asSystem(async (tx) => {
        const existing = await tx.user.findUnique({
          where: { email: input.email },
          select: { id: true },
        });
        if (existing) throw this.emailInUse();

        const tenant = await tx.tenant.create({
          data: {
            name: input.businessName,
            slug: withSlugSuffix(
              slugifyBusinessName(input.businessName),
              randomBytes(3).toString('hex'),
            ),
            businessType: input.businessType ?? null,
          },
        });
        const user = await tx.user.create({
          data: {
            email: input.email,
            fullName: input.ownerFullName,
            passwordHash,
            lastLoginAt: new Date(),
          },
        });
        const membership = await tx.membership.create({
          data: { tenantId: tenant.id, userId: user.id, role: 'OWNER' },
        });
        await tx.tenantSettings.create({
          data: defaultSettingsData(tenant.id, input.businessType ?? null),
        });
        // Every business starts with a free trial of the configured plan.
        const plan = await tx.plan.findUniqueOrThrow({
          where: { code: this.config.TRIAL_PLAN_CODE },
        });
        await tx.subscription.create({
          data: {
            tenantId: tenant.id,
            planId: plan.id,
            status: 'TRIALING',
            trialEndsAt: new Date(Date.now() + this.config.TRIAL_DAYS * 86_400_000),
          },
        });
        const verifyToken = await this.verification.issue(tx, user.id);

        await this.audit.record(tx, {
          tenantId: tenant.id,
          actorUserId: user.id,
          action: 'tenant.registered',
          entityType: 'tenant',
          entityId: tenant.id,
          metadata: { businessType: input.businessType ?? null, clientType: input.clientType },
        });

        const issued = await this.sessions.start(tx, {
          membershipId: membership.id,
          clientType: input.clientType,
          deviceName: input.deviceName,
          deviceId: input.deviceId ?? null,
        });
        return {
          result: await this.issue(tx, issued),
          verify: verifyToken && { user, token: verifyToken },
        };
      });
      if (verify)
        this.verification.deliver(
          verify.user.email,
          verify.user.fullName,
          verify.token,
          verify.user.id,
        );
      return result;
    } catch (error) {
      // Two concurrent registrations with one email: the unique index decides.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw this.emailInUse();
      }
      throw error;
    }
  }

  async login(input: LoginInput): Promise<IssuedAuth | TenantSelectionResponse> {
    const user = await this.prisma.asSystem((tx) =>
      tx.user.findUnique({
        where: { email: input.email },
        include: {
          memberships: {
            where: { status: 'ACTIVE', tenant: { status: { not: 'CLOSED' } } },
            include: { tenant: true },
            orderBy: { createdAt: 'asc' },
          },
        },
      }),
    );

    if (!user) {
      await this.hasher.verifyDummy(input.password);
      throw invalidCredentials();
    }

    const now = new Date();
    const locked = !!user.lockedUntil && user.lockedUntil > now;
    const passwordOk = await this.hasher.verify(input.password, user.passwordHash);

    if (!passwordOk) {
      // While locked, failures are not counted again so the lock cannot be extended indefinitely.
      if (!locked) await this.recordFailedLogin(user.id);
      throw invalidCredentials();
    }
    if (locked) {
      throw new AppException(
        'ACCOUNT_LOCKED',
        HttpStatus.LOCKED,
        `Too many failed attempts. Try again in ${LOCKOUT_MINUTES} minutes or reset your password.`,
      );
    }
    if (user.status !== 'ACTIVE') {
      throw new AppException(
        'ACCOUNT_DISABLED',
        HttpStatus.FORBIDDEN,
        'This account has been disabled.',
      );
    }

    const memberships = user.memberships;
    let membership = memberships[0];
    if (input.tenantId) {
      // Never trust a client-supplied tenant: it must be one of the user's active memberships.
      membership = memberships.find((m) => m.tenantId === input.tenantId);
    } else if (memberships.length > 1) {
      return {
        requiresTenantSelection: true,
        tenants: memberships.map((m) => ({
          tenantId: m.tenantId,
          tenantName: m.tenant.name,
          tenantSlug: m.tenant.slug,
          role: m.role,
        })),
      };
    }
    if (!membership) {
      throw new AppException(
        'NO_ACTIVE_MEMBERSHIP',
        HttpStatus.FORBIDDEN,
        'You do not have access to this business.',
      );
    }
    if (membership.tenant.status === 'SUSPENDED') {
      throw new AppException(
        'TENANT_SUSPENDED',
        HttpStatus.FORBIDDEN,
        'This business account is suspended.',
      );
    }

    const upgradedHash = this.hasher.needsRehash(user.passwordHash)
      ? await this.hasher.hash(input.password)
      : null;
    const selected = membership;

    return this.prisma.asSystem(async (tx) => {
      await tx.user.update({
        where: { id: user.id },
        data: {
          failedLoginCount: 0,
          lockedUntil: null,
          lastLoginAt: now,
          ...(upgradedHash ? { passwordHash: upgradedHash } : {}),
        },
      });
      // A till reported lost or stolen cannot sign in to the business again.
      if (input.deviceId) await assertDeviceUsable(tx, selected.tenantId, input.deviceId);
      const issued = await this.sessions.start(tx, {
        membershipId: selected.id,
        clientType: input.clientType,
        deviceName: input.deviceName,
        deviceId: input.deviceId ?? null,
      });
      await this.audit.record(tx, {
        tenantId: selected.tenantId,
        actorUserId: user.id,
        action: 'auth.login_succeeded',
        entityType: 'session',
        entityId: issued.familyId,
        metadata: { clientType: input.clientType, deviceName: input.deviceName ?? null },
      });
      return this.issue(tx, issued);
    });
  }

  /** What an invitation link offers, for the accept page. Invalid links get one generic answer. */
  async previewInvitation(token: string): Promise<InvitationPreview> {
    return this.prisma.asSystem(async (tx) => {
      const invitation = await this.openInvitation(tx, token);
      const user = await tx.user.findUnique({
        where: { email: invitation.email },
        select: { id: true },
      });
      return {
        businessName: invitation.tenant.name,
        email: invitation.email,
        role: invitation.role,
        existingAccount: !!user,
      };
    });
  }

  /**
   * Joins the business from an invitation and signs in. A new account is created with
   * the given name and password; an existing account must prove its password.
   */
  async acceptInvitation(input: AcceptInvitationInput): Promise<IssuedAuth> {
    const preview = await this.prisma.asSystem(async (tx) => {
      const invitation = await this.openInvitation(tx, input.token);
      const user = await tx.user.findUnique({ where: { email: invitation.email } });
      return { invitation, user };
    });
    const { invitation } = preview;
    let user = preview.user;
    if (user) {
      // Same constant-work check as login, so the response does not reveal the password state.
      if (!(await this.hasher.verify(input.password, user.passwordHash)))
        throw new AppException(
          'INVALID_CREDENTIALS',
          HttpStatus.UNAUTHORIZED,
          'Email or password is incorrect.',
        );
      if (user.status !== 'ACTIVE')
        throw new AppException(
          'ACCOUNT_DISABLED',
          HttpStatus.UNAUTHORIZED,
          'This account has been disabled.',
        );
    } else {
      const issues = [
        ...(input.fullName ? [] : [{ path: 'fullName', message: 'validation.required' }]),
        ...checkPassword(input.password, {
          email: invitation.email,
          fullName: input.fullName ?? '',
        }).map((issue) => ({ path: 'password', message: `validation.password.${issue}` })),
      ];
      if (issues.length > 0) throw AppException.validation(issues);
    }
    const passwordHash = user ? null : await this.hasher.hash(input.password);

    return this.prisma.asSystem(async (tx) => {
      // Claim the invitation first: a link can only be used once, even by two tabs at once.
      const claimed = await tx.invitation.updateMany({
        where: {
          id: invitation.id,
          acceptedAt: null,
          revokedAt: null,
          expiresAt: { gt: new Date() },
        },
        data: { acceptedAt: new Date() },
      });
      if (claimed.count === 0) throw invitationInvalid();
      if (!user) {
        user = await tx.user.create({
          // The invitation reached this address, which proves the person owns it.
          data: {
            email: invitation.email,
            fullName: input.fullName!,
            passwordHash: passwordHash!,
            emailVerifiedAt: new Date(),
          },
        });
      }
      const existing = await tx.membership.findFirst({
        where: { tenantId: invitation.tenantId, userId: user.id },
        select: { id: true },
      });
      if (existing)
        throw new AppException(
          'ALREADY_MEMBER',
          HttpStatus.CONFLICT,
          'You are already a member of this business.',
        );
      if (input.deviceId) await assertDeviceUsable(tx, invitation.tenantId, input.deviceId);
      // The claimed invitation no longer counts, so this checks for a free staff place.
      await this.entitlements.assertCanAdd(tx, invitation.tenantId, 'staff');
      const membership = await tx.membership.create({
        data: { tenantId: invitation.tenantId, userId: user.id, role: invitation.role },
      });
      if (invitation.branchIds.length > 0 && invitation.role !== 'OWNER') {
        const active = await tx.branch.findMany({
          where: { tenantId: invitation.tenantId, id: { in: invitation.branchIds } },
          select: { id: true },
        });
        await tx.membershipBranch.createMany({
          data: active.map((b) => ({
            tenantId: invitation.tenantId,
            membershipId: membership.id,
            branchId: b.id,
          })),
        });
      }
      await tx.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
      await this.audit.record(tx, {
        tenantId: invitation.tenantId,
        actorUserId: user.id,
        action: 'staff.joined',
        entityType: 'membership',
        entityId: membership.id,
        metadata: { invitationId: invitation.id, role: invitation.role },
      });
      const issued = await this.sessions.start(tx, {
        membershipId: membership.id,
        clientType: input.clientType,
        deviceName: input.deviceName,
        deviceId: input.deviceId ?? null,
      });
      return this.issue(tx, issued);
    });
  }

  private async openInvitation(tx: Tx, token: string) {
    const invitation = await tx.invitation.findUnique({
      where: { tokenHash: hashToken(token) },
      include: { tenant: { select: { name: true, status: true } } },
    });
    if (
      !invitation ||
      invitation.acceptedAt ||
      invitation.revokedAt ||
      invitation.expiresAt.getTime() <= Date.now() ||
      invitation.tenant.status !== 'ACTIVE'
    )
      throw invitationInvalid();
    return invitation;
  }

  /** Rotates a refresh token. Replaying a rotated token outside the grace window revokes the whole family. */
  async refresh(refreshToken: string): Promise<IssuedAuth> {
    const now = Date.now();
    const outcome = await this.prisma.asSystem(async (tx) => {
      const session = await tx.session.findUnique({
        where: { refreshTokenHash: hashToken(refreshToken) },
        include: { membership: { include: { user: true, tenant: true } } },
      });
      if (!session) return { kind: 'invalid' as const };

      if (session.revokedAt) {
        const rotatedRecently =
          session.revokedReason === 'ROTATED' &&
          now - session.revokedAt.getTime() < ROTATION_GRACE_MS;
        if (session.revokedReason === 'ROTATED' && !rotatedRecently) {
          await this.sessions.revokeFamily(tx, session.familyId, 'REUSE_DETECTED');
          await this.audit.record(tx, {
            tenantId: session.membership.tenantId,
            actorUserId: session.membership.userId,
            action: 'auth.refresh_token_reuse_detected',
            entityType: 'session',
            entityId: session.familyId,
          });
        }
        return { kind: 'invalid' as const };
      }

      const { membership } = session;
      const usable =
        session.expiresAt.getTime() > now &&
        membership.status === 'ACTIVE' &&
        membership.user.status === 'ACTIVE' &&
        membership.tenant.status !== 'CLOSED';
      if (!usable) return { kind: 'invalid' as const };
      if (membership.tenant.status === 'SUSPENDED') return { kind: 'suspended' as const };

      // Atomically claim the row so two concurrent refreshes cannot both rotate it.
      const claimed = await tx.session.updateMany({
        where: { id: session.id, revokedAt: null },
        data: { revokedAt: new Date(now), revokedReason: 'ROTATED' },
      });
      if (claimed.count === 0) return { kind: 'invalid' as const };

      const issued = await this.sessions.continueFamily(tx, {
        membershipId: session.membershipId,
        familyId: session.familyId,
        familyExpiresAt: session.familyExpiresAt,
        clientType: session.clientType,
        deviceName: session.deviceName,
        deviceId: session.deviceId,
      });
      await tx.session.update({
        where: { id: session.id },
        data: { replacedById: issued.sessionId },
      });
      return { kind: 'ok' as const, result: await this.issue(tx, issued) };
    });

    if (outcome.kind === 'suspended') {
      throw new AppException(
        'TENANT_SUSPENDED',
        HttpStatus.FORBIDDEN,
        'This business account is suspended.',
      );
    }
    if (outcome.kind !== 'ok') throw sessionExpired();
    return outcome.result;
  }

  /** Idempotent: unknown or already-revoked tokens are accepted silently. */
  async logout(refreshToken: string): Promise<void> {
    await this.prisma.asSystem(async (tx) => {
      const session = await tx.session.findUnique({
        where: { refreshTokenHash: hashToken(refreshToken) },
        select: {
          familyId: true,
          revokedAt: true,
          membership: { select: { tenantId: true, userId: true } },
        },
      });
      if (!session || session.revokedAt) return;
      await this.sessions.revokeFamily(tx, session.familyId, 'LOGOUT');
      await this.audit.record(tx, {
        tenantId: session.membership.tenantId,
        actorUserId: session.membership.userId,
        action: 'auth.logout',
        entityType: 'session',
        entityId: session.familyId,
      });
    });
  }

  async logoutAll(principal: AuthPrincipal): Promise<void> {
    await this.prisma.asSystem(async (tx) => {
      const revoked = await this.sessions.revokeAllForUser(tx, principal.userId, 'LOGOUT_ALL');
      await this.audit.record(tx, {
        tenantId: principal.tenantId,
        action: 'auth.logout_all',
        entityType: 'user',
        entityId: principal.userId,
        metadata: { revokedSessions: revoked },
      });
    });
  }

  me(principal: AuthPrincipal): Promise<AuthContext> {
    return this.prisma.asSystem((tx) => this.buildContext(tx, principal.membershipId));
  }

  private async issue(tx: Tx, issued: IssuedSession): Promise<IssuedAuth> {
    const context = await this.buildContext(tx, issued.membershipId);
    const access = await this.tokens.signAccessToken({
      sub: context.user.id,
      tid: context.tenant.id,
      sid: issued.familyId,
      role: context.role,
    });
    return {
      ...context,
      accessToken: access.token,
      accessTokenExpiresAt: access.expiresAt.toISOString(),
      refreshToken: issued.refreshToken,
      refreshTokenExpiresAt: issued.refreshTokenExpiresAt.toISOString(),
      clientType: issued.clientType,
    };
  }

  private async buildContext(tx: Tx, membershipId: string): Promise<AuthContext> {
    const membership = await tx.membership.findUniqueOrThrow({
      where: { id: membershipId },
      include: {
        user: true,
        tenant: { include: { subscription: { include: { plan: { select: { name: true } } } } } },
        branches: { select: { branchId: true } },
      },
    });
    const all = await tx.membership.findMany({
      where: { userId: membership.userId, status: 'ACTIVE', tenant: { status: { not: 'CLOSED' } } },
      include: { tenant: { select: { name: true, slug: true } } },
      orderBy: { createdAt: 'asc' },
    });
    const memberships: MembershipSummary[] = all.map((m) => ({
      tenantId: m.tenantId,
      tenantName: m.tenant.name,
      tenantSlug: m.tenant.slug,
      role: m.role,
    }));

    return {
      user: {
        id: membership.user.id,
        email: membership.user.email,
        fullName: membership.user.fullName,
        isPlatformAdmin: membership.user.isPlatformAdmin,
        emailVerified: membership.user.emailVerifiedAt !== null,
      },
      tenant: toTenantSummary(membership.tenant),
      role: membership.role,
      permissions: [...permissionsForRole(membership.role)],
      memberships,
      branchIds:
        membership.role === 'OWNER' || membership.branches.length === 0
          ? null
          : membership.branches.map((b) => b.branchId),
      subscription: toSubscriptionSummary(membership.tenant.subscription),
      features: await this.featureFlags.enabledFor(tx, membership.tenantId),
    };
  }

  private async recordFailedLogin(userId: string): Promise<void> {
    await this.prisma.asSystem(async (tx) => {
      const updated = await tx.user.update({
        where: { id: userId },
        data: { failedLoginCount: { increment: 1 } },
        select: { failedLoginCount: true },
      });
      await this.audit.record(tx, {
        tenantId: null,
        actorUserId: userId,
        action: 'auth.login_failed',
        entityType: 'user',
        entityId: userId,
        metadata: { consecutiveFailures: updated.failedLoginCount },
      });
      if (updated.failedLoginCount >= MAX_FAILED_LOGINS) {
        await tx.user.update({
          where: { id: userId },
          data: {
            failedLoginCount: 0,
            lockedUntil: new Date(Date.now() + LOCKOUT_MINUTES * 60_000),
          },
        });
        await this.audit.record(tx, {
          tenantId: null,
          actorUserId: userId,
          action: 'auth.account_locked',
          entityType: 'user',
          entityId: userId,
          metadata: { lockoutMinutes: LOCKOUT_MINUTES },
        });
      }
    });
  }

  private emailInUse() {
    return new AppException(
      'EMAIL_IN_USE',
      HttpStatus.CONFLICT,
      'An account with this email already exists. Sign in instead, or use a different email.',
    );
  }
}

/** Refuses sign-in from a device the business has revoked. */
export async function assertDeviceUsable(tx: Tx, tenantId: string, deviceId: string) {
  const device = await tx.device.findUnique({
    where: { tenantId_id: { tenantId, id: deviceId } },
    select: { revokedAt: true },
  });
  if (device?.revokedAt)
    throw new AppException(
      'DEVICE_REVOKED',
      HttpStatus.FORBIDDEN,
      'This device has been removed from the business. Ask a manager.',
    );
}

const invitationInvalid = () =>
  new AppException(
    'INVITATION_INVALID',
    HttpStatus.BAD_REQUEST,
    'This invitation link is invalid, used or expired. Ask for a new one.',
  );

type AcceptInvitationInput = z.output<typeof acceptInvitationRequestSchema>;
