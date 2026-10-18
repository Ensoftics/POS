import { HttpStatus, Injectable } from '@nestjs/common';
import type { Device, DeviceList, registerDeviceRequestSchema } from '@pos/contracts';
import type { z } from 'zod';
import { AuditService } from '../audit/audit.service';
import { Entitlements } from '../billing/entitlements';
import { SessionService } from '../auth/session.service';
import { AppException } from '../common/app-exception';
import { assertBranchAllowed } from '../common/branch-access';
import type { AuthPrincipal } from '../common/request-context';
import { PrismaService, type Tx } from '../prisma/prisma.service';

type RegisterInput = z.output<typeof registerDeviceRequestSchema>;

const deviceInclude = {
  branch: { select: { name: true } },
  register: { select: { name: true } },
  registeredBy: { select: { fullName: true } },
} as const;

/**
 * Tills (Android devices) of a business. A device identifies itself with an id it
 * generated at install time and is bound to one register. Revoking a lost or stolen
 * device signs out every session on it and stops it signing in again.
 */
@Injectable()
export class DevicesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly sessions: SessionService,
    private readonly entitlements: Entitlements,
  ) {}

  list(tenantId: string): Promise<DeviceList> {
    return this.prisma.withTenant(tenantId, async (tx) => {
      const rows = await tx.device.findMany({
        where: { tenantId },
        include: deviceInclude,
        orderBy: [{ revokedAt: { sort: 'desc', nulls: 'first' } }, { lastSeenAt: 'desc' }],
      });
      return { items: rows.map(toDevice) };
    });
  }

  /** Registers this device to a register, or updates its name/register and last-seen time. */
  register(principal: AuthPrincipal, id: string, input: RegisterInput): Promise<Device> {
    const tenantId = principal.tenantId;
    return this.prisma.withTenant(tenantId, async (tx) => {
      const register = await tx.register.findFirst({
        where: { tenantId, id: input.registerId },
        include: { branch: { select: { status: true } } },
      });
      if (!register || register.status !== 'ACTIVE' || register.branch.status !== 'ACTIVE')
        throw AppException.validation([
          { path: 'registerId', message: 'validation.register.not_found' },
        ]);
      assertBranchAllowed(principal, register.branchId);

      const existing = await tx.device.findUnique({ where: { tenantId_id: { tenantId, id } } });
      if (existing?.revokedAt) throw deviceRevoked();
      const data = {
        name: input.name,
        branchId: register.branchId,
        registerId: register.id,
        lastSeenAt: new Date(),
      };
      if (existing) {
        await tx.device.update({ where: { tenantId_id: { tenantId, id } }, data });
      } else {
        await this.entitlements.assertCanAdd(tx, tenantId, 'devices');
        await tx.device.create({
          data: { tenantId, id, registeredById: principal.userId, ...data },
        });
        await this.audit.record(tx, {
          tenantId,
          action: 'device.registered',
          entityType: 'device',
          entityId: id,
          metadata: { registerId: register.id },
        });
      }
      return this.load(tx, tenantId, id);
    });
  }

  revoke(tenantId: string, id: string): Promise<Device> {
    return this.prisma.withTenant(tenantId, async (tx) => {
      await this.find(tx, tenantId, id);
      const { count } = await tx.device.updateMany({
        where: { tenantId, id, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      if (count > 0) {
        const signedOut = await this.sessions.revokeAllForDevice(tx, tenantId, id);
        await this.audit.record(tx, {
          tenantId,
          action: 'device.revoked',
          entityType: 'device',
          entityId: id,
          metadata: { sessionsRevoked: signedOut },
        });
      }
      return this.load(tx, tenantId, id);
    });
  }

  restore(tenantId: string, id: string): Promise<Device> {
    return this.prisma.withTenant(tenantId, async (tx) => {
      const device = await this.find(tx, tenantId, id);
      if (device.revokedAt) await this.entitlements.assertCanAdd(tx, tenantId, 'devices');
      const { count } = await tx.device.updateMany({
        where: { tenantId, id, revokedAt: { not: null } },
        data: { revokedAt: null },
      });
      if (count > 0)
        await this.audit.record(tx, {
          tenantId,
          action: 'device.restored',
          entityType: 'device',
          entityId: id,
        });
      return this.load(tx, tenantId, id);
    });
  }

  private async find(tx: Tx, tenantId: string, id: string) {
    const device = await tx.device.findUnique({ where: { tenantId_id: { tenantId, id } } });
    if (!device) throw AppException.notFound();
    return device;
  }

  private async load(tx: Tx, tenantId: string, id: string): Promise<Device> {
    const row = await tx.device.findUniqueOrThrow({
      where: { tenantId_id: { tenantId, id } },
      include: deviceInclude,
    });
    return toDevice(row);
  }
}

const deviceRevoked = () =>
  new AppException(
    'DEVICE_REVOKED',
    HttpStatus.FORBIDDEN,
    'This device has been removed from the business.',
  );

function toDevice(row: {
  id: string;
  name: string;
  branchId: string;
  registerId: string;
  lastSeenAt: Date;
  revokedAt: Date | null;
  createdAt: Date;
  branch: { name: string };
  register: { name: string };
  registeredBy: { fullName: string } | null;
}): Device {
  return {
    id: row.id,
    name: row.name,
    branchId: row.branchId,
    branchName: row.branch.name,
    registerId: row.registerId,
    registerName: row.register.name,
    registeredByName: row.registeredBy?.fullName ?? null,
    lastSeenAt: row.lastSeenAt.toISOString(),
    revoked: row.revokedAt !== null,
    createdAt: row.createdAt.toISOString(),
  };
}
