import { HttpStatus, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type {
  closeShiftRequestSchema,
  createCashMovementRequestSchema,
  listShiftsQuerySchema,
  openShiftRequestSchema,
  Shift,
  ShiftPage,
  ShiftSummary,
} from '@pos/contracts';
import { canUseBranch, expectedDrawerCash, PAYMENT_METHODS, type PaymentMethod } from '@pos/domain';
import type { z } from 'zod';
import { AuditService } from '../audit/audit.service';
import { AppException } from '../common/app-exception';
import { allowedBranchFilter, assertBranchAllowed } from '../common/branch-access';
import { isUniqueViolation, versionConflict } from '../common/optimistic';
import { type AuthPrincipal, RequestContext } from '../common/request-context';
import { invalidState, nextDocumentNumber } from '../inventory/inventory-helpers';
import { PrismaService, type Tx } from '../prisma/prisma.service';
import { ApprovalsService } from './approvals.service';

type OpenInput = z.output<typeof openShiftRequestSchema>;
type CloseInput = z.output<typeof closeShiftRequestSchema>;
type ListQuery = z.output<typeof listShiftsQuerySchema>;
type CashMovementInput = z.output<typeof createCashMovementRequestSchema>;

const include = {
  branch: { select: { name: true } },
  register: { select: { name: true } },
  openedBy: { select: { fullName: true } },
  closedBy: { select: { fullName: true } },
  cashMovements: {
    orderBy: { createdAt: 'asc' as const },
    include: {
      createdBy: { select: { fullName: true } },
      approvedBy: { select: { fullName: true } },
    },
  },
} satisfies Prisma.ShiftInclude;
type ShiftRow = Prisma.ShiftGetPayload<{ include: typeof include }>;

const alreadyOpen = () =>
  new AppException(
    'SHIFT_ALREADY_OPEN',
    HttpStatus.CONFLICT,
    'A shift is already open on this register.',
  );

export const shiftNotOpen = () =>
  new AppException('SHIFT_NOT_OPEN', HttpStatus.CONFLICT, 'This shift is not open.');

/**
 * Cashiers see and close their own shifts; `shifts.manage` covers everyone's at the
 * branches the member may work at.
 */
export const canActOnShift = (principal: AuthPrincipal, openedById: string, branchId: string) =>
  canUseBranch(principal.branchIds, branchId) &&
  (openedById === principal.userId || principal.permissions.includes('shifts.manage'));

@Injectable()
export class ShiftsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly approvals: ApprovalsService,
  ) {}

  /** The open shift on a register, whoever opened it (the till shows who). */
  current(tenantId: string, registerId: string): Promise<Shift | null> {
    return this.prisma.withTenant(tenantId, async (tx) => {
      const row = await tx.shift.findFirst({
        where: { tenantId, registerId, status: 'OPEN' },
        include,
      });
      return row ? (await this.toDtos(tx, tenantId, [row]))[0]! : null;
    });
  }

  list(tenantId: string, query: ListQuery): Promise<ShiftPage> {
    const principal = RequestContext.get()?.principal;
    if (query.branchId) assertBranchAllowed(principal, query.branchId);
    const allowed = query.branchId ? undefined : allowedBranchFilter(principal);
    return this.prisma.withTenant(tenantId, async (tx) => {
      const rows = await tx.shift.findMany({
        where: {
          tenantId,
          ...(query.branchId ? { branchId: query.branchId } : {}),
          ...(allowed ? { branchId: allowed } : {}),
          ...(query.registerId ? { registerId: query.registerId } : {}),
          ...(query.status ? { status: query.status } : {}),
        },
        include,
        orderBy: [{ openedAt: 'desc' }, { id: 'desc' }],
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

  get(tenantId: string, id: string, principal: AuthPrincipal): Promise<Shift> {
    return this.prisma.withTenant(tenantId, async (tx) => {
      const row = await tx.shift.findFirst({ where: { id, tenantId }, include });
      if (!row || !canActOnShift(principal, row.openedById, row.branchId))
        throw AppException.notFound();
      return (await this.toDtos(tx, tenantId, [row]))[0]!;
    });
  }

  async open(tenantId: string, input: OpenInput, principal: AuthPrincipal): Promise<Shift> {
    try {
      return await this.prisma.withTenant(tenantId, async (tx) => {
        const register = await tx.register.findFirst({
          where: { id: input.registerId, tenantId },
          include: { branch: { select: { status: true } } },
        });
        if (!register)
          throw AppException.validation([
            { path: 'registerId', message: 'validation.register.not_found' },
          ]);
        assertBranchAllowed(principal, register.branchId);
        if (register.status !== 'ACTIVE' || register.branch.status !== 'ACTIVE')
          throw AppException.validation([
            { path: 'registerId', message: 'validation.register.archived' },
          ]);
        if (
          await tx.shift.findFirst({
            where: { tenantId, registerId: register.id, status: 'OPEN' },
            select: { id: true },
          })
        )
          throw alreadyOpen();

        const number = await nextDocumentNumber(tx, tenantId, 'shift');
        const row = await tx.shift.create({
          data: {
            tenantId,
            number,
            branchId: register.branchId,
            registerId: register.id,
            openingFloatMinor: BigInt(input.openingFloatMinor),
            openedById: principal.userId,
          },
          include,
        });
        await this.audit.record(tx, {
          tenantId,
          action: 'shift.opened',
          entityType: 'shift',
          entityId: row.id,
          metadata: { number, registerId: register.id, openingFloatMinor: input.openingFloatMinor },
        });
        return (await this.toDtos(tx, tenantId, [row]))[0]!;
      });
    } catch (error) {
      // Two tills opening the same register at once: the partial unique index decides.
      if (isUniqueViolation(error)) throw alreadyOpen();
      throw error;
    }
  }

  close(tenantId: string, id: string, input: CloseInput, principal: AuthPrincipal): Promise<Shift> {
    return this.prisma.withTenant(tenantId, async (tx) => {
      // Waits for in-flight sales on this shift (they hold FOR SHARE) so the count includes them.
      const locked = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM shifts WHERE tenant_id = ${tenantId}::uuid AND id = ${id}::uuid FOR UPDATE`;
      const current = locked.length ? await tx.shift.findFirst({ where: { id, tenantId } }) : null;
      if (!current || !canActOnShift(principal, current.openedById, current.branchId))
        throw AppException.notFound();
      if (current.status !== 'OPEN') throw invalidState('This shift is already closed.');
      if (current.version !== input.version) throw versionConflict();

      const summary = (await this.summaries(tx, tenantId, [current]))[0]!;
      const counted = input.countedCashMinor;
      await tx.shift.update({
        where: { id },
        data: {
          status: 'CLOSED',
          closedAt: new Date(),
          closedById: principal.userId,
          expectedCashMinor: BigInt(summary.expectedCashMinor),
          countedCashMinor: BigInt(counted),
          closingNotes: input.notes ?? null,
          version: { increment: 1 },
        },
      });
      await this.audit.record(tx, {
        tenantId,
        action: 'shift.closed',
        entityType: 'shift',
        entityId: id,
        metadata: {
          number: current.number,
          expectedCashMinor: summary.expectedCashMinor,
          countedCashMinor: counted,
          differenceMinor: counted - summary.expectedCashMinor,
          saleCount: summary.saleCount,
        },
      });
      const row = await tx.shift.findFirstOrThrow({ where: { id, tenantId }, include });
      return (await this.toDtos(tx, tenantId, [row]))[0]!;
    });
  }

  /**
   * Pay-in or pay-out on the caller's open shift. Pay-outs need a manager's
   * approval and may not take more cash than the drawer should hold.
   * Idempotent on the client-generated id.
   */
  async cashMovement(
    tenantId: string,
    shiftId: string,
    input: CashMovementInput,
    principal: AuthPrincipal,
    verifiedApproverId: string | null,
  ): Promise<Shift> {
    return this.prisma.withTenant(tenantId, async (tx) => {
      const locked = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM shifts WHERE tenant_id = ${tenantId}::uuid AND id = ${shiftId}::uuid FOR UPDATE`;
      const shift = locked.length
        ? await tx.shift.findFirst({ where: { id: shiftId, tenantId } })
        : null;
      if (!shift || !canActOnShift(principal, shift.openedById, shift.branchId))
        throw AppException.notFound();
      const existing = await tx.cashMovement.findFirst({ where: { id: input.id, tenantId } });
      if (!existing) {
        if (shift.status !== 'OPEN') throw shiftNotOpen();
        const approvedById = this.approvals.resolve(
          principal,
          input.type === 'PAY_OUT',
          verifiedApproverId,
          'PAY_OUT',
        );
        if (input.type === 'PAY_OUT') {
          const summary = (await this.summaries(tx, tenantId, [shift]))[0]!;
          if (input.amountMinor > summary.expectedCashMinor)
            throw AppException.validation([
              { path: 'amountMinor', message: 'validation.cash.exceeds_drawer' },
            ]);
        }
        await tx.cashMovement.create({
          data: {
            id: input.id,
            tenantId,
            shiftId,
            type: input.type,
            amountMinor: BigInt(input.amountMinor),
            reason: input.reason,
            createdById: principal.userId,
            approvedById,
          },
        });
        await this.audit.record(tx, {
          tenantId,
          action: input.type === 'PAY_IN' ? 'cash.paid_in' : 'cash.paid_out',
          entityType: 'shift',
          entityId: shiftId,
          metadata: { amountMinor: input.amountMinor, reason: input.reason, approvedById },
        });
      }
      const row = await tx.shift.findFirstOrThrow({ where: { id: shiftId, tenantId }, include });
      return (await this.toDtos(tx, tenantId, [row]))[0]!;
    });
  }

  /** Totals per shift from its sales, returns and cash movements, computed in the database. */
  async summaries(
    tx: Tx,
    tenantId: string,
    shifts: Array<{ id: string; openingFloatMinor: bigint }>,
  ): Promise<ShiftSummary[]> {
    const ids = shifts.map((s) => s.id);
    if (ids.length === 0) return [];
    const sales = await tx.sale.groupBy({
      by: ['shiftId'],
      where: { tenantId, shiftId: { in: ids } },
      _count: { _all: true },
      _sum: { totalMinor: true, discountMinor: true, taxMinor: true, changeMinor: true },
    });
    const payments = await tx.$queryRaw<
      Array<{ shift_id: string; method: PaymentMethod; amount: bigint }>
    >`
      SELECT s.shift_id, p.method, SUM(p.amount_minor)::bigint AS amount
      FROM sale_payments p
      JOIN sales s ON s.tenant_id = p.tenant_id AND s.id = p.sale_id
      WHERE s.tenant_id = ${tenantId}::uuid AND s.shift_id = ANY(${ids}::uuid[])
      GROUP BY s.shift_id, p.method`;
    const returns = await tx.saleReturn.groupBy({
      by: ['shiftId'],
      where: { tenantId, shiftId: { in: ids } },
      _count: { _all: true },
      _sum: { refundMinor: true },
    });
    const refunds = await tx.$queryRaw<
      Array<{ shift_id: string; method: PaymentMethod; amount: bigint }>
    >`
      SELECT r.shift_id, f.method, SUM(f.amount_minor)::bigint AS amount
      FROM sale_return_refunds f
      JOIN sale_returns r ON r.tenant_id = f.tenant_id AND r.id = f.return_id
      WHERE r.tenant_id = ${tenantId}::uuid AND r.shift_id = ANY(${ids}::uuid[])
      GROUP BY r.shift_id, f.method`;
    const collections = await tx.customerPayment.groupBy({
      by: ['shiftId', 'method'],
      where: { tenantId, shiftId: { in: ids } },
      _sum: { amountMinor: true },
    });
    const movements = await tx.cashMovement.groupBy({
      by: ['shiftId', 'type'],
      where: { tenantId, shiftId: { in: ids } },
      _sum: { amountMinor: true },
    });
    return shifts.map((shift) => {
      const totals = sales.find((row) => row.shiftId === shift.id);
      const byMethod = new Map(
        payments.filter((p) => p.shift_id === shift.id).map((p) => [p.method, Number(p.amount)]),
      );
      const cash = byMethod.get('CASH') ?? 0;
      const change = Number(totals?._sum.changeMinor ?? 0n);
      const returned = returns.find((row) => row.shiftId === shift.id);
      const refundedByMethod = new Map(
        refunds.filter((r) => r.shift_id === shift.id).map((r) => [r.method, Number(r.amount)]),
      );
      const moved = (type: 'PAY_IN' | 'PAY_OUT') =>
        Number(
          movements.find((m) => m.shiftId === shift.id && m.type === type)?._sum.amountMinor ?? 0n,
        );
      const cashRefunded = refundedByMethod.get('CASH') ?? 0;
      const collected = collections.filter((c) => c.shiftId === shift.id);
      const collectionsMinor = collected.reduce(
        (sum, c) => sum + Number(c._sum.amountMinor ?? 0n),
        0,
      );
      const collectionsCashMinor = Number(
        collected.find((c) => c.method === 'CASH')?._sum.amountMinor ?? 0n,
      );
      return {
        saleCount: totals?._count._all ?? 0,
        salesTotalMinor: Number(totals?._sum.totalMinor ?? 0n),
        discountMinor: Number(totals?._sum.discountMinor ?? 0n),
        taxMinor: Number(totals?._sum.taxMinor ?? 0n),
        payments: PAYMENT_METHODS.filter((m) => byMethod.has(m)).map((method) => ({
          method,
          amountMinor: byMethod.get(method)!,
        })),
        cashReceivedMinor: cash,
        changeGivenMinor: change,
        returnCount: returned?._count._all ?? 0,
        refundsTotalMinor: Number(returned?._sum.refundMinor ?? 0n),
        refunds: PAYMENT_METHODS.filter((m) => refundedByMethod.has(m)).map((method) => ({
          method,
          amountMinor: refundedByMethod.get(method)!,
        })),
        cashRefundedMinor: cashRefunded,
        payInMinor: moved('PAY_IN'),
        payOutMinor: moved('PAY_OUT'),
        collectionsMinor,
        collectionsCashMinor,
        expectedCashMinor: expectedDrawerCash({
          openingFloatMinor: Number(shift.openingFloatMinor),
          cashReceivedMinor: cash,
          changeGivenMinor: change,
          cashRefundedMinor: cashRefunded,
          payInMinor: moved('PAY_IN'),
          payOutMinor: moved('PAY_OUT'),
          collectionsCashMinor,
        }),
      };
    });
  }

  private async toDtos(tx: Tx, tenantId: string, rows: ShiftRow[]): Promise<Shift[]> {
    const summaries = await this.summaries(tx, tenantId, rows);
    return rows.map((row, index) => {
      const expected = row.expectedCashMinor === null ? null : Number(row.expectedCashMinor);
      const counted = row.countedCashMinor === null ? null : Number(row.countedCashMinor);
      return {
        id: row.id,
        number: row.number,
        status: row.status,
        branchId: row.branchId,
        branchName: row.branch.name,
        registerId: row.registerId,
        registerName: row.register.name,
        openingFloatMinor: Number(row.openingFloatMinor),
        openedAt: row.openedAt.toISOString(),
        openedById: row.openedById,
        openedByName: row.openedBy.fullName,
        closedAt: row.closedAt?.toISOString() ?? null,
        closedByName: row.closedBy?.fullName ?? null,
        expectedCashMinor: expected,
        countedCashMinor: counted,
        differenceMinor: expected !== null && counted !== null ? counted - expected : null,
        closingNotes: row.closingNotes,
        version: row.version,
        summary: summaries[index]!,
        cashMovements: row.cashMovements.map((m) => ({
          id: m.id,
          type: m.type,
          amountMinor: Number(m.amountMinor),
          reason: m.reason,
          createdByName: m.createdBy?.fullName ?? null,
          approvedByName: m.approvedBy?.fullName ?? null,
          createdAt: m.createdAt.toISOString(),
        })),
      };
    });
  }
}
