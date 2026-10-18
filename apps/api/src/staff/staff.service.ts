import { Inject, Injectable, Logger } from '@nestjs/common';
import { HttpStatus } from '@nestjs/common';
import type { TenantRole } from '@prisma/client';
import type {
  createInvitationRequestSchema,
  Invitation,
  StaffList,
  StaffMember,
  updateStaffRequestSchema,
} from '@pos/contracts';
import { canManageRole } from '@pos/domain';
import type { z } from 'zod';
import { AuditService } from '../audit/audit.service';
import { Entitlements } from '../billing/entitlements';
import { SessionService } from '../auth/session.service';
import { generateOpaqueToken } from '../auth/token.service';
import { AppException } from '../common/app-exception';
import { isUniqueViolation, versionConflict } from '../common/optimistic';
import type { AuthPrincipal } from '../common/request-context';
import { APP_CONFIG, type AppConfig } from '../config/app-config';
import { Mailer } from '../mail/mailer';
import { invitationEmail } from '../mail/templates';
import { PrismaService, type Tx } from '../prisma/prisma.service';

type InviteInput = z.output<typeof createInvitationRequestSchema>;
type UpdateInput = z.output<typeof updateStaffRequestSchema>;

export const INVITATION_TTL_DAYS = 7;

const roleNotAllowed = () =>
  new AppException(
    'ROLE_NOT_ALLOWED',
    HttpStatus.FORBIDDEN,
    'You can only manage staff below your own role.',
  );

/**
 * Staff of a business. Role rules: owners manage everyone, managers manage
 * cashiers and inventory staff; nobody changes their own role or status, and the
 * last active owner always remains. Changes take effect at once (permissions are
 * read live) and sign the member out of every device.
 */
