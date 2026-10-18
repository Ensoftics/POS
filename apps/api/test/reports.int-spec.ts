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

describe('Reports and costing (integration)', () => {
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
   * VAT 18 % included in prices. Lamp 1,180.00 (VAT) received 10 @ 500 then 10 @ 800
   * (average 650.00); Candle 300.00 (exempt) received 5 @ 100. Owner's shift is open.
   */
  async function shop() {
    const session = await onboardedTenant(ctx, 'GENERAL_RETAIL');
    const owner = bearer(session.accessToken);
    const tenantId = session.tenant.id as string;
    const branch = (await ctx.http.get('/api/v1/branches').set(owner).expect(200)).body.items[0];
    await ctx.http
      .post('/api/v1/tax-rates')
      .set(owner)
      .send({ name: 'VAT', rateBp: 1800, isDefault: true })
      .expect(201);
    const exempt = (
      await ctx.http
        .post('/api/v1/tax-rates')
        .set(owner)
        .send({ name: 'Exempt', rateBp: 0 })
        .expect(201)
    ).body;
    const product = async (name: string, sku: string, priceMinor: number, taxRateId?: string) =>
      (
        await ctx.http
          .post('/api/v1/products')
          .set(owner)
          .send({
            name,
            unit: 'piece',
            ...(taxRateId ? { taxRateId } : {}),
            variants: [{ sku, priceMinor }],
          })
          .expect(201)
      ).body.variants[0].id as string;
    const lamp = await product('Brass Lamp', 'LAMP', 118_000);
    const candle = await product('=HYPERLINK("http://x")', 'CANDLE', 30_000, exempt.id);
    const receive = (variantId: string, quantity: string, unitCostMinor: number) =>
      ctx.http
        .post('/api/v1/goods-receipts')
        .set(owner)
        .send({
          id: randomUUID(),
          branchId: branch.id,
          lines: [{ variantId, quantity, unitCostMinor }],
        })
        .expect(201);
    await receive(lamp, '10', 50_000);
    await receive(lamp, '10', 80_000);
    await receive(candle, '5', 10_000);
    const shift = (
      await ctx.http
        .post('/api/v1/shifts')
        .set(owner)
        .send({ registerId: branch.registers[0].id, openingFloatMinor: 0 })
        .expect(201)
    ).body;
    return { tenantId, owner, branchId: branch.id as string, shift, lamp, candle, receive };
  }
  type Shop = Awaited<ReturnType<typeof shop>>;

  async function sell(
    s: Shop,
    lines: Array<{ variantId: string; quantity: string }>,
    total: number,
    payments?: unknown[],
    extra = {},
  ) {
    return (
      await ctx.http
        .post('/api/v1/sales')
        .set(s.owner)
        .send({
          id: randomUUID(),
          shiftId: s.shift.id,
          lines,
          payments: payments ?? [{ method: 'CASH', amountMinor: total }],
          expectedTotalMinor: total,
          ...extra,
        })
        .expect(201)
    ).body;
  }

  const report = (s: Shop, path: string, query: Record<string, string> = {}) =>
    ctx.http
      .get(`/api/v1/reports/${path}`)
      .query(query)
      .set(s.owner)
      .expect(200)
      .then((r) => r.body);

  it('keeps a moving average cost and records cost of goods on sales and returns', async () => {
    const s = await shop();
    const cost = await ctx.owner.variantCost.findFirstOrThrow({ where: { variantId: s.lamp } });
    expect(cost.averageCost4).toBe(650_000_000n); // 650.00
    const sale = await sell(s, [{ variantId: s.lamp, quantity: '4' }], 472_000);
    await ctx.http
      .post(`/api/v1/sales/${sale.id}/returns`)
      .set(s.owner)
      .send({
        id: randomUUID(),
        shiftId: s.shift.id,
        reason: 'Dent',
        lines: [{ saleLineId: sale.lines[0].id, quantity: '1' }],
        refunds: [{ method: 'CASH', amountMinor: 118_000 }],
      })
      .expect(201);
    const movements = await ctx.owner.stockMovement.findMany({
      where: { tenantId: s.tenantId, variantId: s.lamp, type: { in: ['SALE', 'RETURN'] } },
    });
    expect(movements.map((m) => [m.type, Number(m.costMinor)]).sort()).toEqual([
      ['RETURN', 65_000],
      ['SALE', 260_000],
    ]);

    const profit = await report(s, 'profit', { groupBy: 'product' });
    const lamp = profit.rows.find((r: { label: string }) => r.label.startsWith('Brass Lamp'));
    // Revenue ex VAT: 4 × 1,000.00 − 1 × 1,000.00; cost: 4 × 650 − 650.
    expect(lamp).toMatchObject({
      revenueMinor: 300_000,
      costMinor: 195_000,
      profitMinor: 105_000,
      marginBp: 3_500,
      unknownCostQuantity: '0',
    });

    const valuation = await report(s, 'stock-valuation');
    expect(valuation.rows.find((r: { sku: string }) => r.sku === 'LAMP')).toMatchObject({
      quantity: '17',
      averageCostMinor: 65_000,
      valueMinor: 1_105_000,
    });
    expect(valuation.totals).toMatchObject({ valueMinor: 1_105_000 + 50_000, itemsWithoutCost: 0 });
  });

  it('averages correctly when two receipts arrive at once', async () => {
    const s = await shop();
    const fresh = (
      await ctx.http
        .post('/api/v1/products')
        .set(s.owner)
        .send({ name: 'Vase', unit: 'piece', variants: [{ sku: 'VASE', priceMinor: 1 }] })
        .expect(201)
    ).body.variants[0].id;
    await Promise.all([s.receive(fresh, '10', 10_000), s.receive(fresh, '10', 30_000)]);
    const cost = await ctx.owner.variantCost.findFirstOrThrow({ where: { variantId: fresh } });
    expect(cost.averageCost4).toBe(200_000_000n);
  });

  it('reports sales by day, product and payment method, and tax collected net of refunds', async () => {
    const s = await shop();
    await sell(
      s,
      [
        { variantId: s.lamp, quantity: '2' },
        { variantId: s.candle, quantity: '1' },
      ],
      266_000,
      [
        { method: 'CARD', amountMinor: 200_000 },
        { method: 'CASH', amountMinor: 70_000 },
      ],
    ); // 4,000.00 change from cash
    const second = await sell(s, [{ variantId: s.lamp, quantity: '1' }], 118_000);
    await ctx.http
      .post(`/api/v1/sales/${second.id}/void`)
      .set(s.owner)
      .send({ id: randomUUID(), reason: 'Mistake' })
      .expect(201);

    const byDay = await report(s, 'sales');
    expect(byDay.rows).toHaveLength(1);
    expect(byDay.totals).toMatchObject({
      saleCount: 2,
      totalMinor: 384_000,
      refundsMinor: 118_000,
      netMinor: 266_000,
    });

    const byProduct = await report(s, 'sales', { groupBy: 'product' });
    expect(
      byProduct.rows.find((r: { label: string }) => r.label.startsWith('Brass Lamp')),
    ).toMatchObject({ quantity: '3', totalMinor: 354_000, refundsMinor: 118_000 });

    const byMethod = await report(s, 'sales', { groupBy: 'payment_method' });
    const methods = Object.fromEntries(
      byMethod.rows.map((r: { key: string; totalMinor: number; refundsMinor: number }) => [
        r.key,
        [r.totalMinor, r.refundsMinor],
      ]),
    );
    expect(methods).toEqual({ CARD: [200_000, 0], CASH: [66_000 + 118_000, 118_000] });

    const tax = await report(s, 'tax');
    const vat = tax.rows.find((r: { name: string }) => r.name === 'VAT');
    // VAT inside 3 × 1,180.00 = 3 × 180.00; the void refunds 180.00.
    expect(vat).toMatchObject({
      rateBp: 1800,
      taxMinor: 54_000,
      refundedTaxMinor: 18_000,
      netTaxMinor: 36_000,
      taxableMinor: 300_000,
    });
    expect(tax.rows.find((r: { name: string }) => r.name === 'Exempt')).toMatchObject({
      taxMinor: 0,
      taxableMinor: 30_000,
    });

    const empty = await report(s, 'sales', { from: '2020-01-01', to: '2020-01-31' });
    expect(empty).toMatchObject({ rows: [], totals: { saleCount: 0, netMinor: 0 } });
  });

  it('ages customer balances and summarises the day on the dashboard', async () => {
    const s = await shop();
    const customer = (
      await ctx.http
        .post('/api/v1/customers')
        .set(s.owner)
        .send({ name: 'Ravi', creditLimitMinor: 1_000_000 })
        .expect(201)
    ).body;
    await sell(
      s,
      [{ variantId: s.lamp, quantity: '1' }],
      118_000,
      [{ method: 'ACCOUNT', amountMinor: 118_000 }],
      { customerId: customer.id },
    );
    await sell(s, [{ variantId: s.candle, quantity: '2' }], 60_000);

    const receivables = await report(s, 'receivables');
    expect(receivables.rows).toEqual([
      expect.objectContaining({ name: 'Ravi', balanceMinor: 118_000, '0_30': 118_000, OVER_90: 0 }),
    ]);

    const dashboard = await report(s, 'dashboard');
    expect(dashboard).toMatchObject({
      todayTotals: { salesMinor: 178_000, saleCount: 2, averageSaleMinor: 89_000, refundsMinor: 0 },
      openShifts: 1,
      receivablesMinor: 118_000,
    });
    expect(dashboard.last7Days).toHaveLength(7);
    expect(dashboard.last7Days.at(-1)).toMatchObject({
      date: dashboard.today,
      salesMinor: 178_000,
    });
    expect(dashboard.topProducts[0]).toMatchObject({ label: 'Brass Lamp', totalMinor: 118_000 });
  });

  it('exports CSV with spreadsheet formulas neutralised', async () => {
    const s = await shop();
    await sell(s, [{ variantId: s.candle, quantity: '1' }], 30_000);
    const res = await ctx.http
      .get('/api/v1/reports/sales')
      .query({ groupBy: 'product', format: 'csv' })
      .set(s.owner)
      .expect(200);
    expect(res.headers['content-type']).toContain('text/csv');
    expect(res.headers['content-disposition']).toMatch(
      /attachment; filename="sales-product-.*\.csv"/,
    );
    expect(res.text.split('\r\n')[0]).toBe('product,sales,quantity,discount,tax,total,refunds,net');
    expect(res.text).toContain(`"'=HYPERLINK(""http://x"")",1,1,0.00,0.00,300.00,0.00,300.00`);
    expect(res.text).toContain('TOTAL,1,1,0.00,0.00,300.00,0.00,300.00');
  });

  it('limits reports to owners and managers, and keeps them per business', async () => {
    const s = await shop();
    await sell(s, [{ variantId: s.candle, quantity: '1' }], 30_000);
    const cashier = bearer(
      (await login(ctx, (await addMember(ctx, s.tenantId, 'CASHIER')).email)).accessToken,
    );
    for (const path of ['sales', 'tax', 'profit', 'stock-valuation', 'receivables', 'dashboard'])
      await ctx.http.get(`/api/v1/reports/${path}`).set(cashier).expect(403);
    const manager = bearer(
      (await login(ctx, (await addMember(ctx, s.tenantId, 'MANAGER')).email)).accessToken,
    );
    await ctx.http.get('/api/v1/reports/profit').set(manager).expect(200);

    const other = await shop();
    const theirs = await report(other, 'sales');
    expect(theirs.totals.saleCount).toBe(0);
  });
});
