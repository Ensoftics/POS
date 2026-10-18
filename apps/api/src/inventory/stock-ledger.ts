import { HttpStatus, Injectable } from '@nestjs/common';
import { type AdjustmentReason, type MovementType, Prisma } from '@prisma/client';
import {
  allocateFefo,
  allocateFefoWithShortfall,
  allocateForSale,
  type Allocation,
  averageCostAfterReceipt,
  COST_SCALE,
  costOf,
} from '@pos/domain';
import { AppException } from '../common/app-exception';
import { RequestContext } from '../common/request-context';
import type { Tx } from '../prisma/prisma.service';

export interface LedgerEntry {
  tenantId: string;
  branchId: string;
  variantId: string;
  batchId: string | null;
  /** Signed decimal string: positive adds stock, negative removes it. */
  quantity: string;
  type: MovementType;
  referenceType: string;
  referenceId: string;
  referenceNumber: string;
  unitCostMinor?: bigint | null;
  reason?: AdjustmentReason | null;
  /** Cost of goods for this movement; computed at the average cost for SALE when omitted. */
  costMinor?: number | null;
}

export const insufficientStock = (detail?: string) =>
  new AppException(
    'INSUFFICIENT_STOCK',
    HttpStatus.CONFLICT,
    detail ? `Not enough stock: ${detail}` : 'Not enough stock for this operation.',
  );

export const expiredStock = (label: string) =>
  new AppException(
    'EXPIRED_STOCK',
    HttpStatus.CONFLICT,
    `Only expired stock of ${label} is left. Check the date on the item and write the expired stock off.`,
  );

export interface PostOptions {
  /** Let the balance go below zero (sales under the tenant's negative-stock policy). */
  allowNegative?: boolean;
}

/**
 * The only writer of stock. Each call changes one stock_levels row with a single
 * atomic statement (concurrent requests serialise on that row) and appends the
 * matching stock_movements row.
 *
 * Decreases are a conditional UPDATE (`… WHERE quantity + delta >= 0`). PostgreSQL
 * re-evaluates the condition on the latest row version after waiting for a
 * concurrent writer, so the second of two racing sales of the last item updates
 * nothing and is reported as INSUFFICIENT_STOCK. Only an explicit
 * `allowNegative` (the tenant's policy, sales only) skips the condition.
 */
@Injectable()
export class StockLedger {
  async post(tx: Tx, entry: LedgerEntry, options: PostOptions = {}): Promise<string> {
    // Receipts move the variant's average cost before the stock arrives (stock on hand
    // is read under the cost row's lock, so concurrent receipts average correctly).
    if (
      entry.type === 'RECEIPT' &&
      entry.unitCostMinor !== undefined &&
      entry.unitCostMinor !== null
    )
      await this.updateAverageCost(
        tx,
        entry.tenantId,
        entry.variantId,
        entry.quantity,
        entry.unitCostMinor,
      );
    const costMinor =
      entry.costMinor !== undefined
        ? entry.costMinor
        : entry.type === 'SALE'
          ? await this.costAtAverage(
              tx,
              entry.tenantId,
              entry.variantId,
              entry.quantity.replace(/^-/, ''),
            )
          : null;
    const upsert = () => tx.$queryRaw<Array<{ quantity: string }>>`
      INSERT INTO stock_levels (id, tenant_id, branch_id, variant_id, batch_id, quantity, updated_at)
      VALUES (gen_random_uuid(), ${entry.tenantId}::uuid, ${entry.branchId}::uuid, ${entry.variantId}::uuid,
              ${entry.batchId}::uuid, ${entry.quantity}::numeric, now())
      ON CONFLICT (tenant_id, branch_id, variant_id, batch_id)
      DO UPDATE SET quantity = stock_levels.quantity + EXCLUDED.quantity, updated_at = now()
      RETURNING quantity::text AS quantity`;
    const rows =
      entry.quantity.startsWith('-') && !options.allowNegative
        ? await tx.$queryRaw<Array<{ quantity: string }>>`
            UPDATE stock_levels SET quantity = quantity + ${entry.quantity}::numeric, updated_at = now()
            WHERE tenant_id = ${entry.tenantId}::uuid AND branch_id = ${entry.branchId}::uuid
              AND variant_id = ${entry.variantId}::uuid AND batch_id IS NOT DISTINCT FROM ${entry.batchId}::uuid
              AND quantity + ${entry.quantity}::numeric >= 0
            RETURNING quantity::text AS quantity`
        : await upsert();
    // No row updated: there is no balance, or not enough of it.
    if (rows.length === 0) throw insufficientStock();
    const balanceAfter = rows[0]!.quantity;

    await tx.stockMovement.create({
      data: {
        tenantId: entry.tenantId,
        branchId: entry.branchId,
        variantId: entry.variantId,
        batchId: entry.batchId,
        type: entry.type,
        quantity: new Prisma.Decimal(entry.quantity),
        balanceAfter: new Prisma.Decimal(balanceAfter),
        unitCostMinor: entry.unitCostMinor ?? null,
        costMinor: costMinor === null ? null : BigInt(costMinor),
        reason: entry.reason ?? null,
        referenceType: entry.referenceType,
        referenceId: entry.referenceId,
        referenceNumber: entry.referenceNumber,
        actorUserId: RequestContext.get()?.principal?.userId ?? null,
      },
    });
    return balanceAfter;
  }