@Injectable()
export class StaffService {
  private readonly logger = new Logger(StaffService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly sessions: SessionService,
    private readonly mailer: Mailer,
    private readonly entitlements: Entitlements,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  list(principal: AuthPrincipal): Promise<StaffList> {
    return this.prisma.withTenant(principal.tenantId, async (tx) => {
      const members = await tx.membership.findMany({
        where: { tenantId: principal.tenantId },
        include: {
          user: { select: { fullName: true, email: true, lastLoginAt: true } },
          branches: { select: { branchId: true } },
        },
        orderBy: [{ status: 'asc' }, { createdAt: 'asc' }],
      });
      const invitations = await tx.invitation.findMany({
        where: { tenantId: principal.tenantId, acceptedAt: null, revokedAt: null },
        include: { invitedBy: { select: { fullName: true } } },
        orderBy: { createdAt: 'desc' },
      });
      return {
        members: members.map((m): StaffMember => ({
          membershipId: m.id,
          userId: m.userId,
          fullName: m.user.fullName,
          email: m.user.email,
          role: m.role,
          status: m.status,
          branchIds: m.branches.map((b) => b.branchId),
          lastLoginAt: m.user.lastLoginAt?.toISOString() ?? null,
          isSelf: m.id === principal.membershipId,
          manageable: m.id !== principal.membershipId && canManageRole(principal.role, m.role),
          version: m.version,
        })),
        invitations: invitations.map(toInvitation),
      };
    });
  }

  async invite(principal: AuthPrincipal, input: InviteInput): Promise<Invitation> {
    if (!canManageRole(principal.role, input.role)) throw roleNotAllowed();
    const { token, hash } = generateOpaqueToken();
    const tenantId = principal.tenantId;
    try {
      const { invitation, businessName } = await this.prisma.withTenant(tenantId, async (tx) => {
        const member = await tx.membership.findFirst({
          where: { tenantId, user: { email: input.email } },
          select: { id: true },
        });
        if (member)
          throw new AppException(
            'ALREADY_MEMBER',
            HttpStatus.CONFLICT,
            'This person is already a member of the business.',
          );
        const branchIds =
          input.role === 'OWNER' ? [] : await this.checkBranches(tx, tenantId, input.branchIds);
        // A new invitation replaces any open one for the same address.
        await tx.invitation.updateMany({
          where: { tenantId, email: input.email, acceptedAt: null, revokedAt: null },
          data: { revokedAt: new Date() },
        });
        // Pending invitations count towards the plan's staff limit.
        await this.entitlements.assertCanAdd(tx, tenantId, 'staff');
        const row = await tx.invitation.create({
          data: {
            tenantId,
            email: input.email,
            role: input.role,
            branchIds,
            tokenHash: hash,
            invitedById: principal.userId,
            expiresAt: new Date(Date.now() + INVITATION_TTL_DAYS * 86_400_000),
          },
          include: { invitedBy: { select: { fullName: true } } },
        });
        // The address is personal data: the log keeps the invitation id and role only.
        await this.audit.record(tx, {
          tenantId,
          action: 'staff.invited',
          entityType: 'invitation',
          entityId: row.id,
          metadata: { role: input.role, branches: branchIds.length },
        });
        const tenant = await tx.tenant.findUniqueOrThrow({
          where: { id: tenantId },
          select: { name: true },
        });
        return { invitation: row, businessName: tenant.name };
      });
      const acceptUrl = `${this.config.WEB_APP_URL}/accept-invite?token=${encodeURIComponent(token)}`;
      this.mailer
        .send(
          invitationEmail({
            to: input.email,
            businessName,
            inviterName: invitation.invitedBy?.fullName ?? businessName,
            role: input.role,
            acceptUrl,
            ttlDays: INVITATION_TTL_DAYS,
          }),
        )
        .catch((error: unknown) =>
          // Never log the message: it contains the invitation link.
          this.logger.error({
            msg: 'invitation email failed',
            invitationId: invitation.id,
            error: String(error),
          }),
        );
      return toInvitation(invitation);
    } catch (error) {
      if (isUniqueViolation(error)) throw versionConflict();
      throw error;
    }
  }

  revokeInvitation(principal: AuthPrincipal, id: string): Promise<void> {
    return this.prisma.withTenant(principal.tenantId, async (tx) => {
      const invitation = await tx.invitation.findFirst({
        where: { id, tenantId: principal.tenantId },
      });
      if (!invitation) throw AppException.notFound();
      if (!canManageRole(principal.role, invitation.role)) throw roleNotAllowed();
      await tx.invitation.updateMany({
        where: { id, acceptedAt: null, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      await this.audit.record(tx, {
        tenantId: principal.tenantId,
        action: 'staff.invitation_revoked',
        entityType: 'invitation',
        entityId: id,
      });
    });
  }

  update(principal: AuthPrincipal, membershipId: string, input: UpdateInput): Promise<StaffMember> {
    const tenantId = principal.tenantId;
    return this.prisma.withTenant(tenantId, async (tx) => {
      const current = await tx.membership.findFirst({
        where: { id: membershipId, tenantId },
        include: { branches: true },
      });
      if (!current) throw AppException.notFound();
      if (current.id === principal.membershipId)
        throw new AppException(
          'ROLE_NOT_ALLOWED',
          HttpStatus.FORBIDDEN,
          'You cannot change your own access.',
        );
      if (current.version !== input.version) throw versionConflict();
      const newRole: TenantRole = input.role ?? current.role;
      if (!canManageRole(principal.role, current.role) || !canManageRole(principal.role, newRole))
        throw roleNotAllowed();

      const losingOwner =
        current.role === 'OWNER' &&
        current.status === 'ACTIVE' &&
        (newRole !== 'OWNER' || input.status === 'DISABLED');
      if (losingOwner) {
        // Lock owner memberships so two owners cannot demote each other at once.
        const owners = await tx.$queryRaw<Array<{ id: string }>>`
          SELECT id FROM memberships
          WHERE tenant_id = ${tenantId}::uuid AND role = 'OWNER' AND status = 'ACTIVE' FOR UPDATE`;
        if (owners.length <= 1)
          throw new AppException(
            'LAST_OWNER',
            HttpStatus.CONFLICT,
            'A business needs at least one active owner.',
          );
      }

      if (input.status === 'ACTIVE' && current.status === 'DISABLED')
        await this.entitlements.assertCanAdd(tx, tenantId, 'staff');
      const { count } = await tx.membership.updateMany({
        where: { id: membershipId, tenantId, version: input.version },
        data: {
          ...(input.role ? { role: input.role } : {}),
          ...(input.status ? { status: input.status } : {}),
          version: { increment: 1 },
        },
      });
      if (count === 0) throw versionConflict();

      let branchesChanged = false;
      if (input.branchIds !== undefined || newRole === 'OWNER') {
        const ids =
          newRole === 'OWNER'
            ? []
            : await this.checkBranches(
                tx,
                tenantId,
                input.branchIds ?? current.branches.map((b) => b.branchId),
              );
        const before = current.branches
          .map((b) => b.branchId)
          .sort()
          .join(',');
        branchesChanged = before !== [...ids].sort().join(',');
        await tx.membershipBranch.deleteMany({ where: { membershipId } });
        if (ids.length > 0)
          await tx.membershipBranch.createMany({
            data: ids.map((branchId) => ({ tenantId, membershipId, branchId })),
          });
      }

      const roleChanged = newRole !== current.role;
      const statusChanged = input.status !== undefined && input.status !== current.status;
      // Access changed: end every session so the member signs in again with the new rights.
      if (roleChanged || statusChanged || branchesChanged)
        await this.sessions.revokeAllForMembership(tx, membershipId, 'ADMIN');
      if (roleChanged)
        await this.audit.record(tx, {
          tenantId,
          action: 'staff.role_changed',
          entityType: 'membership',
          entityId: membershipId,
          metadata: { from: current.role, to: newRole },
        });
      if (statusChanged)
        await this.audit.record(tx, {
          tenantId,
          action: input.status === 'DISABLED' ? 'staff.disabled' : 'staff.enabled',
          entityType: 'membership',
          entityId: membershipId,
        });
      if (branchesChanged)
        await this.audit.record(tx, {
          tenantId,
          action: 'staff.branches_changed',
          entityType: 'membership',
          entityId: membershipId,
        });

      const row = await tx.membership.findFirstOrThrow({
        where: { id: membershipId, tenantId },
        include: {
          user: { select: { fullName: true, email: true, lastLoginAt: true } },
          branches: { select: { branchId: true } },
        },
      });
      return {
        membershipId: row.id,
        userId: row.userId,
        fullName: row.user.fullName,
        email: row.user.email,
        role: row.role,
        status: row.status,
        branchIds: row.branches.map((b) => b.branchId),
        lastLoginAt: row.user.lastLoginAt?.toISOString() ?? null,
        isSelf: false,
        manageable: canManageRole(principal.role, row.role),
        version: row.version,
      };
    });
  }

  /** Active branches of this business, or a field error. */
  private async checkBranches(tx: Tx, tenantId: string, ids: string[]): Promise<string[]> {
    if (ids.length === 0) return [];
    const found = await tx.branch.findMany({
      where: { tenantId, id: { in: ids }, status: 'ACTIVE' },
      select: { id: true },
    });
    if (found.length !== ids.length)
      throw AppException.validation([
        { path: 'branchIds', message: 'validation.branch.not_found' },
      ]);
    return ids;
  }
}

export function toInvitation(row: {
  id: string;
  email: string;
  role: TenantRole;
  branchIds: string[];
  createdAt: Date;
  expiresAt: Date;
  invitedBy: { fullName: string } | null;
}): Invitation {
  return {
    id: row.id,
    email: row.email,
    role: row.role,
    branchIds: row.branchIds,
    invitedByName: row.invitedBy?.fullName ?? null,
    createdAt: row.createdAt.toISOString(),
    expiresAt: row.expiresAt.toISOString(),
    expired: row.expiresAt.getTime() < Date.now(),
  };
}
