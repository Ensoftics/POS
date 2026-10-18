import { HttpStatus, Injectable } from '@nestjs/common';
import type { CustomerEntryType } from '@prisma/client';
import { AppException } from '../common/app-exception';
import type { Tx } from '../prisma/prisma.service';

export interface AccountEntry {
  tenantId: string;
  customerId: string;
  type: CustomerEntryType;
  /** Signed minor units: positive increases what the customer owes. */
  amountMinor: number;
  referenceType: 'sale' | 'sale_return' | 'customer_payment';
  referenceId: string;
  referenceNumber: string;
  /** Refuse charges that would take the balance above the credit limit. */
  enforceLimit: boolean;
}

export const creditLimitExceeded = () =>
  new AppException(
    'CREDIT_LIMIT_EXCEEDED',
    HttpStatus.CONFLICT,
    "This would take the customer's account above their credit limit.",
  );

/**
 * The only writer of customer balances. Each change is one conditional UPDATE
 * (concurrent tills serialise on the customer row, and the limit is checked
 * against the latest balance) plus the matching ledger entry, in the caller's
 * transaction.
 */
@Injectable()
export class CustomerLedger {
  async post(tx: Tx, entry: AccountEntry): Promise<number> {
    const rows = await tx.$queryRaw<Array<{ balance: bigint; limit: bigint }>>`
      UPDATE customers SET balance_minor = balance_minor + ${entry.amountMinor}::bigint, updated_at = now()
      WHERE tenant_id = ${entry.tenantId}::uuid AND id = ${entry.customerId}::uuid
        AND (${!entry.enforceLimit} OR ${entry.amountMinor}::bigint <= 0
             OR balance_minor + ${entry.amountMinor}::bigint <= credit_limit_minor)
      RETURNING balance_minor AS balance, credit_limit_minor AS limit`;
    if (rows.length === 0) throw creditLimitExceeded();
    const balance = rows[0]!.balance;
    await tx.customerLedgerEntry.create({
      data: {
        tenantId: entry.tenantId,
        customerId: entry.customerId,
        type: entry.type,
        amountMinor: BigInt(entry.amountMinor),
        balanceAfter: balance,
        referenceType: entry.referenceType,
        referenceId: entry.referenceId,
        referenceNumber: entry.referenceNumber,
      },
    });
    return Number(balance);
  }

  /** Whether a balance is above the customer's limit (for flagging offline sales). */
  async isOverLimit(tx: Tx, tenantId: string, customerId: string): Promise<boolean> {
    const customer = await tx.customer.findFirstOrThrow({
      where: { id: customerId, tenantId },
      select: { balanceMinor: true, creditLimitMinor: true },
    });
    return customer.balanceMinor > customer.creditLimitMinor;
  }
}
