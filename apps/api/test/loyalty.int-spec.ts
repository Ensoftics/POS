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

type Auth = { Authorization: string };

describe('Loyalty points (integration)', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await createTestContext();
  });
  beforeEach(async () => {
    await resetDatabase(ctx.owner);
    await ctx.owner.featureFlag.updateMany({ data: { defaultEnabled: true } });
  });
  afterAll(async () => {
    await ctx.close();
  });

  /**
   * A shop selling rice at 600.00 (no tax) with loyalty on: 1 point per 100.00,
   * a point is worth 1.00, at least 10 points per use. Refunds need no approval.
   */
  async function shop({ loyalty = true } = {}) {
    const session = await onboardedTenant(ctx, 'GENERAL_RETAIL');
    const owner = bearer(session.accessToken);
    const tenantId = session.tenant.id as string;
    const settings = (await ctx.http.get('/api/v1/settings').set(owner).expect(200)).body;
    await ctx.http
      .patch('/api/v1/settings')
      .set(owner)
      .send({
        version: settings.version,
        checkout: { refundsRequireApproval: false },
        loyalty: {
          enabled: loyalty,
          spendPerPointMinor: 10_000,
          pointValueMinor: 100,
          minRedeemPoints: 10,
        },
      })
      .expect(200);
    const branch = (await ctx.http.get('/api/v1/branches').set(owner).expect(200)).body.items[0];
    const product = (
      await ctx.http
        .post('/api/v1/products')
        .set(owner)
        .send({ name: 'Rice 5kg', unit: 'piece', variants: [{ sku: 'RICE', priceMinor: 60_000 }] })
        .expect(201)
    ).body;
    const variantId = product.variants[0].id as string;
    await ctx.http
      .post('/api/v1/goods-receipts')
      .set(owner)
      .send({
        id: randomUUID(),
        branchId: branch.id,
        lines: [{ variantId, quantity: '50', unitCostMinor: 1 }],
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
    const customer = (
      await ctx.http
        .post('/api/v1/customers')
        .set(owner)
        .send({ name: 'Nimali Perera', phone: '077 123 4567' })
        .expect(201)
    ).body;
    return { tenantId, owner, cashier, shift, variantId, customerId: customer.id as string };
  }
  type Shop = Awaited<ReturnType<typeof shop>>;

  function sell(
    s: Shop,
    quantity: number,
    payments: Array<{ method: string; amountMinor: number }>,
    extra: Record<string, unknown> = {},
  ) {
    return ctx.http
      .post('/api/v1/sales')
      .set(s.cashier)
      .send({
        id: randomUUID(),
        shiftId: s.shift.id,
        customerId: s.customerId,
        lines: [{ variantId: s.variantId, quantity: String(quantity) }],
        payments,
        expectedTotalMinor: 60_000 * quantity,
        ...extra,
      });
  }

  const points = async (s: Shop) =>
    (await ctx.http.get(`/api/v1/customers/${s.customerId}`).set(s.owner).expect(200)).body
      .loyaltyPoints as number;
  const history = async (s: Shop) =>
    (await ctx.http.get(`/api/v1/customers/${s.customerId}/loyalty`).set(s.owner).expect(200)).body;
  const give = (s: Shop, amount: number, auth: Auth = s.owner, id = randomUUID()) =>
    ctx.http
      .post(`/api/v1/customers/${s.customerId}/loyalty/adjust`)
      .set(auth)
      .send({ id, points: amount, reason: 'Opening balance' });

  describe('earning', () => {
    it('earns whole points on sales to a customer, shown on the receipt', async () => {
      const s = await shop();
      const sale = (await sell(s, 2, [{ method: 'CASH', amountMinor: 120_000 }]).expect(201)).body;
      expect(sale).toMatchObject({ pointsEarned: 12, pointsRedeemed: 0 });
      expect(await points(s)).toBe(12);
      const h = await history(s);
      expect(h.balance).toBe(12);
      expect(h.items[0]).toMatchObject({
        type: 'EARN',
        points: 12,
        balanceAfter: 12,
        referenceType: 'sale',
        referenceNumber: sale.number,
      });
      const receipt = (
        await ctx.http.get(`/api/v1/sales/${sale.id}/receipt`).set(s.cashier).expect(200)
      ).body;
      expect(receipt.loyaltyBalance).toBe(12);
    });

    it('earns nothing without a customer, or when loyalty is off', async () => {
      const off = await shop({ loyalty: false });
      await sell(off, 1, [{ method: 'CASH', amountMinor: 60_000 }]).expect(201);
      expect(await points(off)).toBe(0);
      const s = await shop();
      await sell(s, 1, [{ method: 'CASH', amountMinor: 60_000 }], { customerId: undefined }).expect(
        201,
      );
      expect(await points(s)).toBe(0);
      // The platform can switch loyalty off for a business.
      await ctx.owner.tenantFeatureFlag.create({
        data: { tenantId: s.tenantId, flagKey: 'loyalty', enabled: false },
      });
      await sell(s, 1, [{ method: 'CASH', amountMinor: 60_000 }]).expect(201);
      expect(await points(s)).toBe(0);
    });
  });

  describe('paying with points', () => {
    it('spends whole points and earns on the rest', async () => {
      const s = await shop();
      await give(s, 500).expect(200);
      const sale = (
        await sell(s, 1, [
          { method: 'LOYALTY', amountMinor: 5_000 },
          { method: 'CASH', amountMinor: 55_000 },
        ]).expect(201)
      ).body;
      expect(sale).toMatchObject({ pointsRedeemed: 50, pointsEarned: 5 });
      expect(await points(s)).toBe(455);
      expect(
        (await history(s)).items.map((e: { type: string; points: number }) => [e.type, e.points]),
      ).toEqual([
        ['EARN', 5],
        ['REDEEM', -50],
        ['ADJUST', 500],
      ]);
    });

    it('refuses fractions of points, too few points, missing customers and offline tills', async () => {
      const s = await shop();
      await give(s, 500).expect(200);
      const issue = async (res: { body: { error: { issues: Array<{ message: string }> } } }) =>
        res.body.error.issues[0]!.message;
      expect(
        await issue(
          await sell(s, 1, [
            { method: 'LOYALTY', amountMinor: 5_050 },
            { method: 'CASH', amountMinor: 54_950 },
          ]).expect(400),
        ),
      ).toBe('validation.payment.loyalty_not_whole_points');
      expect(
        await issue(
          await sell(s, 1, [
            { method: 'LOYALTY', amountMinor: 500 },
            { method: 'CASH', amountMinor: 59_500 },
          ]).expect(400),
        ),
      ).toBe('validation.payment.loyalty_below_minimum');
      expect(
        await issue(
          await sell(
            s,
            1,
            [
              { method: 'LOYALTY', amountMinor: 5_000 },
              { method: 'CASH', amountMinor: 55_000 },
            ],
            { customerId: undefined },
          ).expect(400),
        ),
      ).toBe('validation.payment.loyalty_needs_customer');
      expect(
        await issue(
          await sell(
            s,
            1,
            [
              { method: 'LOYALTY', amountMinor: 5_000 },
              { method: 'CASH', amountMinor: 55_000 },
            ],
            {
              offline: {
                capturedAt: new Date(Date.now() - 60_000).toISOString(),
                pricesIncludeTax: true,
                lines: [{ unitPriceMinor: 60_000, taxRateBp: 0 }],
              },
            },
          ).expect(400),
        ),
      ).toBe('validation.payment.loyalty_offline');
      const tooMany = await sell(s, 1, [{ method: 'LOYALTY', amountMinor: 60_000 }]).expect(409);
      expect(tooMany.body.error.code).toBe('INSUFFICIENT_POINTS');
      expect(await points(s)).toBe(500);
    });

    it('lets only one of two simultaneous sales spend the same points', async () => {
      const s = await shop();
      await give(s, 60).expect(200);
      const pay = [
        { method: 'LOYALTY', amountMinor: 5_000 },
        { method: 'CASH', amountMinor: 55_000 },
      ];
      const results = await Promise.all([sell(s, 1, pay), sell(s, 1, pay)]);
      expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
      // 60 - 50 + 5 earned on the cash part.
      expect(await points(s)).toBe(15);
    });

    it('cannot pay off an account with points', async () => {
      const s = await shop();
      const res = await ctx.http
        .post(`/api/v1/customers/${s.customerId}/payments`)
        .set(s.cashier)
        .send({ id: randomUUID(), shiftId: s.shift.id, method: 'LOYALTY', amountMinor: 1_000 })
        .expect(400);
      expect(res.body.error.code).toBe('VALIDATION_FAILED');
    });
  });

  describe('returns', () => {
    it('gives back spent points and takes back earned points, exactly over partial returns', async () => {
      const s = await shop();
      await give(s, 100).expect(200);
      const sale = (
        await sell(s, 2, [
          { method: 'LOYALTY', amountMinor: 5_000 },
          { method: 'CASH', amountMinor: 115_000 },
        ]).expect(201)
      ).body;
      expect(sale.pointsEarned).toBe(11);
      expect(await points(s)).toBe(100 - 50 + 11);

      const returnOne = (refunds: Array<{ method: string; amountMinor: number }>) =>
        ctx.http
          .post(`/api/v1/sales/${sale.id}/returns`)
          .set(s.cashier)
          .send({
            id: randomUUID(),
            shiftId: s.shift.id,
            reason: 'Wrong item',
            lines: [{ saleLineId: sale.lines[0].id, quantity: '1' }],
            refunds,
          });
      await returnOne([
        { method: 'LOYALTY', amountMinor: 5_000 },
        { method: 'CASH', amountMinor: 55_000 },
      ]).expect(201);
      // 50 points back; half of the 11 earned (rounded down) taken back.
      expect(await points(s)).toBe(61 + 50 - 5);
      await returnOne([{ method: 'CASH', amountMinor: 60_000 }]).expect(201);
      // Everything returned: the balance is back where it started.
      expect(await points(s)).toBe(100);
      const types = (await history(s)).items.map((e: { type: string; points: number }) => [
        e.type,
        e.points,
      ]);
      expect(types.slice(0, 3)).toEqual([
        ['REVERSE', -6],
        ['REVERSE', -5],
        ['REFUND', 50],
      ]);
    });

    it('may take the balance below zero when earned points were already spent', async () => {
      const s = await shop();
      const sale = (await sell(s, 2, [{ method: 'CASH', amountMinor: 120_000 }]).expect(201)).body;
      await give(s, -12).expect(200);
      await ctx.http
        .post(`/api/v1/sales/${sale.id}/returns`)
        .set(s.cashier)
        .send({
          id: randomUUID(),
          shiftId: s.shift.id,
          reason: 'Wrong item',
          lines: [{ saleLineId: sale.lines[0].id, quantity: '2' }],
          refunds: [{ method: 'CASH', amountMinor: 120_000 }],
        })
        .expect(201);
      expect(await points(s)).toBe(-12);
    });
  });

  describe('adjustments', () => {
    it('lets managers correct points once per request, never below zero', async () => {
      const s = await shop();
      const id = randomUUID();
      await give(s, 25, s.owner, id).expect(200);
      await give(s, 25, s.owner, id).expect(200);
      expect(await points(s)).toBe(25);
      const below = await give(s, -30).expect(409);
      expect(below.body.error.code).toBe('INSUFFICIENT_POINTS');
      await give(s, 10, s.cashier).expect(403);
      const audit = await ctx.owner.auditLog.findFirstOrThrow({
        where: { tenantId: s.tenantId, action: 'loyalty.adjusted' },
      });
      expect(audit.metadata).toMatchObject({ points: 25, balance: 25, reason: 'Opening balance' });
    });

    it('refuses adjustments while loyalty is off and keeps customers to their business', async () => {
      const off = await shop({ loyalty: false });
      const res = await give(off, 10).expect(400);
      expect(res.body.error.issues).toEqual([
        { path: 'points', message: 'validation.loyalty.off' },
      ]);
      const other = await shop();
      await ctx.http
        .get(`/api/v1/customers/${off.customerId}/loyalty`)
        .set(other.owner)
        .expect(404);
    });
  });
});
