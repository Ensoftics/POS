import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { RequestContext } from '../common/request-context';
import type { Tx } from '../prisma/prisma.service';

export const PLATFORM_ACTIONS = [
  'platform.login',
  'platform.login_failed',
  'platform.logout',
  'platform.admin_granted',
  'platform.admin_revoked',
  'platform.totp_reset',
  'platform.tenant_viewed',
  'platform.tenant_suspended',
  'platform.tenant_reinstated',
  'platform.tenant_closed',
  'platform.subscription_extended',
  'platform.plan_changed',
  'platform.payment_recorded',
  'platform.plan_created',
  'platform.plan_updated',
  'platform.flag_updated',
  'platform.tenant_flag_set',
] as const;
export type PlatformAction = (typeof PLATFORM_ACTIONS)[number];

export interface PlatformAuditEntry {
  actorUserId: string | null;
  action: PlatformAction;
  tenantId?: string | null;
  entityType?: string;
  entityId?: string;
  metadata?: Prisma.InputJsonValue;
}

/** Append-only log of everything platform staff do, separate from tenants' activity logs. */
@Injectable()
export class PlatformAuditService {
  async record(tx: Tx, entry: PlatformAuditEntry): Promise<void> {
    const context = RequestContext.get();
    await tx.platformAuditLog.create({
      data: {
        actorUserId: entry.actorUserId,
        action: entry.action,
        tenantId: entry.tenantId ?? null,
        entityType: entry.entityType ?? null,
        entityId: entry.entityId ?? null,
        metadata: entry.metadata ?? undefined,
        ip: context?.ip ?? null,
        userAgent: context?.userAgent ?? null,
        requestId: context?.requestId ?? null,
      },
    });
  }
}
