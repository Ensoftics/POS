import { createHash } from 'node:crypto';
import { HttpStatus, Injectable } from '@nestjs/common';
import type { Customer as CustomerRow, Prisma } from '@prisma/client';
import type {
  adjustLoyaltyRequestSchema,
  LoyaltyHistory,
  createCustomerPaymentRequestSchema,
  createCustomerRequestSchema,
  Customer,
  CustomerPage,
  CustomerPayment,
  listCustomersQuerySchema,
  Statement,
  updateCustomerRequestSchema,
} from '@pos/contracts';
import { availableCredit, normalisePhone } from '@pos/domain';
import type { z } from 'zod';
import { AuditService } from '../audit/audit.service';
import { AppException } from '../common/app-exception';
import { isUniqueViolation, versionConflict } from '../common/optimistic';
import type { AuthPrincipal } from '../common/request-context';
import { nextDocumentNumber } from '../inventory/inventory-helpers';
import { PrismaService, type Tx } from '../prisma/prisma.service';
import { canActOnShift, shiftNotOpen } from '../sales/shifts.service';
import { LoyaltyLedger } from './loyalty-ledger';
import { CustomerLedger } from './customer-ledger';
import { newUnsubscribeCode, recordConsent } from './consent';

type CreateInput = z.output<typeof createCustomerRequestSchema>;
type UpdateInput = z.output<typeof updateCustomerRequestSchema>;
type ListQuery = z.output<typeof listCustomersQuerySchema>;
type PaymentInput = z.output<typeof createCustomerPaymentRequestSchema>;

export function toCustomer(row: CustomerRow): Customer {
  const limit = Number(row.creditLimitMinor);
  const balance = Number(row.balanceMinor);
  return {
    id: row.id,
    number: row.number,
    name: row.name,
    phone: row.phone,
    email: row.email,
    address: row.address,
    notes: row.notes,
    marketingConsent: row.marketingConsentAt !== null,
    marketingConsentAt: row.marketingConsentAt?.toISOString() ?? null,
    creditLimitMinor: limit,
    balanceMinor: balance,
    availableCreditMinor: availableCredit(limit, balance),
    loyaltyPoints: row.loyaltyPoints,
    status: row.status,
    version: row.version,
    createdAt: row.createdAt.toISOString(),
  };
}

const duplicatePhone = () =>
  new AppException(
    'DUPLICATE_PHONE',
    HttpStatus.CONFLICT,
    'Another customer already has this phone number.',
  );

/**
 * Customers and their accounts. Personal details are only written to the audit
 * log as field names, never values.
 */
