import { randomUUID } from 'node:crypto';
import {
  addMember,
  bearer,
  createTestContext,
  login,
  onboardedTenant,
  resetDatabase,
  STRONG_PASSWORD,
  type TestContext,
} from './helpers';

type Auth = ReturnType<typeof bearer>;

describe('Returns, voids, approvals and cash movements (integration)', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await createTestContext();
  });
  beforeEach(async () => {
    await resetDatabase(ctx.owner);
  });
  afterAll(async () => {
    await ctx.close();
  });

  /**
   * A shop with an owner, a manager (approval PIN 2468) and a cashier whose shift
   * is open. One product at 333.33 incl. 18 % VAT with 10 in stock, so pro-rating
   * has remainders to handle.
   */
  async function shop(type: 'GENERAL_RETAIL' | 'COSMETICS' = 'GENERAL_RETAIL') {
    const session = await onboardedTenant(ctx, type);
    const owner = bearer(session.accessToken);
    const tenantId = session.tenant.id as string;
    const branch = (await ctx.http.get('/api/v1/branches').set(owner).expect(200)).body.items[0];
    await ctx.http
      .post('/api/v1/tax-rates')
      .set(owner)
      .send({ name: 'VAT', rateBp: 1800, isDefault: true })
      .expect(201);
    const product = (
      await ctx.http
        .post('/api/v1/products')
        .set(owner)
        .send({ name: 'Rose Soap', unit: 'piece', variants: [{ sku: 'ROSE', priceMinor: 33_333 }] })
        .expect(201)
    ).body;
    const variantId = product.variants[0].id as string;
    await ctx.http
      .post('/api/v1/goods-receipts')
      .set(owner)
      .send({
        id: randomUUID(),
        branchId: branch.id,
        lines: [
          {
            variantId,
            quantity: '10',
            unitCostMinor: 10_000,
            ...(type === 'COSMETICS' ? { batchNumber: 'LOT-1', expiryDate: '2027-01-31' } : {}),
          },
        ],
      })
      .expect(201);

    const managerUser = await addMember(ctx, tenantId, 'MANAGER');
    const manager = bearer((await login(ctx, managerUser.email)).accessToken);
    await ctx.http
      .put('/api/v1/me/approval-pin')
      .set(manager)
      .send({ currentPassword: STRONG_PASSWORD, pin: '2468' })
      .expect(204);
    const cashierUser = await addMember(ctx, tenantId, 'CASHIER');
    const cashier = bearer((await login(ctx, cashierUser.email)).accessToken);
    const shift = (
      await ctx.http
        .post('/api/v1/shifts')
        .set(cashier)
        .send({ registerId: branch.registers[0].id, openingFloatMinor: 100_000 })
        .expect(201)
    ).body;
    return {
      tenantId,
      owner,
      manager,
      managerId: managerUser.userId,
      cashier,
      shift,
      variantId,
      branchId: branch.id as string,
      approval: { approverId: managerUser.userId, pin: '2468' },
    };
  }
  type Shop = Awaited<ReturnType<typeof shop>>;

  async function sell(s: Shop, quantity: string, payments?: unknown[], auth: Auth = s.cashier) {
    const total = Math.round(33_333 * Number(quantity));
    return (
      await ctx.http
        .post('/api/v1/sales')
        .set(auth)
        .send({
          id: randomUUID(),
          shiftId: s.shift.id,
          lines: [{ variantId: s.variantId, quantity }],
          payments: payments ?? [{ method: 'CASH', amountMinor: total }],
          expectedTotalMinor: total,
        })
        .expect(201)
    ).body;
  }

  function returnItems(
    s: Shop,
    sale: { id: string; lines: Array<{ id: string }> },
    body: Record<string, unknown>,
    auth: Auth = s.cashier,
  ) {
    return ctx.http
      .post(`/api/v1/sales/${sale.id}/returns`)
      .set(auth)
      .send({ id: randomUUID(), shiftId: s.shift.id, reason: 'Wrong shade', ...body });
  }

  const stockQty = async (s: Shop) =>
    (
      await ctx.http
        .get('/api/v1/stock')
        .query({ branchId: s.branchId, q: 'ROSE' })
        .set(s.owner)
        .expect(200)
    ).body.items[0].quantity as string;

  describe('approvals', () => {
    it('lists approvers with a PIN and requires the password to set one', async () => {
      const s = await shop();
      const list = await ctx.http.get('/api/v1/approvers').set(s.cashier).expect(200);
      expect(list.body.items).toEqual([
        expect.objectContaining({ userId: s.managerId, role: 'MANAGER' }),
      ]);
      const wrong = await ctx.http
        .put('/api/v1/me/approval-pin')
        .set(s.manager)
        .send({ currentPassword: 'not-my-password', pin: '1357' })
        .expect(400);
      expect(wrong.body.error.issues).toEqual([
        { path: 'currentPassword', message: 'validation.password.incorrect' },
      ]);
      // Cashiers cannot become approvers.
      await ctx.http
        .put('/api/v1/me/approval-pin')
        .set(s.cashier)
        .send({ currentPassword: STRONG_PASSWORD, pin: '1357' })
        .expect(403);
      // The PIN hash is never exposed.
      const row = await ctx.owner.membership.findFirstOrThrow({ where: { userId: s.managerId } });
      expect(row.approvalPinHash).not.toContain('2468');
    });

    it('locks an approver after five wrong PINs, even if the sixth is right', async () => {
      const s = await shop();
      const sale = await sell(s, '1');
      const body = {
        lines: [{ saleLineId: sale.lines[0].id, quantity: '1' }],
        refunds: [{ method: 'CASH', amountMinor: 33_333 }],
      };
      const required = await returnItems(s, sale, body).expect(403);
      expect(required.body.error.code).toBe('APPROVAL_REQUIRED');
      for (let i = 0; i < 5; i += 1) {
        const bad = await returnItems(s, sale, {
          ...body,
          approval: { ...s.approval, pin: '0000' },
        }).expect(403);
        expect(bad.body.error.code).toBe('APPROVAL_INVALID');
      }
      const locked = await returnItems(s, sale, { ...body, approval: s.approval }).expect(403);
      expect(locked.body.error.code).toBe('APPROVAL_LOCKED');
      const audit = await ctx.owner.auditLog.count({
        where: { tenantId: s.tenantId, action: 'approval.pin_locked' },
      });
      expect(audit).toBe(1);
    });
  });

  describe('returns', () => {
    it('pro-rates partial returns exactly, restocks and refunds by the original method', async () => {
      const s = await shop();
      const sale = await sell(s, '3');
      const line = sale.lines[0];
      expect(line.totalMinor).toBe(99_999);

      const refunds: number[] = [];
      for (let i = 0; i < 3; i += 1) {
        const before = (
          await ctx.http.get(`/api/v1/sales/by-number/${sale.number}`).set(s.cashier).expect(200)
        ).body;
        const expected =
          i < 2
            ? Math.round((99_999 * (i + 1)) / 3) - before.refundedMinor
            : 99_999 - before.refundedMinor;
        const res = await returnItems(s, sale, {
          lines: [{ saleLineId: line.id, quantity: '1' }],
          refunds: [{ method: 'CASH', amountMinor: expected }],
          approval: s.approval,
        }).expect(201);
        expect(res.body).toMatchObject({
          kind: 'RETURN',
          number: `RET-00000${i + 1}`,
          approvedByName: 'Test MANAGER',
        });
        refunds.push(res.body.refundMinor);
      }
      expect(refunds.reduce((a, b) => a + b, 0)).toBe(99_999);
      const after = (
        await ctx.http.get(`/api/v1/sales/by-number/${sale.number}`).set(s.cashier).expect(200)
      ).body;
      expect(after).toMatchObject({ returnStatus: 'FULL', refundedMinor: 99_999, refundable: [] });
      expect(after.lines[0]).toMatchObject({
        returnedQuantity: '3',
        refundedTaxMinor: line.taxMinor,
      });
      expect(await stockQty(s)).toBe('10');

      const more = await returnItems(s, sale, {
        lines: [{ saleLineId: line.id, quantity: '1' }],
        refunds: [],
        approval: s.approval,
      }).expect(400);
      expect(more.body.error.issues).toEqual([
        { path: 'lines.0.quantity', message: 'validation.return.exceeds_remaining' },
      ]);
    });

    it('refunds only by the methods and amounts originally paid', async () => {
      const s = await shop();
      const sale = await sell(s, '2', [
        { method: 'CARD', amountMinor: 50_000, reference: 'APP-1' },
        { method: 'CASH', amountMinor: 20_000 },
      ]); // total 66,666: cash 20,000 − change 3,334 = 16,666 refundable in cash
      expect(sale.refundable).toEqual([
        { method: 'CARD', amountMinor: 50_000 },
        { method: 'CASH', amountMinor: 16_666 },
      ]);
      const lines = [{ saleLineId: sale.lines[0].id, quantity: '2' }];
      const transfer = await returnItems(s, sale, {
        lines,
        refunds: [{ method: 'BANK_TRANSFER', amountMinor: 66_666 }],
        approval: s.approval,
      }).expect(400);
      expect(transfer.body.error.issues[0].message).toBe('validation.refund.method_not_refundable');
      const tooMuchCash = await returnItems(s, sale, {
        lines,
        refunds: [{ method: 'CASH', amountMinor: 66_666 }],
        approval: s.approval,
      }).expect(400);
      expect(tooMuchCash.body.error.issues[0].message).toBe('validation.refund.exceeds_method');
      const short = await returnItems(s, sale, {
        lines,
        refunds: [{ method: 'CARD', amountMinor: 50_000 }],
        approval: s.approval,
      }).expect(400);
      expect(short.body.error.issues[0].message).toBe('validation.refund.mismatch');
      await returnItems(s, sale, {
        lines,
        refunds: [
          { method: 'CARD', amountMinor: 50_000, reference: 'RF-9' },
          { method: 'CASH', amountMinor: 16_666 },
        ],
        approval: s.approval,
      }).expect(201);
    });

    it('does not restock damaged items and needs no approval when the business allows it', async () => {
      const s = await shop();
      const settings = (await ctx.http.get('/api/v1/settings').set(s.owner).expect(200)).body;
      await ctx.http
        .patch('/api/v1/settings')
        .set(s.owner)
        .send({ version: settings.version, checkout: { refundsRequireApproval: false } })
        .expect(200);
      const sale = await sell(s, '2');
      await returnItems(s, sale, {
        reason: 'Broken seal',
        lines: [{ saleLineId: sale.lines[0].id, quantity: '1', restock: false }],
        refunds: [{ method: 'CASH', amountMinor: 33_333 }],
      }).expect(201);
      expect(await stockQty(s)).toBe('8');
    });

    it('is idempotent and lets only one of two simultaneous returns take the last unit', async () => {
      const s = await shop();
      const sale = await sell(s, '1');
      const body = {
        id: randomUUID(),
        shiftId: s.shift.id,
        reason: 'Changed mind',
        lines: [{ saleLineId: sale.lines[0].id, quantity: '1' }],
        refunds: [{ method: 'CASH', amountMinor: 33_333 }],
        approval: s.approval,
      };
      const post = (b: object) =>
        ctx.http.post(`/api/v1/sales/${sale.id}/returns`).set(s.cashier).send(b);
      const [a, b] = await Promise.all([post(body), post({ ...body, id: randomUUID() })]);
      expect([a.status, b.status].sort()).toEqual([201, 400]);
      const winner = a.status === 201 ? body : null;
      if (winner) {
        const retry = await post(body).expect(200);
        expect(retry.body.number).toBe(a.body.number);
      }
      expect(await stockQty(s)).toBe('10');
    });

    it('returns stock to the batch it was sold from', async () => {
      const s = await shop('COSMETICS');
      const sale = await sell(s, '2');
      await returnItems(s, sale, {
        lines: [{ saleLineId: sale.lines[0].id, quantity: '2' }],
        refunds: [{ method: 'CASH', amountMinor: 66_666 }],
        approval: s.approval,
      }).expect(201);
      const levels = await ctx.owner.stockLevel.findMany({
        where: { tenantId: s.tenantId },
        include: { batch: true },
      });
      expect(levels.map((l) => [l.batch?.batchNumber ?? null, l.quantity.toString()])).toEqual([
        ['LOT-1', '10'],
      ]);
    });

    it('lets cashiers find any sale by its number to return it', async () => {
      const s = await shop();
      const sale = await sell(s, '1', undefined, s.owner); // owner's sale on the cashier's register shift
      const found = await ctx.http
        .get(`/api/v1/sales/by-number/${sale.number.toLowerCase()}`)
        .set(s.cashier)
        .expect(200);
      expect(found.body.id).toBe(sale.id);
      await ctx.http.get('/api/v1/sales/by-number/INV-999999').set(s.cashier).expect(404);
    });
  });

  describe('voids', () => {
    it('voids a whole sale in its open shift with approval, exactly once', async () => {
      const s = await shop();
      const sale = await sell(s, '2', [
        { method: 'CARD', amountMinor: 40_000 },
        { method: 'CASH', amountMinor: 30_000 },
      ]);
      const voidIt = (body: object) =>
        ctx.http
          .post(`/api/v1/sales/${sale.id}/void`)
          .set(s.cashier)
          .send({ id: randomUUID(), reason: 'Rang up twice', ...body });
      expect((await voidIt({}).expect(403)).body.error.code).toBe('APPROVAL_REQUIRED');
      const voided = await voidIt({ approval: s.approval }).expect(201);
      expect(voided.body).toMatchObject({ kind: 'VOID', refundMinor: 66_666 });
      expect(voided.body.refunds).toEqual([
        { method: 'CARD', amountMinor: 40_000, reference: null },
        { method: 'CASH', amountMinor: 26_666, reference: null },
      ]);
      expect(await stockQty(s)).toBe('10');
      const sale2 = (await ctx.http.get(`/api/v1/sales/${sale.id}`).set(s.cashier).expect(200))
        .body;
      expect(sale2).toMatchObject({ voided: true, returnStatus: 'FULL' });
      expect((await voidIt({ approval: s.approval }).expect(409)).body.error.code).toBe(
        'INVALID_STATE',
      );
      const after = await returnItems(s, sale, {
        lines: [{ saleLineId: sale.lines[0].id, quantity: '1' }],
        refunds: [],
        approval: s.approval,
      }).expect(409);
      expect(after.body.error.code).toBe('INVALID_STATE');
    });

    it('refuses to void after a partial return or once the shift is closed', async () => {
      const s = await shop();
      const partly = await sell(s, '2');
      await returnItems(s, partly, {
        lines: [{ saleLineId: partly.lines[0].id, quantity: '1' }],
        refunds: [{ method: 'CASH', amountMinor: 33_333 }],
        approval: s.approval,
      }).expect(201);
      await ctx.http
        .post(`/api/v1/sales/${partly.id}/void`)
        .set(s.owner)
        .send({ id: randomUUID(), reason: 'x' })
        .expect(409);

      const later = await sell(s, '1');
      const shift = (await ctx.http.get(`/api/v1/shifts/${s.shift.id}`).set(s.cashier).expect(200))
        .body;
      await ctx.http
        .post(`/api/v1/shifts/${s.shift.id}/close`)
        .set(s.cashier)
        .send({ version: shift.version, countedCashMinor: 0 })
        .expect(200);
      const res = await ctx.http
        .post(`/api/v1/sales/${later.id}/void`)
        .set(s.owner)
        .send({ id: randomUUID(), reason: 'x' })
        .expect(409);
      expect(res.body.error.code).toBe('INVALID_STATE');
    });
  });

  describe('discount approval', () => {
    it('needs a manager for discounts above the limit', async () => {
      const s = await shop();
      const settings = (await ctx.http.get('/api/v1/settings').set(s.owner).expect(200)).body;
      await ctx.http
        .patch('/api/v1/settings')
        .set(s.owner)
        .send({ version: settings.version, checkout: { discountApprovalBp: 1000 } })
        .expect(200);
      const body = (approval?: object) => ({
        id: randomUUID(),
        shiftId: s.shift.id,
        lines: [{ variantId: s.variantId, quantity: '1' }],
        discount: { kind: 'PERCENT', value: 2000 },
        payments: [{ method: 'CASH', amountMinor: 26_666 }],
        expectedTotalMinor: 26_666,
        ...(approval ? { approval } : {}),
      });
      expect(
        (await ctx.http.post('/api/v1/sales').set(s.cashier).send(body()).expect(403)).body.error
          .code,
      ).toBe('APPROVAL_REQUIRED');
      const ok = await ctx.http
        .post('/api/v1/sales')
        .set(s.cashier)
        .send(body(s.approval))
        .expect(201);
      expect(ok.body.approvedByName).toBe('Test MANAGER');
      // 10 % or less needs nobody.
      await ctx.http
        .post('/api/v1/sales')
        .set(s.cashier)
        .send({
          ...body(),
          discount: { kind: 'PERCENT', value: 1000 },
          payments: [{ method: 'CASH', amountMinor: 30_000 }],
          expectedTotalMinor: 30_000,
        })
        .expect(201);
    });
  });

  describe('cash movements and reconciliation', () => {
    it('records pay-ins and approved pay-outs and includes refunds in expected cash', async () => {
      const s = await shop();
      const sale = await sell(s, '1', [{ method: 'CASH', amountMinor: 40_000 }]); // change 6,667
      await returnItems(s, sale, {
        lines: [{ saleLineId: sale.lines[0].id, quantity: '1' }],
        refunds: [{ method: 'CASH', amountMinor: 33_333 }],
        approval: s.approval,
      }).expect(201);
      const move = (body: object) =>
        ctx.http
          .post(`/api/v1/shifts/${s.shift.id}/cash-movements`)
          .set(s.cashier)
          .send({ id: randomUUID(), reason: 'Float top-up', ...body });
      await move({ type: 'PAY_IN', amountMinor: 50_000 }).expect(200);
      expect(
        (await move({ type: 'PAY_OUT', amountMinor: 20_000, reason: 'Courier' }).expect(403)).body
          .error.code,
      ).toBe('APPROVAL_REQUIRED');
      const tooMuch = await move({
        type: 'PAY_OUT',
        amountMinor: 9_999_999,
        reason: 'Bank deposit',
        approval: s.approval,
      }).expect(400);
      expect(tooMuch.body.error.issues[0].message).toBe('validation.cash.exceeds_drawer');
      const shift = (
        await move({
          type: 'PAY_OUT',
          amountMinor: 20_000,
          reason: 'Courier',
          approval: s.approval,
        }).expect(200)
      ).body;
      // 1,000.00 float + 400.00 cash − 66.67 change − 333.33 refund + 500.00 in − 200.00 out
      expect(shift.summary).toMatchObject({
        returnCount: 1,
        refundsTotalMinor: 33_333,
        cashRefundedMinor: 33_333,
        payInMinor: 50_000,
        payOutMinor: 20_000,
        expectedCashMinor: 130_000,
      });
      expect(shift.cashMovements).toEqual([
        expect.objectContaining({ type: 'PAY_IN', amountMinor: 50_000, approvedByName: null }),
        expect.objectContaining({
          type: 'PAY_OUT',
          amountMinor: 20_000,
          approvedByName: 'Test MANAGER',
        }),
      ]);
      const closed = await ctx.http
        .post(`/api/v1/shifts/${s.shift.id}/close`)
        .set(s.cashier)
        .send({ version: shift.version, countedCashMinor: 130_000 })
        .expect(200);
      expect(closed.body).toMatchObject({ expectedCashMinor: 130_000, differenceMinor: 0 });
    });
  });

  describe('tenant isolation', () => {
    it('hides returns and sales from other tenants and keeps returns append-only', async () => {
      const a = await shop();
      const sale = await sell(a, '1');
      const ret = (
        await returnItems(a, sale, {
          lines: [{ saleLineId: sale.lines[0].id, quantity: '1' }],
          refunds: [{ method: 'CASH', amountMinor: 33_333 }],
          approval: a.approval,
        }).expect(201)
      ).body;
      const b = await shop();
      await ctx.http.get(`/api/v1/returns/${ret.id}`).set(b.owner).expect(404);
      await ctx.http.get(`/api/v1/sales/by-number/${sale.number}`).set(b.owner).expect(404);
      await ctx.http
        .post(`/api/v1/sales/${sale.id}/returns`)
        .set(b.owner)
        .send({
          id: randomUUID(),
          shiftId: b.shift.id,
          reason: 'x',
          lines: [{ saleLineId: sale.lines[0].id, quantity: '1' }],
          refunds: [],
        })
        .expect(404);
      // Another tenant's manager cannot approve.
      const foreign = await returnItems(a, await sell(a, '1'), {
        lines: [],
        refunds: [],
        approval: b.approval,
      });
      expect(foreign.status).toBe(400); // empty lines fail validation before approval
      const crossApproval = await returnItems(a, await sell(a, '1'), {
        refunds: [{ method: 'CASH', amountMinor: 33_333 }],
        lines: [],
        approval: b.approval,
      });
      expect(crossApproval.status).toBe(400);
      const s2 = await sell(a, '1');
      const cross = await returnItems(a, s2, {
        lines: [{ saleLineId: s2.lines[0].id, quantity: '1' }],
        refunds: [{ method: 'CASH', amountMinor: 33_333 }],
        approval: b.approval,
      }).expect(403);
      expect(cross.body.error.code).toBe('APPROVAL_INVALID');

      await expect(
        ctx.prisma.withTenant(a.tenantId, (tx) =>
          tx.saleReturn.updateMany({ where: { id: ret.id }, data: { refundMinor: 1n } }),
        ),
      ).rejects.toThrow(/permission denied/);
      await expect(
        ctx.prisma.withTenant(a.tenantId, (tx) =>
          tx.cashMovement.deleteMany({ where: { shiftId: a.shift.id } }),
        ),
      ).rejects.toThrow(/permission denied/);
    });
  });
});
