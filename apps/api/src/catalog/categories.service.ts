import { HttpStatus, Injectable } from '@nestjs/common';
import type {
  Category,
  CategoryList,
  createCategoryRequestSchema,
  updateCategoryRequestSchema,
} from '@pos/contracts';
import type { z } from 'zod';
import { AuditService } from '../audit/audit.service';
import { AppException } from '../common/app-exception';
import { diffFields, versionConflict } from '../common/optimistic';
import { PrismaService, type Tx } from '../prisma/prisma.service';
import { mapCatalogUniqueViolation } from './catalog-rules';
import { toCategory } from './catalog.mapper';

type CreateInput = z.output<typeof createCategoryRequestSchema>;
type UpdateInput = z.output<typeof updateCategoryRequestSchema>;

const tooDeep = () =>
  new AppException(
    'CATEGORY_DEPTH',
    HttpStatus.CONFLICT,
    'Categories can be nested one level deep: choose a top-level parent.',
  );

@Injectable()
export class CategoriesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  list(tenantId: string): Promise<CategoryList> {
    return this.prisma.withTenant(tenantId, async (tx) => {
      const rows = await tx.category.findMany({
        where: { tenantId },
        orderBy: [{ status: 'asc' }, { name: 'asc' }],
      });
      return { items: rows.map(toCategory) };
    });
  }

  async create(tenantId: string, input: CreateInput): Promise<Category> {
    return this.mapErrors(() =>
      this.prisma.withTenant(tenantId, async (tx) => {
        if (input.parentId) await this.assertValidParent(tx, tenantId, input.parentId, null);
        const row = await tx.category.create({
          data: { tenantId, name: input.name, parentId: input.parentId ?? null },
        });
        await this.audit.record(tx, {
          tenantId,
          action: 'category.created',
          entityType: 'category',
          entityId: row.id,
          metadata: { name: row.name, parentId: row.parentId },
        });
        return toCategory(row);
      }),
    );
  }

  /** Resolves (or creates) a top-level category by name; used by CSV import. */
  async findOrCreateByName(tx: Tx, tenantId: string, name: string): Promise<string> {
    const existing = await tx.category.findFirst({
      where: { tenantId, parentId: null, name: { equals: name, mode: 'insensitive' } },
      select: { id: true },
    });
    if (existing) return existing.id;
    const created = await tx.category.create({ data: { tenantId, name }, select: { id: true } });
    await this.audit.record(tx, {
      tenantId,
      action: 'category.created',
      entityType: 'category',
      entityId: created.id,
      metadata: { name, source: 'import' },
    });
    return created.id;
  }

  async update(tenantId: string, id: string, input: UpdateInput): Promise<Category> {
    return this.mapErrors(() =>
      this.prisma.withTenant(tenantId, async (tx) => {
        const current = await tx.category.findFirst({ where: { id, tenantId } });
        if (!current) throw AppException.notFound();
        if (current.version !== input.version) throw versionConflict();
        const { version, ...patch } = input;

        if (patch.parentId) await this.assertValidParent(tx, tenantId, patch.parentId, id);

        const { count } = await tx.category.updateMany({
          where: { id, tenantId, version },
          data: { ...patch, version: { increment: 1 } },
        });
        if (count === 0) throw versionConflict();
        await this.audit.record(tx, {
          tenantId,
          action: 'category.updated',
          entityType: 'category',
          entityId: id,
          metadata: { changes: diffFields<Record<string, unknown>>(current, patch) as never },
        });
        return toCategory(await tx.category.findUniqueOrThrow({ where: { id } }));
      }),
    );
  }

  /** Parent must be an active top-level category, and a category with children cannot move under another. */
  private async assertValidParent(
    tx: Tx,
    tenantId: string,
    parentId: string,
    selfId: string | null,
  ) {
    if (parentId === selfId) throw tooDeep();
    const parent = await tx.category.findFirst({ where: { id: parentId, tenantId } });
    if (!parent)
      throw AppException.validation([
        { path: 'parentId', message: 'validation.category.not_found' },
      ]);
    if (parent.parentId !== null) throw tooDeep();
    if (parent.status !== 'ACTIVE') {
      throw AppException.validation([
        { path: 'parentId', message: 'validation.category.archived' },
      ]);
    }
    if (selfId && (await tx.category.count({ where: { tenantId, parentId: selfId } })) > 0)
      throw tooDeep();
  }

  private async mapErrors<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (error) {
      throw mapCatalogUniqueViolation(error);
    }
  }
}
