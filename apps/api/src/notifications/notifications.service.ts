import { Injectable } from '@nestjs/common';
import type {
  listNotificationsQuerySchema,
  Notification,
  NotificationPage,
  NotificationPreferences,
} from '@pos/contracts';
import {
  canUseBranch,
  type NotificationKind,
  type Permission,
  roleHasPermission,
} from '@pos/domain';
import type { Prisma } from '@prisma/client';
import type { z } from 'zod';
import { AppException } from '../common/app-exception';
import type { AuthPrincipal } from '../common/request-context';
import { PrismaService, type Tx } from '../prisma/prisma.service';

type ListQuery = z.output<typeof listNotificationsQuerySchema>;

export interface NewNotification {
  tenantId: string;
  userId: string;
  kind: NotificationKind;
  /** Same key for the same event: generating twice creates one notification. */
  dedupeKey: string;
  data: Prisma.InputJsonValue;
  link?: string | null;
}

export interface Recipient {
  userId: string;
  email: string;
  fullName: string;
  emailDigest: boolean;
  branchIds: string[] | null;
}

/** In-app notifications for each person, and who should receive which kind. */
@Injectable()
export class NotificationsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Creates notifications; repeats (same person and key) are skipped. */
  async notify(tx: Tx, entries: NewNotification[]): Promise<number> {
    if (entries.length === 0) return 0;
    const { count } = await tx.notification.createMany({
      data: entries.map((e) => ({ ...e, link: e.link ?? null })),
      skipDuplicates: true,
    });
    return count;
  }

  /**
   * Active people of a business whose role has `permission` and, when a branch is
   * given, who may work at that branch.
   */
  async recipients(
    tx: Tx,
    tenantId: string,
    permission: Permission,
    branchId?: string,
  ): Promise<Recipient[]> {
    const members = await tx.membership.findMany({
      where: { tenantId, status: 'ACTIVE', user: { status: 'ACTIVE' } },
      include: {
        user: { select: { email: true, fullName: true } },
        branches: { select: { branchId: true } },
      },
    });
    return members
      .filter((m) => roleHasPermission(m.role, permission))
      .map((m) => ({
        userId: m.userId,
        email: m.user.email,
        fullName: m.user.fullName,
        emailDigest: m.emailDigest,
        branchIds:
          m.role === 'OWNER' || m.branches.length === 0 ? null : m.branches.map((b) => b.branchId),
      }))
      .filter((r) => !branchId || canUseBranch(r.branchIds, branchId));
  }

  list(principal: AuthPrincipal, query: ListQuery): Promise<NotificationPage> {
    return this.prisma.withTenant(principal.tenantId, async (tx) => {
      const rows = await tx.notification.findMany({
        where: {
          tenantId: principal.tenantId,
          userId: principal.userId,
          ...(query.unreadOnly ? { readAt: null } : {}),
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: query.limit + 1,
        ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
      });
      const page = rows.slice(0, query.limit);
      return {
        items: page.map(toNotification),
        nextCursor: rows.length > query.limit ? (page.at(-1)?.id ?? null) : null,
      };
    });
  }

  unreadCount(principal: AuthPrincipal): Promise<number> {
    return this.prisma.withTenant(principal.tenantId, (tx) =>
      tx.notification.count({
        where: { tenantId: principal.tenantId, userId: principal.userId, readAt: null },
      }),
    );
  }

  markRead(principal: AuthPrincipal, id: string): Promise<Notification> {
    return this.prisma.withTenant(principal.tenantId, async (tx) => {
      // Only the person's own notifications: anyone else's is "not found".
      const where = { id, tenantId: principal.tenantId, userId: principal.userId };
      const row = await tx.notification.findFirst({ where });
      if (!row) throw AppException.notFound();
      if (!row.readAt)
        await tx.notification.updateMany({
          where: { ...where, readAt: null },
          data: { readAt: new Date() },
        });
      return toNotification(await tx.notification.findFirstOrThrow({ where }));
    });
  }

  markAllRead(principal: AuthPrincipal): Promise<number> {
    return this.prisma.withTenant(principal.tenantId, async (tx) => {
      const { count } = await tx.notification.updateMany({
        where: { tenantId: principal.tenantId, userId: principal.userId, readAt: null },
        data: { readAt: new Date() },
      });
      return count;
    });
  }

  preferences(principal: AuthPrincipal): Promise<NotificationPreferences> {
    return this.prisma.withTenant(principal.tenantId, async (tx) => {
      const m = await tx.membership.findUniqueOrThrow({
        where: { id: principal.membershipId },
        select: { emailDigest: true },
      });
      return { emailDigest: m.emailDigest };
    });
  }

  setPreferences(
    principal: AuthPrincipal,
    input: NotificationPreferences,
  ): Promise<NotificationPreferences> {
    return this.prisma.withTenant(principal.tenantId, async (tx) => {
      const m = await tx.membership.update({
        where: { id: principal.membershipId },
        data: { emailDigest: input.emailDigest },
        select: { emailDigest: true },
      });
      return { emailDigest: m.emailDigest };
    });
  }
}

function toNotification(row: {
  id: string;
  kind: string;
  data: Prisma.JsonValue;
  link: string | null;
  readAt: Date | null;
  createdAt: Date;
}): Notification {
  return {
    id: row.id,
    kind: row.kind as NotificationKind,
    data: (row.data ?? {}) as Record<string, unknown>,
    link: row.link,
    readAt: row.readAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}
