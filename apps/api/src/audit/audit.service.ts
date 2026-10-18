import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { AuditLogPage, PaginationQuery } from '@pos/contracts';
import { RequestContext } from '../common/request-context';
import { PrismaService, type Tx } from '../prisma/prisma.service';

export const AUDIT_ACTIONS = [
  'tenant.registered',
  'tenant.onboarding_completed',
  'auth.login_succeeded',
  'auth.login_failed',
  'auth.account_locked',
  'auth.logout',
  'auth.logout_all',
  'auth.refresh_token_reuse_detected',
  'auth.password_reset_requested',
  'auth.password_reset_completed',
  'auth.email_verified',
  'billing.checkout_started',
  'billing.payment_received',
  'billing.payment_failed',
  'billing.chargeback',
  'billing.cancel_scheduled',
  'billing.resumed',
  'subscription.past_due',
  'subscription.suspended',
  'subscription.cancelled',
  'support.tenant_suspended',
  'support.tenant_reinstated',
  'support.tenant_closed',
  'support.subscription_extended',
  'support.plan_changed',
  'support.payment_recorded',
  'settings.updated',
  'branch.created',
  'branch.updated',
  'branch.archived',
  'branch.restored',
  'register.created',
  'register.updated',
  'register.archived',
  'register.restored',
  'category.created',
  'category.updated',
  'product.created',
  'product.updated',
  'product.image_added',
  'product.image_removed',
  'product.images_reordered',
  'product.archived',
  'product.restored',
  'variant.created',
  'variant.updated',
  'products.imported',
  'supplier.created',
  'supplier.updated',
  'purchase_order.created',
  'purchase_order.updated',
  'purchase_order.ordered',
  'purchase_order.cancelled',
  'goods_receipt.posted',
  'stock.adjusted',
  'stock_transfer.sent',
  'stock_transfer.received',
  'stock_transfer.cancelled',
  'stock_count.started',
  'stock_count.completed',
  'stock_count.cancelled',
  'tax_rate.created',
  'tax_rate.updated',
  'tax_rate.archived',
  'shift.opened',
  'shift.closed',
  'sale.completed',
  'sale.returned',
  'sale.voided',
  'sale.conflict_resolved',
  'customer.created',
  'customer.updated',
  'customer.campaign_created',
  'customer.unsubscribed',
  'customer.payment_received',
  'loyalty.adjusted',
  'cash.paid_in',
  'cash.paid_out',
  'approval.pin_set',
  'approval.pin_failed',
  'approval.pin_locked',
  'staff.invited',
  'staff.invitation_revoked',
  'staff.joined',
  'staff.role_changed',
  'staff.disabled',
  'staff.enabled',
  'staff.branches_changed',
  'device.registered',
  'device.revoked',
  'device.restored',
] as const;
export type AuditAction = (typeof AUDIT_ACTIONS)[number];

export interface AuditEntry {
  /** null for platform-level security events not attributable to one tenant. */
  tenantId: string | null;
  action: AuditAction;
  actorUserId?: string | null;
  entityType?: string;
  entityId?: string;
  /** Never include secrets, tokens, passwords or unnecessary personal data. */
  metadata?: Prisma.InputJsonObject;
}

@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  /** Records an entry inside the caller's transaction so it commits atomically with the change. */
  async record(tx: Tx, entry: AuditEntry): Promise<void> {
    const context = RequestContext.get();
    await tx.auditLog.create({
      data: {
        tenantId: entry.tenantId,
        actorUserId: entry.actorUserId ?? context?.principal?.userId ?? null,
        action: entry.action,
        entityType: entry.entityType ?? null,
        entityId: entry.entityId ?? null,
        metadata: entry.metadata ?? undefined,
        ip: context?.ip ?? null,
        userAgent: context?.userAgent ?? null,
        requestId: context?.requestId ?? null,
      },
    });
  }

  list(tenantId: string, query: PaginationQuery): Promise<AuditLogPage> {
    return this.prisma.withTenant(tenantId, async (tx) => {
      const rows = await tx.auditLog.findMany({
        // RLS already restricts rows; the explicit filter keeps intent obvious and uses the index.
        where: { tenantId },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: query.limit + 1,
        ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
        include: { actor: { select: { fullName: true } } },
      });
      const hasMore = rows.length > query.limit;
      const items = rows.slice(0, query.limit);
      return {
        items: items.map((row) => ({
          id: row.id,
          action: row.action,
          actorUserId: row.actorUserId,
          actorName: row.actor?.fullName ?? null,
          entityType: row.entityType,
          entityId: row.entityId,
          metadata: (row.metadata as Record<string, unknown> | null) ?? null,
          ip: row.ip,
          requestId: row.requestId,
          createdAt: row.createdAt.toISOString(),
        })),
        nextCursor: hasMore ? (items.at(-1)?.id ?? null) : null,
      };
    });
  }
}
