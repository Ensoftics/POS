import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type {
  createStockTransferRequestSchema,
  listDocumentsQuerySchema,
  StockTransfer,
  StockTransferPage,
} from '@pos/contracts';
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
  checkLines,
  invalidState,
  itemFields,
  loadItems,
  nextDocumentNumber,
} from './inventory-helpers';
import { StockLedger } from './stock-ledger';

type CreateInput = z.output<typeof createStockTransferRequestSchema>;

const include = {
  fromBranch: { select: { name: true } },
  toBranch: { select: { name: true } },
  lines: { orderBy: { position: 'asc' as const }, include: { batch: true } },
} satisfies Prisma.StockTransferInclude;
type TransferRow = Prisma.StockTransferGetPayload<{ include: typeof include }>;

/**
 * Stock leaves the source branch when the transfer is created (IN_TRANSIT), and
 * arrives at the destination when it is received. Cancelling returns it to the
 * source. Batches travel with the stock.
 */
@Injectable()
export class TransfersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly ledger: StockLedger,
  ) {}

  list(
    tenantId: string,
    query: z.output<typeof listDocumentsQuerySchema>,
  ): Promise<StockTransferPage> {
    return this.prisma.withTenant(tenantId, async (tx) => {
      const rows = await tx.stockTransfer.findMany({
        where: {
          tenantId,
          ...(query.branchId
            ? { OR: [{ fromBranchId: query.branchId }, { toBranchId: query.branchId }] }
            : {}),
          ...(query.status ? { status: query.status as never } : {}),
        },
        include,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: query.limit + 1,
        ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
      });
      const page = rows.slice(0, query.limit);
      return {
        items: await this.toDtos(tx, tenantId, page),
        nextCursor: rows.length > query.limit ? (page.at(-1)?.id ?? null) : null,
      };
    });
  }

  get(tenantId: string, id: string): Promise<StockTransfer> {
    return this.prisma.withTenant(tenantId, (tx) => this.load(tx, tenantId, id));
  }

  /** Idempotent on the client-generated id. Returns [transfer, created]. */
  create(tenantId: string, input: CreateInput): Promise<[StockTransfer, boolean]> {
    return this.prisma.withTenant(
      tenantId,
      async (tx) => {
        if (
          await tx.stockTransfer.findFirst({
            where: { id: input.id, tenantId },
            select: { id: true },
          })
        ) {
          return [await this.load(tx, tenantId, input.id), false];
        }
        const rules = await loadCatalogRules(tx, tenantId);
        const items = await loadItems(
          tx,
          tenantId,
          input.lines.map((l) => l.variantId),
        );
        throwIfIssues([
          ...(await checkBranch(tx, tenantId, input.fromBranchId, 'fromBranchId')).issues,
          ...(await checkBranch(tx, tenantId, input.toBranchId, 'toBranchId', false)).issues,
          ...checkLines(input.lines, items, {
            allowFraction: rules.allowFractionalQuantities,
            requireActive: false,
          }),
        ]);

        const number = await nextDocumentNumber(tx, tenantId, 'stock_transfer');
        const shipped: Array<{ variantId: string; batchId: string | null; quantity: string }> = [];
        for (const line of input.lines) {
          const item = items.get(line.variantId)!;
          const taken = await this.ledger.takeOut(
            tx,
            {
              tenantId,
              branchId: input.fromBranchId,
              variantId: line.variantId,
              quantity: line.quantity,
              type: 'TRANSFER_OUT',
              referenceType: 'stock_transfer',
              referenceId: input.id,
              referenceNumber: number,
            },
            `${item.productName} (${item.sku})`,
          );
          shipped.push(...taken.map((t) => ({ variantId: line.variantId, ...t })));
        }

        await tx.stockTransfer.create({
          data: {
            id: input.id,
            tenantId,
            number,
            fromBranchId: input.fromBranchId,
            toBranchId: input.toBranchId,
            notes: input.notes ?? null,
            createdById: RequestContext.get()?.principal?.userId ?? null,
          },
        });
        await tx.stockTransferLine.createMany({
          data: shipped
            .map((line, position) => ({
              tenantId,
              variantId: line.variantId,
              batchId: line.batchId,
              position,
              quantity: new Prisma.Decimal(line.quantity),
            }))
            .map((line) => ({ ...line, transferId: input.id })),
        });
        await this.audit.record(tx, {
          tenantId,
          action: 'stock_transfer.sent',
          entityType: 'stock_transfer',
          entityId: input.id,
          metadata: {
            number,
            from: input.fromBranchId,
            to: input.toBranchId,
            lines: shipped.length,
          },
        });
        return [await this.load(tx, tenantId, input.id), true];
      },
      { timeout: 30_000 },
    );
  }

  receive(tenantId: string, id: string, version: number): Promise<StockTransfer> {
    return this.finish(tenantId, id, version, 'RECEIVED');
  }

  cancel(tenantId: string, id: string, version: number): Promise<StockTransfer> {
    return this.finish(tenantId, id, version, 'CANCELLED');
  }

  private finish(tenantId: string, id: string, version: number, to: 'RECEIVED' | 'CANCELLED') {
    return this.prisma.withTenant(
      tenantId,
      async (tx) => {
        const transfer = await tx.stockTransfer.findFirst({
          where: { id, tenantId },
          include: { lines: true },
        });
        if (!transfer) throw AppException.notFound();
        if (transfer.version !== version) throw versionConflict();
        if (transfer.status !== 'IN_TRANSIT')
          throw invalidState('Only transfers in transit can be received or cancelled.');
        // Receiving happens at the destination; cancelling returns stock to the source.
        assertBranchAllowed(
          RequestContext.get()?.principal,
          to === 'RECEIVED' ? transfer.toBranchId : transfer.fromBranchId,
        );

        // Claim the transfer first so a concurrent receive/cancel cannot double-post stock.
        const { count } = await tx.stockTransfer.updateMany({
          where: { id, tenantId, version, status: 'IN_TRANSIT' },
          data: {
            status: to,
            version: { increment: 1 },
            ...(to === 'RECEIVED' ? { receivedAt: new Date() } : { cancelledAt: new Date() }),
          },
        });
        if (count === 0) throw versionConflict();

        const branchId = to === 'RECEIVED' ? transfer.toBranchId : transfer.fromBranchId;
        for (const line of transfer.lines) {
          await this.ledger.post(tx, {
            tenantId,
            branchId,
            variantId: line.variantId,
            batchId: line.batchId,
            quantity: line.quantity.toString(),
            type: 'TRANSFER_IN',
            referenceType: 'stock_transfer',
            referenceId: id,
            referenceNumber: transfer.number,
          });
        }
        await this.audit.record(tx, {
          tenantId,
          action: to === 'RECEIVED' ? 'stock_transfer.received' : 'stock_transfer.cancelled',
          entityType: 'stock_transfer',
          entityId: id,
          metadata: { number: transfer.number },
        });
        return this.load(tx, tenantId, id);
      },
      { timeout: 30_000 },
    );
  }

  private async load(tx: Tx, tenantId: string, id: string): Promise<StockTransfer> {
    const row = await tx.stockTransfer.findFirst({ where: { id, tenantId }, include });
    if (!row) throw AppException.notFound();
    return (await this.toDtos(tx, tenantId, [row]))[0]!;
  }

  private async toDtos(tx: Tx, tenantId: string, rows: TransferRow[]): Promise<StockTransfer[]> {
    const items = await loadItems(
      tx,
      tenantId,
      rows.flatMap((row) => row.lines.map((l) => l.variantId)),
    );
    return rows.map((row) => ({
      id: row.id,
      number: row.number,
      fromBranchId: row.fromBranchId,
      fromBranchName: row.fromBranch.name,
      toBranchId: row.toBranchId,
      toBranchName: row.toBranch.name,
      status: row.status,
      notes: row.notes,
      version: row.version,
      createdAt: row.createdAt.toISOString(),
      receivedAt: row.receivedAt?.toISOString() ?? null,
      lines: row.lines.map((line) => ({
        ...itemFields(items.get(line.variantId), line.variantId),
        batchNumber: line.batch?.batchNumber ?? null,
        expiryDate: line.batch?.expiryDate?.toISOString().slice(0, 10) ?? null,
        quantity: line.quantity.toString(),
      })),
    }));
  }
}
