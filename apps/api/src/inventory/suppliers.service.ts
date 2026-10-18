import { HttpStatus, Injectable } from '@nestjs/common';
import type { Supplier as SupplierRow } from '@prisma/client';
import type {
  createSupplierRequestSchema,
  listSuppliersQuerySchema,
  Supplier,
  SupplierPage,
  updateSupplierRequestSchema,
} from '@pos/contracts';
import type { z } from 'zod';
import { AuditService } from '../audit/audit.service';
import { AppException } from '../common/app-exception';
import { diffFields, isUniqueViolation, versionConflict } from '../common/optimistic';
import { PrismaService } from '../prisma/prisma.service';

const toSupplier = (row: SupplierRow): Supplier => ({
  id: row.id,
  name: row.name,
  contactName: row.contactName,
  phone: row.phone,
  email: row.email,
  address: row.address,
  taxNumber: row.taxNumber,
  notes: row.notes,
  status: row.status,
  version: row.version,
});

const duplicateName = () =>
  new AppException(
    'DUPLICATE_NAME',
    HttpStatus.CONFLICT,
    'A supplier with this name already exists.',
  );

@Injectable()
export class SuppliersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  list(tenantId: string, query: z.output<typeof listSuppliersQuerySchema>): Promise<SupplierPage> {
    return this.prisma.withTenant(tenantId, async (tx) => {
      const rows = await tx.supplier.findMany({
        where: {
          tenantId,
          ...(query.status === 'ALL' ? {} : { status: query.status }),
          ...(query.q
            ? {
                OR: [
                  { name: { contains: query.q, mode: 'insensitive' } },
                  { contactName: { contains: query.q, mode: 'insensitive' } },
                  { phone: { contains: query.q } },
                ],
              }
            : {}),
        },
        orderBy: [{ name: 'asc' }, { id: 'asc' }],
        take: query.limit + 1,
        ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
      });
      const items = rows.slice(0, query.limit);
      return {
        items: items.map(toSupplier),
        nextCursor: rows.length > query.limit ? (items.at(-1)?.id ?? null) : null,
      };
    });
  }

  async create(
    tenantId: string,
    input: z.output<typeof createSupplierRequestSchema>,
  ): Promise<Supplier> {
    try {
      return await this.prisma.withTenant(tenantId, async (tx) => {
        const row = await tx.supplier.create({ data: { tenantId, ...input } });
        await this.audit.record(tx, {
          tenantId,
          action: 'supplier.created',
          entityType: 'supplier',
          entityId: row.id,
          metadata: { name: row.name },
        });
        return toSupplier(row);
      });
    } catch (error) {
      if (isUniqueViolation(error)) throw duplicateName();
      throw error;
    }
  }

  async update(
    tenantId: string,
    id: string,
    input: z.output<typeof updateSupplierRequestSchema>,
  ): Promise<Supplier> {
    try {
      return await this.prisma.withTenant(tenantId, async (tx) => {
        const current = await tx.supplier.findFirst({ where: { id, tenantId } });
        if (!current) throw AppException.notFound();
        if (current.version !== input.version) throw versionConflict();
        const { version, ...patch } = input;
        const { count } = await tx.supplier.updateMany({
          where: { id, tenantId, version },
          data: { ...patch, version: { increment: 1 } },
        });
        if (count === 0) throw versionConflict();
        await this.audit.record(tx, {
          tenantId,
          action: 'supplier.updated',
          entityType: 'supplier',
          entityId: id,
          metadata: { changes: diffFields<Record<string, unknown>>(current, patch) as never },
        });
        return toSupplier(await tx.supplier.findUniqueOrThrow({ where: { id } }));
      });
    } catch (error) {
      if (isUniqueViolation(error)) throw duplicateName();
      throw error;
    }
  }
}
