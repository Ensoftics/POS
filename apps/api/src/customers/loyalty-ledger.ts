import { HttpStatus, Injectable } from '@nestjs/common';
import type { LoyaltyRules } from '@pos/domain';
import type { LoyaltyEntryType } from '@prisma/client';
import { AppException } from '../common/app-exception';
import { FeatureFlags } from '../notifications/feature-flags.service';
import type { Tx } from '../prisma/prisma.service';

export interface LoyaltyPosting {
  tenantId: string;
  customerId: string;
  type: LoyaltyEntryType;
  /** Signed: positive adds points. */
  points: number;
  saleId?: string | null;
  referenceType: string;
  referenceId: string;
  referenceNumber?: string | null;
  note?: string | null;
  createdById?: string | null;
  /** Explicit entry id (idempotent adjustments). */
  id?: string;
  /** Refuse to take the balance below zero (paying with points, manual deductions). */
  requireBalance: boolean;
}

export const insufficientPoints = () =>
  new AppException(
    'INSUFFICIENT_POINTS',
    HttpStatus.CONFLICT,
    'The customer does not have enough points for this.',
  );

/**
 * The only way points change: one conditional UPDATE of the customer's balance
 * (so two sales cannot spend the same points) and one append-only entry.
 */
@Injectable()
export class LoyaltyLedger {
  constructor(private readonly flags: FeatureFlags) {}

  /** The business's rules, or null when loyalty is off (setting or platform flag). */
  async rules(tx: Tx, tenantId: string): Promise<LoyaltyRules | null> {
    const settings = await tx.tenantSettings.findUnique({
      where: { tenantId },
      select: {
        loyaltyEnabled: true,
        loyaltySpendPerPointMinor: true,
        loyaltyPointValueMinor: true,
        loyaltyMinRedeemPoints: true,
      },
    });
    if (!settings?.loyaltyEnabled || !(await this.flags.isEnabled(tx, tenantId, 'loyalty')))
      return null;
    return {
      enabled: true,
      spendPerPointMinor: settings.loyaltySpendPerPointMinor,
      pointValueMinor: settings.loyaltyPointValueMinor,
      minRedeemPoints: settings.loyaltyMinRedeemPoints,
    };
  }

  async post(tx: Tx, entry: LoyaltyPosting): Promise<number> {
    if (entry.points === 0) return this.balance(tx, entry.tenantId, entry.customerId);
    const rows = await tx.$queryRaw<Array<{ points: number }>>`
      UPDATE customers SET loyalty_points = loyalty_points + ${entry.points}::int, updated_at = now()
      WHERE tenant_id = ${entry.tenantId}::uuid AND id = ${entry.customerId}::uuid
        AND (${!entry.requireBalance} OR loyalty_points + ${entry.points}::int >= 0)
      RETURNING loyalty_points AS points`;
    if (rows.length === 0) throw insufficientPoints();
    const balance = rows[0]!.points;
    await tx.loyaltyEntry.create({
      data: {
        ...(entry.id ? { id: entry.id } : {}),
        tenantId: entry.tenantId,
        customerId: entry.customerId,
        type: entry.type,
        points: entry.points,
        balanceAfter: balance,
        saleId: entry.saleId ?? null,
        referenceType: entry.referenceType,
        referenceId: entry.referenceId,
        referenceNumber: entry.referenceNumber ?? null,
        note: entry.note ?? null,
        createdById: entry.createdById ?? null,
      },
    });
    return balance;
  }

  async balance(tx: Tx, tenantId: string, customerId: string): Promise<number> {
    const customer = await tx.customer.findFirstOrThrow({
      where: { id: customerId, tenantId },
      select: { loyaltyPoints: true },
    });
    return customer.loyaltyPoints;
  }

  /** Points already moved for a sale, per entry type (signed sums). */
  async totalsForSale(
    tx: Tx,
    tenantId: string,
    saleId: string,
  ): Promise<Record<LoyaltyEntryType, number>> {
    const rows = await tx.loyaltyEntry.groupBy({
      by: ['type'],
      where: { tenantId, saleId },
      _sum: { points: true },
    });
    const totals = { EARN: 0, REDEEM: 0, REVERSE: 0, REFUND: 0, ADJUST: 0 };
    for (const row of rows) totals[row.type] = row._sum.points ?? 0;
    return totals;
  }
}
