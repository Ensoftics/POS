import { HttpStatus, Injectable } from '@nestjs/common';
import type { TaxRate as TaxRateRow } from '@prisma/client';
import type {
  createTaxRateRequestSchema,
  TaxRate,
  TaxRateList,
  updateTaxRateRequestSchema,
} from '@pos/contracts';
import type { z } from 'zod';
import { AuditService } from '../audit/audit.service';
import { AppException } from '../common/app-exception';
import { diffFields, isUniqueViolation, versionConflict } from '../common/optimistic';
import { PrismaService, type Tx } from '../prisma/prisma.service';

type CreateInput = z.output<typeof createTaxRateRequestSchema>;
type UpdateInput = z.output<typeof updateTaxRateRequestSchema>;

export const toTaxRate = (row: TaxRateRow): TaxRate => ({
  id: row.id,
  name: row.name,
  rateBp: row.rateBp,
  isDefault: row.isDefault,
  status: row.status,
  version: row.version,
});

const duplicateName = () =>
  new AppException('DUPLICATE_NAME', HttpStatus.CONFLICT, 'A tax rate with this name exists.');

/**
 * Tenant-defined tax rates. Products point at a rate or fall back to the single
 * default; sales copy the name and rate so receipts never change afterwards.
 */
@Injectable()
export class TaxRatesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  list(tenantId: string): Promise<TaxRateList> {
    return this.prisma.withTenant(tenantId, async (tx) => ({
      items: (
        await tx.taxRate.findMany({
          where: { tenantId },
          orderBy: [{ status: 'asc' }, { name: 'asc' }],
        })
      ).map(toTaxRate),
    }));
  }

  async create(tenantId: string, input: CreateInput): Promise<TaxRate> {
    try {
      return await this.prisma.withTenant(tenantId, async (tx) => {
        await this.checkName(tx, tenantId, input.name, null);
        if (input.isDefault) await this.clearDefault(tx, tenantId);
        const row = await tx.taxRate.create({
          data: {
            tenantId,
            name: input.name,
            rateBp: input.rateBp,
            isDefault: input.isDefault ?? false,
          },
        });
        await this.audit.record(tx, {
          tenantId,
          action: 'tax_rate.created',
          entityType: 'tax_rate',
          entityId: row.id,
          metadata: { name: row.name, rateBp: row.rateBp, isDefault: row.isDefault },
        });
        return toTaxRate(row);
      });
    } catch (error) {
      throw this.mapUnique(error);
    }
  }

  async update(tenantId: string, id: string, input: UpdateInput): Promise<TaxRate> {
    try {
      return await this.prisma.withTenant(tenantId, async (tx) => {
        const current = await tx.taxRate.findFirst({ where: { id, tenantId } });
        if (!current) throw AppException.notFound();
        if (current.version !== input.version) throw versionConflict();
        const { version, ...patch } = input;
        const archiving = patch.status === 'ARCHIVED' && current.status === 'ACTIVE';
        const status = patch.status ?? current.status;

        if (patch.isDefault && status !== 'ACTIVE') {
          throw AppException.validation([
            { path: 'isDefault', message: 'validation.tax_rate.default_archived' },
          ]);
        }
        if (patch.name && patch.name.toLowerCase() !== current.name.toLowerCase())
          await this.checkName(tx, tenantId, patch.name, id);
        if (archiving) {
          // Products would silently lose their tax; they must be moved to another rate first.
          const used = await tx.product.count({ where: { tenantId, taxRateId: id } });
          if (used > 0) {
            throw new AppException(
              'TAX_RATE_IN_USE',
              HttpStatus.CONFLICT,
              `This rate is assigned to ${used} product(s). Assign them another rate first.`,
            );
          }
        }
        if (patch.isDefault && !current.isDefault) await this.clearDefault(tx, tenantId);

        const { count } = await tx.taxRate.updateMany({
          where: { id, tenantId, version },
          data: {
            ...patch,
            ...(archiving ? { isDefault: false } : {}),
            version: { increment: 1 },
          },
        });
        if (count === 0) throw versionConflict();
        await this.audit.record(tx, {
          tenantId,
          action: archiving ? 'tax_rate.archived' : 'tax_rate.updated',
          entityType: 'tax_rate',
          entityId: id,
          metadata: { changes: diffFields<Record<string, unknown>>(current, patch) as never },
        });
        return toTaxRate(await tx.taxRate.findFirstOrThrow({ where: { id, tenantId } }));
      });
    } catch (error) {
      throw this.mapUnique(error);
    }
  }

  private async checkName(tx: Tx, tenantId: string, name: string, exceptId: string | null) {
    const clash = await tx.taxRate.findFirst({
      where: {
        tenantId,
        name: { equals: name, mode: 'insensitive' },
        ...(exceptId ? { id: { not: exceptId } } : {}),
      },
      select: { id: true },
    });
    if (clash)
      throw AppException.validation([{ path: 'name', message: 'validation.tax_rate.name_taken' }]);
  }

  private clearDefault(tx: Tx, tenantId: string) {
    return tx.taxRate.updateMany({
      where: { tenantId, isDefault: true },
      data: { isDefault: false, version: { increment: 1 } },
    });
  }

  /** Remaining race windows: the name index, or two requests both claiming the default. */
  private mapUnique(error: unknown): unknown {
    if (!isUniqueViolation(error)) return error;
    const text = error instanceof Error ? error.message : '';
    return text.includes('one_default') ? versionConflict() : duplicateName();
  }
}