  /**
   * Removes `quantity` (positive string) of a variant from a branch. With a batch,
   * only that batch is used; without, batches expiring soonest go first (FEFO).
   * With `allowNegative`, any shortfall is taken from unbatched stock, which may
   * then go below zero until a receipt or count corrects it.
   * Returns what was taken from which batch, e.g. for transfer lines.
   */
  async takeOut(
    tx: Tx,
    entry: Omit<LedgerEntry, 'quantity' | 'batchId'> & {
      quantity: string;
      batchId?: string | null;
    },
    label: string,
    options: PostOptions = {},
  ): Promise<Allocation[]> {
    let allocations: Allocation[] | null;
    if (entry.batchId !== undefined) {
      allocations = [{ batchId: entry.batchId, quantity: entry.quantity }];
    } else {
      const balances = await this.balances(tx, entry.tenantId, entry.branchId, entry.variantId);
      allocations = allocateFefo(balances, entry.quantity);
      if (!allocations && options.allowNegative)
        allocations = allocateFefoWithShortfall(balances, entry.quantity);
      if (!allocations) throw insufficientStock(label);
    }
    for (const allocation of allocations) {
      try {
        await this.post(
          tx,
          { ...entry, batchId: allocation.batchId, quantity: `-${allocation.quantity}` },
          options,
        );
      } catch (error) {
        if (error instanceof AppException && error.code === 'INSUFFICIENT_STOCK')
          throw insufficientStock(label);
        throw error;
      }
    }
    return allocations;
  }

  /**
   * Removes stock for a sale, never from batches that expired before `today` while
   * other stock is left (see `allocateForSale`). Offline sales pass `allowExpired`:
   * the goods have already left the shop, so expired batches are used next and
   * returned for review. Online sales refuse with EXPIRED_STOCK instead.
   */
  async takeOutForSale(
    tx: Tx,
    entry: Omit<LedgerEntry, 'quantity' | 'batchId'> & { quantity: string },
    label: string,
    options: { today: string; allowNegative: boolean; allowExpired: boolean },
  ): Promise<{ allocations: Allocation[]; expired: Allocation[] }> {
    const balances = await this.balances(tx, entry.tenantId, entry.branchId, entry.variantId);
    const result = allocateForSale(balances, entry.quantity, options.today, options);
    if (!result.ok)
      throw result.reason === 'expired' ? expiredStock(label) : insufficientStock(label);
    for (const allocation of result.allocations) {
      try {
        await this.post(
          tx,
          { ...entry, batchId: allocation.batchId, quantity: `-${allocation.quantity}` },
          { allowNegative: options.allowNegative },
        );
      } catch (error) {
        if (error instanceof AppException && error.code === 'INSUFFICIENT_STOCK')
          throw insufficientStock(label);
        throw error;
      }
    }
    return { allocations: result.allocations, expired: result.expired };
  }

  async balances(tx: Tx, tenantId: string, branchId: string, variantId: string) {
    const levels = await tx.stockLevel.findMany({
      where: { tenantId, branchId, variantId },
      include: { batch: { select: { expiryDate: true } } },
    });
    return levels.map((level) => ({
      batchId: level.batchId,
      quantity: level.quantity.toString(),
      expiryDate: level.batch?.expiryDate?.toISOString().slice(0, 10) ?? null,
    }));
  }

  /** Cost of `quantity` at the variant's average cost; the manual cost price when there is none yet. */
  async costAtAverage(tx: Tx, tenantId: string, variantId: string, quantity: string) {
    const cost = await tx.variantCost.findUnique({
      where: { tenantId_variantId: { tenantId, variantId } },
    });
    if (cost) return costOf(quantity, cost.averageCost4);
    const variant = await tx.productVariant.findFirst({
      where: { id: variantId, tenantId },
      select: { costMinor: true },
    });
    return !variant || variant.costMinor === null
      ? null
      : costOf(quantity, variant.costMinor * COST_SCALE);
  }

  private async updateAverageCost(
    tx: Tx,
    tenantId: string,
    variantId: string,
    quantity: string,
    unitCostMinor: bigint,
  ) {
    await tx.$executeRaw`
      INSERT INTO variant_costs (tenant_id, variant_id, average_cost4, updated_at)
      VALUES (${tenantId}::uuid, ${variantId}::uuid, ${unitCostMinor * COST_SCALE}, now())
      ON CONFLICT (tenant_id, variant_id) DO NOTHING`;
    const rows = await tx.$queryRaw<Array<{ average_cost4: bigint }>>`
      SELECT average_cost4 FROM variant_costs
      WHERE tenant_id = ${tenantId}::uuid AND variant_id = ${variantId}::uuid FOR UPDATE`;
    const onHand = await tx.$queryRaw<Array<{ quantity: string | null }>>`
      SELECT SUM(quantity)::text AS quantity FROM stock_levels
      WHERE tenant_id = ${tenantId}::uuid AND variant_id = ${variantId}::uuid`;
    const average = averageCostAfterReceipt({
      onHand: onHand[0]?.quantity ?? '0',
      averageCost4: rows[0]!.average_cost4,
      received: quantity,
      unitCostMinor,
    });
    await tx.$executeRaw`
      UPDATE variant_costs SET average_cost4 = ${average}, updated_at = now()
      WHERE tenant_id = ${tenantId}::uuid AND variant_id = ${variantId}::uuid`;
  }

  /** Locks the balance rows of the given variants in a branch (stock counts read-then-correct). */
  async lock(tx: Tx, tenantId: string, branchId: string, variantIds: string[]): Promise<void> {
    if (variantIds.length === 0) return;
    await tx.$queryRaw`
      SELECT id FROM stock_levels
      WHERE tenant_id = ${tenantId}::uuid AND branch_id = ${branchId}::uuid
        AND variant_id = ANY(${variantIds}::uuid[])
      FOR UPDATE`;
  }
}
