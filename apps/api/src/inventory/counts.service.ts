import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type {
  createStockCountRequestSchema,
  listDocumentsQuerySchema,
  StockCount,
  StockCountPage,
  updateStockCountRequestSchema,
  ValidationIssue,
} from '@pos/contracts';
import { fromMilli, parseQuantity, toMilli } from '@pos/domain';
import type { z } from 'zod';
import { AuditService } from '../audit/audit.service';
import { AppException } from '../common/app-exception';
import { assertBranchAllowed } from '../common/branch-access';
import { versionConflict } from '../common/optimistic';
import { RequestContext } from '../common/request-context';
import { loadCatalogRules, throwIfIssues } from '../catalog/catalog-rules';
import { PrismaService, type Tx } from '../prisma/prisma.service';
import {
  checkBranch,
  invalidState,
  itemFields,
  loadItems,
  nextDocumentNumber,
} from './inventory-helpers';
import { StockLedger } from './stock-ledger';

const include = {
  branch: { select: { name: true } },
  lines: { include: { batch: { select: { batchNumber: true } } } },
} satisfies Prisma.StockCountInclude;
type CountRow = Prisma.StockCountGetPayload<{ include: typeof include }>;

/**
 * Stock counts: OPEN -> COMPLETED (or CANCELLED). Lines start with every stock
 * row of the branch; counters fill in counted quantities (and may add items not
 * listed). Completion locks the affected balances and posts counted - current as
 * COUNT_CORRECTION movements, so sales recorded during the count are respected
 * up to the moment of completion. Uncounted lines are left unchanged.
 */
