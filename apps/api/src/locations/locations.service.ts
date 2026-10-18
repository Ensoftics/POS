import { HttpStatus, Injectable } from '@nestjs/common';
import type { LocationStatus } from '@prisma/client';
import type {
  Branch,
  BranchList,
  createBranchRequestSchema,
  createRegisterRequestSchema,
  Register,
  updateBranchRequestSchema,
  updateRegisterRequestSchema,
} from '@pos/contracts';
import { FIRST_REGISTER_CODE, MAIN_BRANCH_CODE } from '@pos/domain';
import type { z } from 'zod';
import { AuditService } from '../audit/audit.service';
import { AppException } from '../common/app-exception';
import {
  diffFields,
  duplicateCode,
  isUniqueViolation,
  versionConflict,
} from '../common/optimistic';
import { allowedBranchFilter } from '../common/branch-access';
import { RequestContext } from '../common/request-context';
import { Entitlements } from '../billing/entitlements';
import { PrismaService, type Tx } from '../prisma/prisma.service';
import { toBranch, toRegister } from './locations.mapper';

type CreateBranchInput = z.output<typeof createBranchRequestSchema>;
type UpdateBranchInput = z.output<typeof updateBranchRequestSchema>;
type CreateRegisterInput = z.output<typeof createRegisterRequestSchema>;
type UpdateRegisterInput = z.output<typeof updateRegisterRequestSchema>;

const branchArchived = () =>
  new AppException(
    'BRANCH_ARCHIVED',
    HttpStatus.CONFLICT,
    'This branch is archived. Restore the branch first.',
  );

const ACTIVE_FIRST: Record<LocationStatus, number> = { ACTIVE: 0, ARCHIVED: 1 };