@Injectable()
export class CustomersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly ledger: CustomerLedger,
    private readonly loyalty: LoyaltyLedger,
  ) {}

  /** The customer's points and their history, newest first. */
  loyaltyHistory(
    tenantId: string,
    id: string,
    query: { cursor?: string; limit: number },
  ): Promise<LoyaltyHistory> {
    return this.prisma.withTenant(tenantId, async (tx) => {
      const customer = await tx.customer.findFirst({
        where: { id, tenantId },
        select: { loyaltyPoints: true },
      });
      if (!customer) throw AppException.notFound();
      const rows = await tx.loyaltyEntry.findMany({
        where: { tenantId, customerId: id },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: query.limit + 1,
        ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
      });
      const page = rows.slice(0, query.limit);
      return {
        balance: customer.loyaltyPoints,
        items: page.map((row) => ({
          id: row.id,
          type: row.type,
          points: row.points,
          balanceAfter: row.balanceAfter,
          referenceType: row.referenceType,
          referenceId: row.referenceId,
          referenceNumber: row.referenceNumber,
          note: row.note,
          createdAt: row.createdAt.toISOString(),
        })),
        nextCursor: rows.length > query.limit ? (page.at(-1)?.id ?? null) : null,
      };
    });
  }

  /**
   * A manager's correction (goodwill, mistakes). Deductions cannot take the
   * balance below zero. The request id makes a retry return the same result.
   */
  async adjustLoyalty(
    tenantId: string,
    id: string,
    input: z.output<typeof adjustLoyaltyRequestSchema>,
    principal: AuthPrincipal,
  ): Promise<LoyaltyHistory> {
    await this.prisma.withTenant(tenantId, async (tx) => {
      if (await tx.loyaltyEntry.findFirst({ where: { id: input.id, tenantId } })) return;
      const customer = await tx.customer.findFirst({
        where: { id, tenantId },
        select: { id: true },
      });
      if (!customer) throw AppException.notFound();
      if (!(await this.loyalty.rules(tx, tenantId)))
        throw AppException.validation([{ path: 'points', message: 'validation.loyalty.off' }]);
      const balance = await this.loyalty.post(tx, {
        id: input.id,
        tenantId,
        customerId: id,
        type: 'ADJUST',
        points: input.points,
        referenceType: 'adjustment',
        referenceId: input.id,
        note: input.reason,
        createdById: principal.userId,
        requireBalance: input.points < 0,
      });
      await this.audit.record(tx, {
        tenantId,
        action: 'loyalty.adjusted',
        entityType: 'customer',
        entityId: id,
        metadata: { points: input.points, balance, reason: input.reason },
      });
    });
    return this.loyaltyHistory(tenantId, id, { limit: 20 });
  }

  list(tenantId: string, query: ListQuery): Promise<CustomerPage> {
    return this.prisma.withTenant(tenantId, async (tx) => {
      const country = await this.country(tx, tenantId);
      const text = query.q?.trim();
      const phone = text ? normalisePhone(text, country) : null;
      const rows = await tx.customer.findMany({
        where: {
          tenantId,
          ...(query.status === 'ALL' ? {} : { status: query.status }),
          ...(query.owing ? { balanceMinor: { gt: 0 } } : {}),
          ...(text
            ? {
                OR: [
                  { name: { contains: text, mode: 'insensitive' } },
                  { number: { equals: text.toUpperCase() } },
                  ...(phone ? [{ phone }] : []),
                ],
              }
            : {}),
        },
        orderBy: [{ name: 'asc' }, { id: 'asc' }],
        take: query.limit + 1,
        ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
      });
      const page = rows.slice(0, query.limit);
      return {
        items: page.map(toCustomer),
        nextCursor: rows.length > query.limit ? (page.at(-1)?.id ?? null) : null,
      };
    });
  }

  get(tenantId: string, id: string): Promise<Customer> {
    return this.prisma.withTenant(tenantId, async (tx) =>
      toCustomer(await this.load(tx, tenantId, id)),
    );
  }

  async create(tenantId: string, input: CreateInput, principal: AuthPrincipal): Promise<Customer> {
    if (input.creditLimitMinor && !principal.permissions.includes('customers.credit'))
      throw AppException.forbidden('Only managers can give credit.');
    try {
      return await this.prisma.withTenant(tenantId, async (tx) => {
        const phone = await this.phone(tx, tenantId, input.phone);
        const number = await nextDocumentNumber(tx, tenantId, 'customer');
        const row = await tx.customer.create({
          data: {
            tenantId,
            number,
            name: input.name,
            phone,
            email: input.email ?? null,
            address: input.address ?? null,
            notes: input.notes ?? null,
            marketingConsentAt: input.marketingConsent ? new Date() : null,
            creditLimitMinor: BigInt(input.creditLimitMinor ?? 0),
            unsubscribeCode: newUnsubscribeCode(),
          },
        });
        if (input.marketingConsent)
          await recordConsent(tx, tenantId, row.id, true, input.consentNote ?? null);
        await this.audit.record(tx, {
          tenantId,
          action: 'customer.created',
          entityType: 'customer',
          entityId: row.id,
          metadata: { number, creditLimitMinor: input.creditLimitMinor ?? 0 },
        });
        return toCustomer(row);
      });
    } catch (error) {
      if (isUniqueViolation(error)) throw duplicatePhone();
      throw error;
    }
  }

  async update(
    tenantId: string,
    id: string,
    input: UpdateInput,
    principal: AuthPrincipal,
  ): Promise<Customer> {
    try {
      return await this.prisma.withTenant(tenantId, async (tx) => {
        const current = await this.load(tx, tenantId, id);
        if (current.version !== input.version) throw versionConflict();
        const { version, marketingConsent, consentNote, phone, creditLimitMinor, ...rest } = input;
        if (
          creditLimitMinor !== undefined &&
          BigInt(creditLimitMinor) !== current.creditLimitMinor &&
          !principal.permissions.includes('customers.credit')
        )
          throw AppException.forbidden('Only managers can change credit limits.');
        const data: Prisma.CustomerUpdateManyMutationInput = {
          ...rest,
          ...(phone !== undefined ? { phone: await this.phone(tx, tenantId, phone) } : {}),
          ...(creditLimitMinor !== undefined ? { creditLimitMinor: BigInt(creditLimitMinor) } : {}),
          ...(marketingConsent !== undefined
            ? {
                // Keep the original consent time while consent continues.
                marketingConsentAt: marketingConsent
                  ? (current.marketingConsentAt ?? new Date())
                  : null,
              }
            : {}),
        };
        const { count } = await tx.customer.updateMany({
          where: { id, tenantId, version },
          data: { ...data, version: { increment: 1 } },
        });
        if (count === 0) throw versionConflict();
        const hadConsent = current.marketingConsentAt !== null;
        if (marketingConsent !== undefined && marketingConsent !== hadConsent)
          await recordConsent(tx, tenantId, id, marketingConsent, consentNote ?? null);
        await this.audit.record(tx, {
          tenantId,
          action: 'customer.updated',
          entityType: 'customer',
          entityId: id,
          // Field names only: personal details stay out of the log.
          metadata: {
            fields: Object.keys(input).filter((k) => k !== 'version'),
            ...(creditLimitMinor !== undefined ? { creditLimitMinor } : {}),
          },
        });
        return toCustomer(await this.load(tx, tenantId, id));
      });
    } catch (error) {
      if (isUniqueViolation(error)) throw duplicatePhone();
      throw error;
    }
  }

  /**
   * Records money received against a customer's account. Cash goes into the
   * collector's open shift. Idempotent on the client-generated id.
   */
  async collect(
    tenantId: string,
    customerId: string,
    input: PaymentInput,
    principal: AuthPrincipal,
  ): Promise<[CustomerPayment, boolean]> {
    const hash = createHash('sha256')
      .update(JSON.stringify([customerId, input]))
      .digest('hex');
    try {
      return await this.prisma.withTenant(tenantId, async (tx) => {
        const existing = await tx.customerPayment.findFirst({ where: { id: input.id, tenantId } });
        if (existing) {
          if (existing.requestHash !== hash)
            throw new AppException(
              'IDEMPOTENCY_CONFLICT',
              HttpStatus.CONFLICT,
              'A different payment was already recorded with this id.',
            );
          return [await this.payment(tx, tenantId, input.id), false] as [CustomerPayment, boolean];
        }
        const customer = await this.load(tx, tenantId, customerId);
        if (input.method === 'CASH' && !input.shiftId)
          throw AppException.validation([
            { path: 'shiftId', message: 'validation.collection.cash_needs_shift' },
          ]);
        if (input.shiftId) {
          // FOR SHARE: closing the shift waits for this payment, like for sales.
          const shifts = await tx.$queryRaw<
            Array<{ status: string; opened_by_id: string; branch_id: string }>
          >`
            SELECT status::text, opened_by_id, branch_id FROM shifts
            WHERE tenant_id = ${tenantId}::uuid AND id = ${input.shiftId}::uuid FOR SHARE`;
          const shift = shifts[0];
          if (!shift)
            throw AppException.validation([
              { path: 'shiftId', message: 'validation.shift.not_found' },
            ]);
          if (shift.status !== 'OPEN') throw shiftNotOpen();
          if (!canActOnShift(principal, shift.opened_by_id, shift.branch_id))
            throw AppException.forbidden('This shift belongs to another cashier.');
        }
        const number = await nextDocumentNumber(tx, tenantId, 'customer_payment');
        await tx.customerPayment.create({
          data: {
            id: input.id,
            tenantId,
            number,
            customerId: customer.id,
            method: input.method,
            amountMinor: BigInt(input.amountMinor),
            reference: input.reference ?? null,
            shiftId: input.shiftId ?? null,
            createdById: principal.userId,
            requestHash: hash,
          },
        });
        await this.ledger.post(tx, {
          tenantId,
          customerId: customer.id,
          type: 'PAYMENT',
          amountMinor: -input.amountMinor,
          referenceType: 'customer_payment',
          referenceId: input.id,
          referenceNumber: number,
          enforceLimit: false,
        });
        await this.audit.record(tx, {
          tenantId,
          action: 'customer.payment_received',
          entityType: 'customer',
          entityId: customer.id,
          metadata: { number, amountMinor: input.amountMinor, method: input.method },
        });
        return [await this.payment(tx, tenantId, input.id), true] as [CustomerPayment, boolean];
      });
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      // A simultaneous retry won the primary key.
      return this.prisma.withTenant(tenantId, async (tx) => [
        await this.payment(tx, tenantId, input.id),
        false,
      ]);
    }
  }

  /** Account activity between two business days, with opening and closing balances. */
  statement(tenantId: string, id: string, from?: string, to?: string): Promise<Statement> {
    return this.prisma.withTenant(tenantId, async (tx) => {
      const customer = await this.load(tx, tenantId, id);
      const settings = await tx.tenantSettings.findUniqueOrThrow({ where: { tenantId } });
      const tenant = await tx.tenant.findUniqueOrThrow({ where: { id: tenantId } });
      const bounds = await tx.$queryRaw<
        Array<{ start: Date; end: Date; from: string; to: string }>
      >`
        WITH d AS (
          SELECT COALESCE(${to ?? null}::date, (now() AT TIME ZONE ${settings.timezone})::date) AS t
        ), r AS (
          SELECT COALESCE(${from ?? null}::date, (SELECT t FROM d) - 30) AS f, (SELECT t FROM d) AS t
        )
        SELECT (f::timestamp AT TIME ZONE ${settings.timezone}) AS start,
               ((t + 1)::timestamp AT TIME ZONE ${settings.timezone}) AS "end",
               f::text AS from, t::text AS to
        FROM r`;
      const range = bounds[0]!;
      const before = await tx.customerLedgerEntry.findFirst({
        where: { tenantId, customerId: id, createdAt: { lt: range.start } },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      });
      const entries = await tx.customerLedgerEntry.findMany({
        where: { tenantId, customerId: id, createdAt: { gte: range.start, lt: range.end } },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      });
      const opening = Number(before?.balanceAfter ?? 0n);
      return {
        business: {
          name: tenant.name,
          legalName: settings.legalName,
          addressLines: [settings.addressLine1, settings.addressLine2, settings.city].filter(
            (l): l is string => !!l,
          ),
          timezone: settings.timezone,
          currency: settings.currency,
        },
        customer: toCustomer(customer),
        from: range.from,
        to: range.to,
        openingBalanceMinor: opening,
        closingBalanceMinor: entries.length ? Number(entries.at(-1)!.balanceAfter) : opening,
        entries: entries.map((e) => ({
          id: e.id,
          type: e.type,
          amountMinor: Number(e.amountMinor),
          balanceAfterMinor: Number(e.balanceAfter),
          referenceType: e.referenceType,
          referenceId: e.referenceId,
          referenceNumber: e.referenceNumber,
          createdAt: e.createdAt.toISOString(),
        })),
      };
    });
  }

  private async payment(tx: Tx, tenantId: string, id: string): Promise<CustomerPayment> {
    const row = await tx.customerPayment.findFirstOrThrow({
      where: { id, tenantId },
      include: {
        customer: { select: { name: true } },
        shift: { select: { number: true } },
        createdBy: { select: { fullName: true } },
      },
    });
    const entry = await tx.customerLedgerEntry.findFirstOrThrow({
      where: { tenantId, referenceType: 'customer_payment', referenceId: id },
    });
    return {
      id: row.id,
      number: row.number,
      customerId: row.customerId,
      customerName: row.customer.name,
      method: row.method,
      amountMinor: Number(row.amountMinor),
      reference: row.reference,
      shiftNumber: row.shift?.number ?? null,
      createdByName: row.createdBy?.fullName ?? null,
      createdAt: row.createdAt.toISOString(),
      balanceAfterMinor: Number(entry.balanceAfter),
    };
  }

  private async load(tx: Tx, tenantId: string, id: string) {
    const row = await tx.customer.findFirst({ where: { id, tenantId } });
    if (!row) throw AppException.notFound();
    return row;
  }

  private async country(tx: Tx, tenantId: string) {
    return (
      await tx.tenantSettings.findUniqueOrThrow({ where: { tenantId }, select: { country: true } })
    ).country;
  }

  /** Normalised phone, or a field error when it is not a phone number. */
  private async phone(tx: Tx, tenantId: string, value: string | null | undefined) {
    if (!value) return null;
    const normalised = normalisePhone(value, await this.country(tx, tenantId));
    if (!normalised)
      throw AppException.validation([{ path: 'phone', message: 'validation.phone.invalid' }]);
    return normalised;
  }
}