@Injectable()
export class CountsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly ledger: StockLedger,
  ) {}

  list(
    tenantId: string,
    query: z.output<typeof listDocumentsQuerySchema>,
  ): Promise<StockCountPage> {
    return this.prisma.withTenant(tenantId, async (tx) => {
      const rows = await tx.stockCount.findMany({
        where: {
          tenantId,
          ...(query.branchId ? { branchId: query.branchId } : {}),
          ...(query.status ? { status: query.status as never } : {}),
        },
        include: { branch: { select: { name: true } }, _count: { select: { lines: true } } },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: query.limit + 1,
        ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
      });
      const page = rows.slice(0, query.limit);
      return {
        items: page.map((row) => ({
          id: row.id,
          number: row.number,
          branchId: row.branchId,
          branchName: row.branch.name,
          status: row.status,
          notes: row.notes,
          version: row.version,
          createdAt: row.createdAt.toISOString(),
          completedAt: row.completedAt?.toISOString() ?? null,
          lineCount: row._count.lines,
        })),
        nextCursor: rows.length > query.limit ? (page.at(-1)?.id ?? null) : null,
      };
    });
  }

  get(tenantId: string, id: string): Promise<StockCount> {
    return this.prisma.withTenant(tenantId, (tx) => this.load(tx, tenantId, id));
  }

  start(
    tenantId: string,
    input: z.output<typeof createStockCountRequestSchema>,
  ): Promise<StockCount> {
    return this.prisma.withTenant(
      tenantId,
      async (tx) => {
        throwIfIssues((await checkBranch(tx, tenantId, input.branchId, 'branchId')).issues);
        const open = await tx.stockCount.count({
          where: { tenantId, branchId: input.branchId, status: 'OPEN' },
        });
        if (open > 0)
          throw invalidState(
            'This branch already has an open stock count. Complete or cancel it first.',
          );

        const number = await nextDocumentNumber(tx, tenantId, 'stock_count');
        const levels = await tx.stockLevel.findMany({
          where: { tenantId, branchId: input.branchId },
        });
        const count = await tx.stockCount.create({
          data: {
            tenantId,
            number,
            branchId: input.branchId,
            notes: input.notes ?? null,
            createdById: RequestContext.get()?.principal?.userId ?? null,
          },
        });
        await tx.stockCountLine.createMany({
          data: levels.map((level) => ({
            tenantId,
            countId: count.id,
            variantId: level.variantId,
            batchId: level.batchId,
            expectedQuantity: level.quantity,
          })),
        });
        await this.audit.record(tx, {
          tenantId,
          action: 'stock_count.started',
          entityType: 'stock_count',
          entityId: count.id,
          metadata: { number, lines: levels.length },
        });
        return this.load(tx, tenantId, count.id);
      },
      { timeout: 30_000 },
    );
  }

  updateLines(
    tenantId: string,
    id: string,
    input: z.output<typeof updateStockCountRequestSchema>,
  ): Promise<StockCount> {
    return this.prisma.withTenant(tenantId, async (tx) => {
      const count = await this.claim(tx, tenantId, id, input.version);
      const rules = await loadCatalogRules(tx, tenantId);
      const items = await loadItems(
        tx,
        tenantId,
        input.lines.map((l) => l.variantId),
      );
      const issues: ValidationIssue[] = [];
      input.lines.forEach((line, index) => {
        if (!items.has(line.variantId))
          issues.push({ path: `lines.${index}.variantId`, message: 'validation.item.not_found' });
        if (line.countedQuantity !== null) {
          const parsed = parseQuantity(line.countedQuantity, {
            allowFraction: rules.allowFractionalQuantities,
          });
          if (!parsed.ok)
            issues.push({
              path: `lines.${index}.countedQuantity`,
              message: `validation.quantity.${parsed.issue}`,
            });
        }
      });
      throwIfIssues(issues);

      for (const line of input.lines) {
        const batchId = line.batchId ?? null;
        const counted =
          line.countedQuantity === null ? null : new Prisma.Decimal(line.countedQuantity);
        const existing = await tx.stockCountLine.findFirst({
          where: { tenantId, countId: count.id, variantId: line.variantId, batchId },
        });
        if (existing) {
          await tx.stockCountLine.update({
            where: { id: existing.id },
            data: { countedQuantity: counted },
          });
        } else {
          // An item found on the shelf that the system did not list.
          await tx.stockCountLine.create({
            data: {
              tenantId,
              countId: count.id,
              variantId: line.variantId,
              batchId,
              expectedQuantity: 0,
              countedQuantity: counted,
            },
          });
        }
      }
      return this.load(tx, tenantId, id);
    });
  }

  complete(tenantId: string, id: string, version: number): Promise<StockCount> {
    return this.prisma.withTenant(
      tenantId,
      async (tx) => {
        const count = await this.claim(tx, tenantId, id, version);
        const lines = await tx.stockCountLine.findMany({
          where: { tenantId, countId: id, countedQuantity: { not: null } },
        });
        await this.ledger.lock(tx, tenantId, count.branchId, [
          ...new Set(lines.map((l) => l.variantId)),
        ]);

        let corrections = 0;
        for (const line of lines) {
          const level = await tx.stockLevel.findFirst({
            where: {
              tenantId,
              branchId: count.branchId,
              variantId: line.variantId,
              batchId: line.batchId,
            },
          });
          const variance =
            toMilli(line.countedQuantity!.toString()) - toMilli(level?.quantity.toString() ?? '0');
          if (variance !== 0) {
            await this.ledger.post(tx, {
              tenantId,
              branchId: count.branchId,
              variantId: line.variantId,
              batchId: line.batchId,
              quantity: fromMilli(variance),
              type: 'COUNT_CORRECTION',
              referenceType: 'stock_count',
              referenceId: id,
              referenceNumber: count.number,
            });
            corrections += 1;
          }
          await tx.stockCountLine.update({
            where: { id: line.id },
            data: { varianceQuantity: new Prisma.Decimal(fromMilli(variance)) },
          });
        }
        await tx.stockCount.update({
          where: { id },
          data: { status: 'COMPLETED', completedAt: new Date() },
        });
        await this.audit.record(tx, {
          tenantId,
          action: 'stock_count.completed',
          entityType: 'stock_count',
          entityId: id,
          metadata: { number: count.number, counted: lines.length, corrections },
        });
        return this.load(tx, tenantId, id);
      },
      { timeout: 60_000 },
    );
  }

  cancel(tenantId: string, id: string, version: number): Promise<StockCount> {
    return this.prisma.withTenant(tenantId, async (tx) => {
      const count = await this.claim(tx, tenantId, id, version);
      await tx.stockCount.update({ where: { id }, data: { status: 'CANCELLED' } });
      await this.audit.record(tx, {
        tenantId,
        action: 'stock_count.cancelled',
        entityType: 'stock_count',
        entityId: id,
        metadata: { number: count.number },
      });
      return this.load(tx, tenantId, id);
    });
  }

  /** Checks the count is open and at the expected version, and bumps the version. */
  private async claim(tx: Tx, tenantId: string, id: string, version: number) {
    const count = await tx.stockCount.findFirst({ where: { id, tenantId } });
    if (!count) throw AppException.notFound();
    assertBranchAllowed(RequestContext.get()?.principal, count.branchId);
    if (count.version !== version) throw versionConflict();
    if (count.status !== 'OPEN') throw invalidState('This stock count is no longer open.');
    const { count: updated } = await tx.stockCount.updateMany({
      where: { id, tenantId, version, status: 'OPEN' },
      data: { version: { increment: 1 } },
    });
    if (updated === 0) throw versionConflict();
    return count;
  }

  private async load(tx: Tx, tenantId: string, id: string): Promise<StockCount> {
    const row = await tx.stockCount.findFirst({ where: { id, tenantId }, include });
    if (!row) throw AppException.notFound();
    return this.toDto(
      row,
      await loadItems(
        tx,
        tenantId,
        row.lines.map((l) => l.variantId),
      ),
    );
  }

  private toDto(row: CountRow, items: Awaited<ReturnType<typeof loadItems>>): StockCount {
    const lines = row.lines
      .map((line) => ({
        ...itemFields(items.get(line.variantId), line.variantId),
        batchId: line.batchId,
        batchNumber: line.batch?.batchNumber ?? null,
        expectedQuantity: line.expectedQuantity.toString(),
        countedQuantity: line.countedQuantity?.toString() ?? null,
        varianceQuantity: line.varianceQuantity?.toString() ?? null,
      }))
      .sort((a, b) => a.productName.localeCompare(b.productName) || a.sku.localeCompare(b.sku));
    return {
      id: row.id,
      number: row.number,
      branchId: row.branchId,
      branchName: row.branch.name,
      status: row.status,
      notes: row.notes,
      version: row.version,
      createdAt: row.createdAt.toISOString(),
      completedAt: row.completedAt?.toISOString() ?? null,
      lines,
    };
  }
}
