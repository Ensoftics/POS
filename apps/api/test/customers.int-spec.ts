import { randomUUID } from 'node:crypto';
import {
  addMember,
  bearer,
  createTestContext,
  login,
  onboardedTenant,
  resetDatabase,
  type TestContext,
} from './helpers';

describe('Customers, accounts and collections (integration)', () => {
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

  /** A shop with one product at 600.00 (10 in stock), a cashier with an open shift. */
  async function shop() {
    const session = await onboardedTenant(ctx, 'GENERAL_RETAIL');
    const owner = bearer(session.accessToken);
    const tenantId = session.tenant.id as string;
    const branch = (await ctx.http.get('/api/v1/branches').set(owner).expect(200)).body.items[0];
    const product = (
      await ctx.http
        .post('/api/v1/products')
        .set(owner)
        .send({ name: 'Rice 5kg', unit: 'piece', variants: [{ sku: 'RICE5', priceMinor: 60_000 }] })
        .expect(201)
    ).body;
    const variantId = product.variants[0].id as string;
    await ctx.http
      .post('/api/v1/goods-receipts')
      .set(owner)
      .send({
        id: randomUUID(),
        branchId: branch.id,
        lines: [{ variantId, quantity: '10', unitCostMinor: 1 }],
      })
      .expect(201);
    const cashier = bearer(
      (await login(ctx, (await addMember(ctx, tenantId, 'CASHIER')).email)).accessToken,
    );
    const shift = (
      await ctx.http
        .post('/api/v1/shifts')
        .set(cashier)
        .send({ registerId: branch.registers[0].id, openingFloatMinor: 0 })
        .expect(201)
    ).body;
    return { tenantId, owner, cashier, shift, variantId, branchId: branch.id as string };
  }
  type Shop = Awaited<ReturnType<typeof shop>>;

  async function customer(s: Shop, body: Record<string, unknown> = {}) {
    return (
      await ctx.http
        .post('/api/v1/customers')
        .set(s.owner)
        .send({ name: 'Nimali Perera', phone: '077 123 4567', creditLimitMinor: 100_000, ...body })
        .expect(201)
    ).body;
  }

  function sellOnAccount(
    s: Shop,
    customerId: string | undefined,
    quantity = 1,
    extra: Record<string, unknown> = {},
  ) {
    const total = 60_000 * quantity;
    return ctx.http
      .post('/api/v1/sales')
      .set(s.cashier)
      .send({
        id: randomUUID(),
        shiftId: s.shift.id,
        ...(customerId ? { customerId } : {}),
        lines: [{ variantId: s.variantId, quantity: String(quantity) }],
        payments: [{ method: 'ACCOUNT', amountMinor: total }],
        expectedTotalMinor: total,
        ...extra,
      });
  }

  const customerOf = async (s: Shop, id: string) =>
    (await ctx.http.get(`/api/v1/customers/${id}`).set(s.owner).expect(200)).body;

  describe('profiles', () => {
    it('normalises phones, finds customers by any format and refuses duplicates', async () => {
      const s = await shop();
      const c = await customer(s, { marketingConsent: true, email: 'NIMALI@example.com' });
      expect(c).toMatchObject({
        number: 'CUS-000001',
        phone: '+94771234567',
        email: 'nimali@example.com',
        marketingConsent: true,
        balanceMinor: 0,
        availableCreditMinor: 100_000,
      });
      const dup = await ctx.http
        .post('/api/v1/customers')
        .set(s.cashier)
        .send({ name: 'Other', phone: '+94 77 123 4567' })
        .expect(409);
      expect(dup.body.error.code).toBe('DUPLICATE_PHONE');
      const bad = await ctx.http
        .post('/api/v1/customers')
        .set(s.cashier)
        .send({ name: 'X', phone: '12' })
        .expect(400);
      expect(bad.body.error.issues).toEqual([
        { path: 'phone', message: 'validation.phone.invalid' },
      ]);
      for (const q of ['0771234567', 'nimali', 'CUS-000001'])
        expect(
          (
            await ctx.http.get('/api/v1/customers').query({ q }).set(s.cashier).expect(200)
          ).body.items.map((x: { id: string }) => x.id),
        ).toEqual([c.id]);
      // Personal details stay out of the audit log.
      const audit = await ctx.owner.auditLog.findMany({
        where: { tenantId: s.tenantId, entityType: 'customer' },
      });
      expect(JSON.stringify(audit)).not.toContain('77123');
      expect(JSON.stringify(audit)).not.toContain('nimali@');
    });

    it('lets cashiers add customers but not give credit', async () => {
      const s = await shop();
      await ctx.http
        .post('/api/v1/customers')
        .set(s.cashier)
        .send({ name: 'Walk-in Kumar', creditLimitMinor: 5_000 })
        .expect(403);
      const c = (
        await ctx.http
          .post('/api/v1/customers')
          .set(s.cashier)
          .send({ name: 'Walk-in Kumar' })
          .expect(201)
      ).body;
      await ctx.http
        .patch(`/api/v1/customers/${c.id}`)
        .set(s.cashier)
        .send({ version: c.version, creditLimitMinor: 5_000 })
        .expect(403);
      const renamed = await ctx.http
        .patch(`/api/v1/customers/${c.id}`)
        .set(s.cashier)
        .send({ version: c.version, name: 'Kumar' })
        .expect(200);
      expect(renamed.body.name).toBe('Kumar');
      await ctx.http
        .patch(`/api/v1/customers/${c.id}`)
        .set(s.owner)
        .send({ version: renamed.body.version, creditLimitMinor: 5_000 })
        .expect(200);
    });
  });

  describe('selling on account', () => {
    it('charges the account within the credit limit, even with simultaneous sales', async () => {
      const s = await shop();
      const c = await customer(s);
      expect((await sellOnAccount(s, undefined).expect(400)).body.error.issues).toEqual([
        { path: 'payments', message: 'validation.payment.account_needs_customer' },
      ]);
      const results = await Promise.all([sellOnAccount(s, c.id), sellOnAccount(s, c.id)]);
      expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
      expect(results.find((r) => r.status === 409)!.body.error.code).toBe('CREDIT_LIMIT_EXCEEDED');
      const sale = results.find((r) => r.status === 201)!.body;
      expect(sale).toMatchObject({ customerId: c.id, customerName: 'Nimali Perera' });
      expect(await customerOf(s, c.id)).toMatchObject({
        balanceMinor: 60_000,
        availableCreditMinor: 40_000,
      });
      // The refused sale left no trace in stock.
      const stock = (
        await ctx.http.get('/api/v1/stock').query({ branchId: s.branchId }).set(s.owner).expect(200)
      ).body.items[0];
      expect(stock.quantity).toBe('9');

      // No credit at all for customers without a limit.
      const noCredit = await customer(s, { name: 'Cash Only', phone: null, creditLimitMinor: 0 });
      expect((await sellOnAccount(s, noCredit.id).expect(409)).body.error.code).toBe(
        'CREDIT_LIMIT_EXCEEDED',
      );
    });

    it('refunds returns and voids of account sales back to the account', async () => {
      const s = await shop();
      const c = await customer(s, { creditLimitMinor: 500_000 });
      const sale = (await sellOnAccount(s, c.id, 3).expect(201)).body;
      expect(sale.refundable).toEqual([{ method: 'ACCOUNT', amountMinor: 180_000 }]);
      await ctx.http
        .post(`/api/v1/sales/${sale.id}/returns`)
        .set(s.owner)
        .send({
          id: randomUUID(),
          shiftId: s.shift.id,
          reason: 'Damaged bag',
          lines: [{ saleLineId: sale.lines[0].id, quantity: '1' }],
          refunds: [{ method: 'CASH', amountMinor: 60_000 }],
        })
        .expect(400);
      await ctx.http
        .post(`/api/v1/sales/${sale.id}/returns`)
        .set(s.cashier)
        .send({
          id: randomUUID(),
          shiftId: s.shift.id,
          reason: 'Damaged bag',
          lines: [{ saleLineId: sale.lines[0].id, quantity: '1' }],
          refunds: [{ method: 'ACCOUNT', amountMinor: 60_000 }],
        })
        .expect(403); // returns need a manager by default
      // Owners approve their own returns and may refund from any shift.
      await ctx.http
        .post(`/api/v1/sales/${sale.id}/returns`)
        .set(s.owner)
        .send({
          id: randomUUID(),
          shiftId: s.shift.id,
          reason: 'Damaged bag',
          lines: [{ saleLineId: sale.lines[0].id, quantity: '1' }],
          refunds: [{ method: 'ACCOUNT', amountMinor: 60_000 }],
        })
        .expect(201);
      expect(await customerOf(s, c.id)).toMatchObject({ balanceMinor: 120_000 });

      const second = (await sellOnAccount(s, c.id, 1).expect(201)).body;
      await ctx.http
        .post(`/api/v1/sales/${second.id}/void`)
        .set(s.owner)
        .send({ id: randomUUID(), reason: 'Wrong customer' })
        .expect(201);
      expect(await customerOf(s, c.id)).toMatchObject({ balanceMinor: 120_000 });
    });

    it('records offline account sales over the limit and flags them', async () => {
      const s = await shop();
      const c = await customer(s, { creditLimitMinor: 50_000 });
      const sale = await sellOnAccount(s, c.id, 1, {
        offline: {
          capturedAt: new Date().toISOString(),
          pricesIncludeTax: true,
          lines: [{ unitPriceMinor: 60_000, taxRateBp: 0 }],
        },
      }).expect(201);
      expect(sale.body.conflicts.map((x: { type: string }) => x.type)).toEqual([
        'CREDIT_LIMIT_EXCEEDED',
      ]);
      expect(await customerOf(s, c.id)).toMatchObject({
        balanceMinor: 60_000,
        availableCreditMinor: 0,
      });
    });
  });

  describe('collections and statements', () => {
    it('collects payments into the drawer, allows store credit and produces a statement', async () => {
      const s = await shop();
      const c = await customer(s);
      await sellOnAccount(s, c.id).expect(201);
      const pay = (body: Record<string, unknown>) =>
        ctx.http
          .post(`/api/v1/customers/${c.id}/payments`)
          .set(s.cashier)
          .send({ id: randomUUID(), method: 'CASH', amountMinor: 20_000, ...body });

      expect((await pay({}).expect(400)).body.error.issues).toEqual([
        { path: 'shiftId', message: 'validation.collection.cash_needs_shift' },
      ]);
      const body = { id: randomUUID(), method: 'CASH', amountMinor: 20_000, shiftId: s.shift.id };
      const first = await ctx.http
        .post(`/api/v1/customers/${c.id}/payments`)
        .set(s.cashier)
        .send(body)
        .expect(201);
      expect(first.body).toMatchObject({
        number: 'PAY-000001',
        balanceAfterMinor: 40_000,
        shiftNumber: s.shift.number,
      });
      await ctx.http
        .post(`/api/v1/customers/${c.id}/payments`)
        .set(s.cashier)
        .send(body)
        .expect(200);
      // Paying more than owed leaves store credit.
      await pay({ method: 'BANK_TRANSFER', amountMinor: 50_000, reference: 'BOC-7788' }).expect(
        201,
      );
      expect(await customerOf(s, c.id)).toMatchObject({
        balanceMinor: -10_000,
        availableCreditMinor: 110_000,
      });

      const shift = (await ctx.http.get(`/api/v1/shifts/${s.shift.id}`).set(s.cashier).expect(200))
        .body;
      expect(shift.summary).toMatchObject({
        // The bank transfer was taken without a shift, so only the cash is on this shift.
        collectionsMinor: 20_000,
        collectionsCashMinor: 20_000,
        expectedCashMinor: 20_000,
      });

      const statement = (
        await ctx.http.get(`/api/v1/customers/${c.id}/statement`).set(s.cashier).expect(200)
      ).body;
      expect(statement).toMatchObject({ openingBalanceMinor: 0, closingBalanceMinor: -10_000 });
      expect(
        statement.entries.map(
          (e: { type: string; amountMinor: number; balanceAfterMinor: number }) => [
            e.type,
            e.amountMinor,
            e.balanceAfterMinor,
          ],
        ),
      ).toEqual([
        ['CHARGE', 60_000, 60_000],
        ['PAYMENT', -20_000, 40_000],
        ['PAYMENT', -50_000, -10_000],
      ]);
      const later = (
        await ctx.http
          .get(`/api/v1/customers/${c.id}/statement`)
          .query({ from: '2099-01-01', to: '2099-01-31' })
          .set(s.cashier)
          .expect(200)
      ).body;
      expect(later).toMatchObject({
        openingBalanceMinor: -10_000,
        closingBalanceMinor: -10_000,
        entries: [],
      });
    });

    it('shows cashiers a customer’s full purchase history', async () => {
      const s = await shop();
      const c = await customer(s);
      await sellOnAccount(s, c.id).expect(201);
      const history = await ctx.http
        .get('/api/v1/sales')
        .query({ customerId: c.id })
        .set(s.cashier)
        .expect(200);
      expect(history.body.items).toHaveLength(1);
    });
  });

  describe('tenant isolation', () => {
    it('keeps customers and accounts private to their business', async () => {
      const a = await shop();
      const c = await customer(a);
      const b = await shop();
      await ctx.http.get(`/api/v1/customers/${c.id}`).set(b.owner).expect(404);
      expect(
        (
          await ctx.http
            .get('/api/v1/customers')
            .query({ q: '0771234567' })
            .set(b.owner)
            .expect(200)
        ).body.items,
      ).toEqual([]);
      const foreign = await sellOnAccount(b, c.id).expect(400);
      expect(foreign.body.error.issues).toEqual([
        { path: 'customerId', message: 'validation.customer.not_found' },
      ]);
      // The same phone can belong to customers of different businesses.
      await customer(b);
      await sellOnAccount(a, c.id).expect(201);
      await expect(
        ctx.prisma.withTenant(a.tenantId, (tx) =>
          tx.customerLedgerEntry.updateMany({
            where: { customerId: c.id },
            data: { amountMinor: 1n },
          }),
        ),
      ).rejects.toThrow(/permission denied/);
    });
  });
});
