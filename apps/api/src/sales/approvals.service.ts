import { HttpStatus, Injectable } from '@nestjs/common';
import type { ApprovalAction, ApprovalDto, ApproverList } from '@pos/contracts';
import { roleHasPermission } from '@pos/domain';
import { AuditService } from '../audit/audit.service';
import { PasswordHasher } from '../auth/password-hasher';
import { AppException } from '../common/app-exception';
import type { AuthPrincipal } from '../common/request-context';
import { PrismaService } from '../prisma/prisma.service';

const MAX_PIN_FAILURES = 5;
const PIN_LOCK_MINUTES = 15;

const invalid = () =>
  new AppException('APPROVAL_INVALID', HttpStatus.FORBIDDEN, 'The approval PIN is not correct.');

export const approvalRequired = (action: ApprovalAction) =>
  new AppException(
    'APPROVAL_REQUIRED',
    HttpStatus.FORBIDDEN,
    `A manager's approval is needed (${action}).`,
  );

/**
 * Manager approvals at the till. A manager (any member whose role has
 * `approvals.grant`) approves by entering their own PIN on the cashier's device.
 * PINs are hashed like passwords and lock after repeated failures. Verification
 * runs in its own transaction so failed attempts are counted even though the
 * action itself is then refused.
 */
@Injectable()
export class ApprovalsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly hasher: PasswordHasher,
  ) {}

  /** Members who can approve right now (role allows it and a PIN is set). */
  approvers(tenantId: string): Promise<ApproverList> {
    return this.prisma.withTenant(tenantId, async (tx) => {
      const rows = await tx.membership.findMany({
        where: {
          tenantId,
          status: 'ACTIVE',
          approvalPinHash: { not: null },
          user: { status: 'ACTIVE' },
        },
        include: { user: { select: { fullName: true } } },
        orderBy: { user: { fullName: 'asc' } },
      });
      return {
        items: rows
          .filter((row) => roleHasPermission(row.role, 'approvals.grant'))
          .map((row) => ({ userId: row.userId, fullName: row.user.fullName, role: row.role })),
      };
    });
  }

  pinStatus(principal: AuthPrincipal): Promise<{ hasPin: boolean }> {
    return this.prisma.withTenant(principal.tenantId, async (tx) => {
      const membership = await tx.membership.findUniqueOrThrow({
        where: { id: principal.membershipId },
        select: { approvalPinHash: true },
      });
      return { hasPin: membership.approvalPinHash !== null };
    });
  }

  /** Sets the caller's own PIN after re-checking their password. */
  async setPin(principal: AuthPrincipal, currentPassword: string, pin: string): Promise<void> {
    const user = await this.prisma.asSystem((tx) =>
      tx.user.findUniqueOrThrow({
        where: { id: principal.userId },
        select: { passwordHash: true },
      }),
    );
    if (!(await this.hasher.verify(currentPassword, user.passwordHash))) {
      throw AppException.validation([
        { path: 'currentPassword', message: 'validation.password.incorrect' },
      ]);
    }
    const hash = await this.hasher.hash(pin);
    await this.prisma.withTenant(principal.tenantId, async (tx) => {
      await tx.membership.update({
        where: { id: principal.membershipId },
        data: { approvalPinHash: hash, approvalPinFailures: 0, approvalPinLockedUntil: null },
      });
      await this.audit.record(tx, {
        tenantId: principal.tenantId,
        action: 'approval.pin_set',
        entityType: 'membership',
        entityId: principal.membershipId,
      });
    });
  }

  /**
   * Checks a submitted approval and returns the approver's user id. Call before
   * the main transaction; pass the result to `resolve`.
   */
  async verify(tenantId: string, approval: ApprovalDto | undefined): Promise<string | null> {
    if (!approval) return null;
    const result = await this.prisma.withTenant(tenantId, async (tx) => {
      const membership = await tx.membership.findFirst({
        where: {
          tenantId,
          userId: approval.approverId,
          status: 'ACTIVE',
          user: { status: 'ACTIVE' },
        },
      });
      if (!membership?.approvalPinHash || !roleHasPermission(membership.role, 'approvals.grant')) {
        // Same cost as a real check, so probing for valid approver ids gains nothing.
        await this.hasher.verifyDummy(approval.pin);
        return 'invalid' as const;
      }
      if (membership.approvalPinLockedUntil && membership.approvalPinLockedUntil > new Date())
        return 'locked' as const;
      if (await this.hasher.verify(approval.pin, membership.approvalPinHash)) {
        if (membership.approvalPinFailures > 0)
          await tx.membership.update({
            where: { id: membership.id },
            data: { approvalPinFailures: 0, approvalPinLockedUntil: null },
          });
        return membership.userId;
      }
      const failures = membership.approvalPinFailures + 1;
      const lock = failures >= MAX_PIN_FAILURES;
      await tx.membership.update({
        where: { id: membership.id },
        data: {
          approvalPinFailures: lock ? 0 : failures,
          approvalPinLockedUntil: lock ? new Date(Date.now() + PIN_LOCK_MINUTES * 60_000) : null,
        },
      });
      await this.audit.record(tx, {
        tenantId,
        action: lock ? 'approval.pin_locked' : 'approval.pin_failed',
        entityType: 'membership',
        entityId: membership.id,
      });
      return 'invalid' as const;
    });
    if (result === 'invalid') throw invalid();
    if (result === 'locked')
      throw new AppException(
        'APPROVAL_LOCKED',
        HttpStatus.FORBIDDEN,
        `Too many wrong PINs. This approver is locked for ${PIN_LOCK_MINUTES} minutes.`,
      );
    return result;
  }

  /**
   * Who approved an action that needs approval: the caller when they may approve
   * themselves, otherwise the verified approver. Throws APPROVAL_REQUIRED if neither.
   */
  resolve(
    principal: AuthPrincipal,
    needed: boolean,
    verifiedApproverId: string | null,
    action: ApprovalAction,
  ): string | null {
    if (!needed) return null;
    if (principal.permissions.includes('approvals.grant')) return principal.userId;
    if (verifiedApproverId && verifiedApproverId !== principal.userId) return verifiedApproverId;
    throw approvalRequired(action);
  }
}
