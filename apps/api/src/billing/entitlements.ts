import { HttpStatus, Injectable } from '@nestjs/common';
import { type PlanLimits, type PlanResource, type Usage, withinLimit } from '@pos/domain';
import { AppException } from '../common/app-exception';
import type { Tx } from '../prisma/prisma.service';

export function planLimits(plan: {
  maxBranches: number;
  maxRegisters: number;
  maxStaff: number;
  maxDevices: number;
}): PlanLimits {
  return {
    branches: plan.maxBranches,
    registers: plan.maxRegisters,
    staff: plan.maxStaff,
    devices: plan.maxDevices,
  };
}

export const planLimitReached = (resource: PlanResource) =>
  new AppException(
    'PLAN_LIMIT_REACHED',
    HttpStatus.CONFLICT,
    `Your plan does not include more ${resource}. Upgrade the plan to add more.`,
  );

/**
 * Plan limits on branches, registers, staff and devices. Checks lock the
 * business's subscription row first, so two requests cannot both take the last
 * free slot; the lock lasts until the surrounding transaction ends.
 */
@Injectable()
export class Entitlements {
  /** Counts what the business uses now. Staff includes open, unexpired invitations. */
  async usage(tx: Tx, tenantId: string): Promise<Usage> {
    const [branches, registers, members, invitations, devices] = await Promise.all([
      tx.branch.count({ where: { tenantId, status: 'ACTIVE' } }),
      tx.register.count({ where: { tenantId, status: 'ACTIVE', branch: { status: 'ACTIVE' } } }),
      tx.membership.count({ where: { tenantId, status: 'ACTIVE' } }),
      tx.invitation.count({
        where: { tenantId, acceptedAt: null, revokedAt: null, expiresAt: { gt: new Date() } },
      }),
      tx.device.count({ where: { tenantId, revokedAt: null } }),
    ]);
    return { branches, registers, staff: members + invitations, devices };
  }

  /**
   * Throws PLAN_LIMIT_REACHED unless one more `resource` fits. `reserved` is how
   * many of the counted items the caller is about to replace (e.g. the open
   * invitation being accepted), so it is not counted twice.
   */
  async assertCanAdd(
    tx: Tx,
    tenantId: string,
    resource: PlanResource,
    reserved = 0,
  ): Promise<void> {
    const rows = await tx.$queryRaw<
      Array<{ max_branches: number; max_registers: number; max_staff: number; max_devices: number }>
    >`
      SELECT p.max_branches, p.max_registers, p.max_staff, p.max_devices
      FROM subscriptions s JOIN plans p ON p.id = s.plan_id
      WHERE s.tenant_id = ${tenantId}::uuid
      FOR UPDATE OF s`;
    const plan = rows[0];
    if (!plan) throw planLimitReached(resource);
    const limits = planLimits({
      maxBranches: plan.max_branches,
      maxRegisters: plan.max_registers,
      maxStaff: plan.max_staff,
      maxDevices: plan.max_devices,
    });
    const usage = await this.usage(tx, tenantId);
    usage[resource] -= reserved;
    if (!withinLimit(limits, usage, resource)) throw planLimitReached(resource);
  }
}