@Injectable()
export class LocationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly entitlements: Entitlements,
  ) {}

  list(tenantId: string, includeArchived: boolean): Promise<BranchList> {
    return this.prisma.withTenant(tenantId, async (tx) => {
      const statusFilter = includeArchived ? {} : { status: 'ACTIVE' as const };
      const allowed = allowedBranchFilter(RequestContext.get()?.principal);
      const rows = await tx.branch.findMany({
        // Staff limited to some branches only see those.
        where: { tenantId, ...statusFilter, ...(allowed ? { id: allowed } : {}) },
        include: { registers: { where: statusFilter, orderBy: { code: 'asc' } } },
        orderBy: [{ createdAt: 'asc' }, { code: 'asc' }],
      });
      rows.sort((a, b) => ACTIVE_FIRST[a.status] - ACTIVE_FIRST[b.status]);
      return { items: rows.map(toBranch) };
    });
  }

  /** Creates "Main branch" with "Register 1" when a tenant has no branches yet (onboarding). */
  async ensureDefaultLocation(tx: Tx, tenantId: string): Promise<void> {
    if ((await tx.branch.count({ where: { tenantId } })) > 0) return;
    const branch = await tx.branch.create({
      data: { tenantId, code: MAIN_BRANCH_CODE, name: 'Main branch' },
    });
    await tx.register.create({
      data: { tenantId, branchId: branch.id, code: FIRST_REGISTER_CODE, name: 'Register 1' },
    });
  }

  async createBranch(tenantId: string, input: CreateBranchInput): Promise<Branch> {
    return this.mapDuplicates(() =>
      this.prisma.withTenant(tenantId, async (tx) => {
        await this.entitlements.assertCanAdd(tx, tenantId, 'branches');
        const row = await tx.branch.create({
          data: { tenantId, ...input },
          include: { registers: true },
        });
        await this.audit.record(tx, {
          tenantId,
          action: 'branch.created',
          entityType: 'branch',
          entityId: row.id,
          metadata: { code: row.code, name: row.name },
        });
        return toBranch(row);
      }),
    );
  }

  async updateBranch(tenantId: string, id: string, input: UpdateBranchInput): Promise<Branch> {
    return this.mapDuplicates(() =>
      this.prisma.withTenant(tenantId, async (tx) => {
        const current = await tx.branch.findFirst({ where: { id, tenantId } });
        if (!current) throw AppException.notFound();
        if (current.version !== input.version) throw versionConflict();

        const { version, ...patch } = input;
        const archiving = patch.status === 'ARCHIVED' && current.status === 'ACTIVE';
        const restoring = patch.status === 'ACTIVE' && current.status === 'ARCHIVED';
        if (restoring) await this.entitlements.assertCanAdd(tx, tenantId, 'branches');

        if (archiving) {
          // Lock the tenant's active branches so concurrent archives cannot leave zero.
          const active = await tx.$queryRaw<{ id: string }[]>`
            SELECT id FROM branches
            WHERE tenant_id = ${tenantId}::uuid AND status = 'ACTIVE'
            FOR UPDATE`;
          if (active.filter((row) => row.id !== id).length === 0) {
            throw new AppException(
              'LAST_ACTIVE_BRANCH',
              HttpStatus.CONFLICT,
              'A business needs at least one active branch.',
            );
          }
        }

        const { count } = await tx.branch.updateMany({
          where: { id, tenantId, version },
          data: { ...patch, version: { increment: 1 } },
        });
        if (count === 0) throw versionConflict();

        let archivedRegisters = 0;
        if (archiving) {
          ({ count: archivedRegisters } = await tx.register.updateMany({
            where: { tenantId, branchId: id, status: 'ACTIVE' },
            data: { status: 'ARCHIVED', version: { increment: 1 } },
          }));
        }

        await this.audit.record(tx, {
          tenantId,
          action: archiving ? 'branch.archived' : restoring ? 'branch.restored' : 'branch.updated',
          entityType: 'branch',
          entityId: id,
          metadata: {
            changes: diffFields<Record<string, unknown>>(current, patch) as never,
            ...(archiving ? { archivedRegisters } : {}),
          },
        });

        const row = await tx.branch.findUniqueOrThrow({
          where: { id },
          include: { registers: { orderBy: { code: 'asc' } } },
        });
        return toBranch(row);
      }),
    );
  }

  async createRegister(tenantId: string, input: CreateRegisterInput): Promise<Register> {
    return this.mapDuplicates(() =>
      this.prisma.withTenant(tenantId, async (tx) => {
        // RLS hides other tenants' branches, so a foreign branchId is indistinguishable from a missing one.
        const branch = await tx.branch.findFirst({ where: { id: input.branchId, tenantId } });
        if (!branch) throw AppException.notFound('Branch not found');
        if (branch.status !== 'ACTIVE') throw branchArchived();
        await this.entitlements.assertCanAdd(tx, tenantId, 'registers');

        const row = await tx.register.create({ data: { tenantId, ...input } });
        await this.audit.record(tx, {
          tenantId,
          action: 'register.created',
          entityType: 'register',
          entityId: row.id,
          metadata: { branchId: branch.id, code: row.code, name: row.name },
        });
        return toRegister(row);
      }),
    );
  }

  async updateRegister(
    tenantId: string,
    id: string,
    input: UpdateRegisterInput,
  ): Promise<Register> {
    return this.mapDuplicates(() =>
      this.prisma.withTenant(tenantId, async (tx) => {
        const current = await tx.register.findFirst({
          where: { id, tenantId },
          include: { branch: { select: { status: true } } },
        });
        if (!current) throw AppException.notFound();
        if (current.version !== input.version) throw versionConflict();

        const { version, ...patch } = input;
        const restoring = patch.status === 'ACTIVE' && current.status === 'ARCHIVED';
        const archiving = patch.status === 'ARCHIVED' && current.status === 'ACTIVE';
        if (restoring && current.branch.status !== 'ACTIVE') throw branchArchived();
        if (restoring) await this.entitlements.assertCanAdd(tx, tenantId, 'registers');

        const { count } = await tx.register.updateMany({
          where: { id, tenantId, version },
          data: { ...patch, version: { increment: 1 } },
        });
        if (count === 0) throw versionConflict();

        const { branch: _branch, ...before } = current;
        await this.audit.record(tx, {
          tenantId,
          action: archiving
            ? 'register.archived'
            : restoring
              ? 'register.restored'
              : 'register.updated',
          entityType: 'register',
          entityId: id,
          metadata: { changes: diffFields<Record<string, unknown>>(before, patch) as never },
        });
        return toRegister(await tx.register.findUniqueOrThrow({ where: { id } }));
      }),
    );
  }

  private async mapDuplicates<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (error) {
      if (isUniqueViolation(error)) throw duplicateCode();
      throw error;
    }
  }
}
