import { randomUUID } from 'node:crypto';
import { computeCart } from '@pos/domain';
import {
  addMember,
  bearer,
  createTestContext,
  login,
  onboardedTenant,
  resetDatabase,
  type TestContext,
} from './helpers';

type Auth = ReturnType<typeof bearer>;

describe('Checkout: tax rates, shifts and sales (integration)', () => {
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
   * A general store with VAT 18 % as the default rate, one taxed product (two
   * variants, 10 of each in stock) and one product on a 0 % rate.
   */
  async function store() {
    const session = await onboardedTenant(ctx, 'GENERAL_RETAIL');
    const auth = bearer(session.accessToken);
    const branch = (await ctx.http.get('/api/v1/branches').set(auth).expect(200)).body.items[0];
    const vat = (
      await ctx.http
        .post('/api/v1/tax-rates')
        .set(auth)
        .send({ name: 'VAT', rateBp: 1800, isDefault: true })
        .expect(201)
    ).body;
    const exempt = (
      await ctx.http
        .post('/api/v1/tax-rates')
        .set(auth)
        .send({ name: 'Exempt', rateBp: 0 })
        .expect(201)
    ).body;
    const product = (name: string, variant: Record<string, unknown>) =>
      ctx.http
        .post('/api/v1/products')
        .set(auth)
        .send({ name, unit: 'piece', variants: [variant] })
        .expect(201)
        .then((r) => r.body);
    const soapL = await product('Herbal Soap', { sku: 'SOAP-L', priceMinor: 118_000 });
    const soapS = await product('Herbal Soap Mini', {
      sku: 'SOAP-S',
      barcode: '4006381333931',
      priceMinor: 59_000,
    });
    const rice = (
      await ctx.http
        .post('/api/v1/products')
        .set(auth)
        .send({
          name: 'Red Rice 1kg',
          unit: 'piece',
          taxRateId: exempt.id,
          variants: [{ sku: 'RICE-1', priceMinor: 32_000 }],
        })
        .expect(201)
    ).body;
    const ids = {
      soapL: soapL.variants[0].id as string,
      soapS: soapS.variants[0].id as string,
      rice: rice.variants[0].id as string,
    };
    await ctx.http
      .post('/api/v1/goods-receipts')
      .set(auth)
      .send({
        id: randomUUID(),
        branchId: branch.id,
        lines: Object.values(ids).map((variantId) => ({
          variantId,
          quantity: '10',
          unitCostMinor: 10_000,
        })),
      })
      .expect(201);
    return {
      session,
      auth,
      tenantId: session.tenant.id as string,
      branchId: branch.id as string,
      registerId: branch.registers[0].id as string,
      vat,
      exempt,
      ids,
    };
  }
  type Store = Awaited<ReturnType<typeof store>>;

  async function openShift(s: Store, auth: Auth = s.auth, openingFloatMinor = 500_000) {
    return (
      await ctx.http
        .post('/api/v1/shifts')
        .set(auth)
        .send({ registerId: s.registerId, openingFloatMinor })
        .expect(201)
    ).body as { id: string; version: number; number: string };
  }

  async function stockQty(s: Store, sku: string): Promise<string> {
    const page = await ctx.http
      .get('/api/v1/stock')
      .query({ branchId: s.branchId, q: sku })
      .set(s.auth)
      .expect(200);
    return page.body.items.find((row: { sku: string }) => row.sku === sku)?.quantity ?? '0';
  }

  function sell(s: Store, shiftId: string, body: Record<string, unknown>, auth: Auth = s.auth) {
    return ctx.http
      .post('/api/v1/sales')
      .set(auth)
      .send({ id: randomUUID(), shiftId, payments: [], ...body });
  }

  async function expectLedgerConsistent(tenantId: string) {
    const rows = await ctx.owner.$queryRaw<Array<{ level: string; ledger: string }>>`
      SELECT l.quantity::text AS level, COALESCE(SUM(m.quantity), 0)::text AS ledger
      FROM stock_levels l
      LEFT JOIN stock_movements m ON m.tenant_id = l.tenant_id AND m.branch_id = l.branch_id
        AND m.variant_id = l.variant_id AND m.batch_id IS NOT DISTINCT FROM l.batch_id
      WHERE l.tenant_id = ${tenantId}::uuid
      GROUP BY l.id, l.quantity`;
    for (const row of rows) expect(Number(row.ledger)).toBeCloseTo(Number(row.level), 6);
  }

  describe('tax rates', () => {
    it('keeps a single default, rejects duplicates and protects rates in use', async () => {
      const s = await store();
      const reduced = await ctx.http
        .post('/api/v1/tax-rates')
        .set(s.auth)
        .send({ name: 'Reduced', rateBp: 500, isDefault: true })
        .expect(201);
      const list = (await ctx.http.get('/api/v1/tax-rates').set(s.auth).expect(200)).body.items;
      expect(list.filter((r: { isDefault: boolean }) => r.isDefault)).toEqual([
        expect.objectContaining({ id: reduced.body.id }),
      ]);

      const dup = await ctx.http
        .post('/api/v1/tax-rates')
        .set(s.auth)
        .send({ name: 'vat', rateBp: 1500 })
        .expect(400);
      expect(dup.body.error.issues).toEqual([
        { path: 'name', message: 'validation.tax_rate.name_taken' },
      ]);

      const inUse = await ctx.http
        .patch(`/api/v1/tax-rates/${s.exempt.id}`)
        .set(s.auth)
        .send({ version: s.exempt.version, status: 'ARCHIVED' })
        .expect(409);
      expect(inUse.body.error.code).toBe('TAX_RATE_IN_USE');

      // Archiving the default clears the flag.
      const archived = await ctx.http
        .patch(`/api/v1/tax-rates/${reduced.body.id}`)
        .set(s.auth)
        .send({ version: reduced.body.version, status: 'ARCHIVED' })
        .expect(200);
      expect(archived.body).toMatchObject({ status: 'ARCHIVED', isDefault: false });
    });

    it('lets cashiers read but not change rates', async () => {
      const s = await store();
      const cashier = await login(ctx, (await addMember(ctx, s.tenantId, 'CASHIER')).email);
      await ctx.http.get('/api/v1/tax-rates').set(bearer(cashier.accessToken)).expect(200);
      await ctx.http
        .post('/api/v1/tax-rates')
        .set(bearer(cashier.accessToken))
        .send({ name: 'X', rateBp: 1 })
        .expect(403);
    });
  });

  describe('shifts', () => {
    it('allows one open shift per register, even when opened simultaneously', async () => {
      const s = await store();
      const results = await Promise.all(
        [1, 2].map(() =>
          ctx.http
            .post('/api/v1/shifts')
            .set(s.auth)
            .send({ registerId: s.registerId, openingFloatMinor: 0 }),
        ),
      );
      expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
      expect(results.find((r) => r.status === 409)!.body.error.code).toBe('SHIFT_ALREADY_OPEN');
      const current = await ctx.http
        .get('/api/v1/shifts/current')
        .query({ registerId: s.registerId })
        .set(s.auth)
        .expect(200);
      expect(current.body.shift).toMatchObject({ status: 'OPEN', number: 'SHF-000001' });
    });

    it('closes with expected cash, counted cash and the difference', async () => {
      const s = await store();
      const shift = await openShift(s, s.auth, 500_000);
      // Rice 320.00 x 2 = 640.00 paid with 1000.00 cash: 360.00 change.
      await sell(s, shift.id, {
        lines: [{ variantId: s.ids.rice, quantity: '2' }],
        payments: [{ method: 'CASH', amountMinor: 100_000 }],
        expectedTotalMinor: 64_000,
      }).expect(201);
      await sell(s, shift.id, {
        lines: [{ variantId: s.ids.rice, quantity: '1' }],
        payments: [{ method: 'CARD', amountMinor: 32_000, reference: 'APP-1' }],
        expectedTotalMinor: 32_000,
      }).expect(201);

      const closed = await ctx.http
        .post(`/api/v1/shifts/${shift.id}/close`)
        .set(s.auth)
        .send({ version: shift.version, countedCashMinor: 563_000, notes: 'Short 1.00' })
        .expect(200);
      expect(closed.body).toMatchObject({
        status: 'CLOSED',
        expectedCashMinor: 564_000, // 5000.00 + 1000.00 − 360.00
        countedCashMinor: 563_000,
        differenceMinor: -1000,
        summary: {
          saleCount: 2,
          salesTotalMinor: 96_000,
          cashReceivedMinor: 100_000,
          changeGivenMinor: 36_000,
          payments: [
            { method: 'CASH', amountMinor: 100_000 },
            { method: 'CARD', amountMinor: 32_000 },
          ],
        },
      });

      const late = await sell(s, shift.id, {
        lines: [{ variantId: s.ids.rice, quantity: '1' }],
        payments: [{ method: 'CASH', amountMinor: 32_000 }],
        expectedTotalMinor: 32_000,
      }).expect(409);
      expect(late.body.error.code).toBe('SHIFT_NOT_OPEN');
      await ctx.http
        .post(`/api/v1/shifts/${shift.id}/close`)
        .set(s.auth)
        .send({ version: closed.body.version, countedCashMinor: 0 })
        .expect(409);
    });

    it('keeps cashiers to their own shifts while managers see all', async () => {
      const s = await store();
      const ownerShift = await openShift(s);
      const cashier = bearer(
        (await login(ctx, (await addMember(ctx, s.tenantId, 'CASHIER')).email)).accessToken,
      );
      // Selling or closing on someone else's shift is refused.
      const refused = await sell(
        s,
        ownerShift.id,
        {
          lines: [{ variantId: s.ids.rice, quantity: '1' }],
          payments: [{ method: 'CASH', amountMinor: 32_000 }],
          expectedTotalMinor: 32_000,
        },
        cashier,
      ).expect(403);
      expect(refused.body.error.code).toBe('FORBIDDEN');
      await ctx.http
        .post(`/api/v1/shifts/${ownerShift.id}/close`)
        .set(cashier)
        .send({ version: 1, countedCashMinor: 0 })
        .expect(404);
      await ctx.http.get('/api/v1/shifts').set(cashier).expect(403);
      await ctx.http.get('/api/v1/shifts').set(s.auth).expect(200);
    });
  });

  describe('sales', () => {
    it('prices on the server, applies discounts and tax, splits payments and takes stock', async () => {
      const s = await store();
      const shift = await openShift(s);
      const lines = [
        { variantId: s.ids.soapL, quantity: '2', discount: { kind: 'PERCENT', value: 1000 } },
        { variantId: s.ids.rice, quantity: '1' },
      ];
      const discount = { kind: 'AMOUNT', value: 5_000 } as const;
      const expected = computeCart({
        pricesIncludeTax: true,
        discount,
        lines: [
          {
            unitPriceMinor: 118_000,
            quantity: '2',
            taxRateBp: 1800,
            discount: lines[0]!.discount as never,
          },
          { unitPriceMinor: 32_000, quantity: '1', taxRateBp: 0 },
        ],
      });
      const total = expected.totalMinor;
      const response = await sell(s, shift.id, {
        lines,
        discount,
        payments: [
          { method: 'CARD', amountMinor: 200_000, reference: 'APP-77' },
          { method: 'CASH', amountMinor: total - 200_000 + 1_000 },
        ],
        expectedTotalMinor: total,
      }).expect(201);
      const sale = response.body;
      expect(sale).toMatchObject({
        number: 'INV-000001',
        subtotalMinor: 268_000,
        discountMinor: expected.discountMinor,
        taxMinor: expected.taxMinor,
        totalMinor: total,
        changeMinor: 1_000,
        pricesIncludeTax: true,
        currency: 'LKR',
      });
      expect(sale.lines[0]).toMatchObject({
        productName: 'Herbal Soap',
        sku: 'SOAP-L',
        unitPriceMinor: 118_000,
        lineDiscountMinor: 23_600,
        taxName: 'VAT',
        taxRateBp: 1800,
      });
      expect(sale.lines[1]).toMatchObject({ taxName: 'Exempt', taxRateBp: 0, taxMinor: 0 });
      expect(sale.taxSummary).toEqual([
        expect.objectContaining({ name: 'VAT', rateBp: 1800, taxMinor: expected.taxMinor }),
      ]);

      expect(await stockQty(s, 'SOAP-L')).toBe('8');
      expect(await stockQty(s, 'RICE-1')).toBe('9');
      const movements = await ctx.owner.stockMovement.findMany({
        where: { tenantId: s.tenantId, referenceId: sale.id },
      });
      expect(movements.map((m) => [m.type, m.quantity.toString()]).sort()).toEqual([
        ['SALE', '-1'],
        ['SALE', '-2'],
      ]);
      await expectLedgerConsistent(s.tenantId);

      // Price changes later never alter the recorded sale.
      const product = await ctx.owner.productVariant.findUniqueOrThrow({
        where: { id: s.ids.soapL },
      });
      await ctx.owner.productVariant.update({
        where: { id: product.id },
        data: { priceMinor: 1n },
      });
      const receipt = await ctx.http
        .get(`/api/v1/sales/${sale.id}/receipt`)
        .set(s.auth)
        .expect(200);
      expect(receipt.body.sale.lines[0].unitPriceMinor).toBe(118_000);
      expect(receipt.body.business).toMatchObject({
        name: s.session.tenant.name,
        branchName: expect.any(String),
        timezone: 'Asia/Colombo',
      });
    });

    it('refuses totals the server does not agree with, without using a number or stock', async () => {
      const s = await store();
      const shift = await openShift(s);
      const stale = await sell(s, shift.id, {
        lines: [{ variantId: s.ids.rice, quantity: '1' }],
        payments: [{ method: 'CASH', amountMinor: 30_000 }],
        expectedTotalMinor: 30_000, // the till had an old price
      }).expect(409);
      expect(stale.body.error.code).toBe('TOTAL_MISMATCH');
      expect(await stockQty(s, 'RICE-1')).toBe('10');
      const ok = await sell(s, shift.id, {
        lines: [{ variantId: s.ids.rice, quantity: '1' }],
        payments: [{ method: 'CASH', amountMinor: 32_000 }],
        expectedTotalMinor: 32_000,
      }).expect(201);
      expect(ok.body.number).toBe('INV-000001');
    });

    it('validates payments and discounts', async () => {
      const s = await store();
      const shift = await openShift(s);
      const base = {
        lines: [{ variantId: s.ids.rice, quantity: '1' }],
        expectedTotalMinor: 32_000,
      };
      const short = await sell(s, shift.id, {
        ...base,
        payments: [{ method: 'CASH', amountMinor: 31_999 }],
      }).expect(400);
      expect(short.body.error.issues).toEqual([
        { path: 'payments', message: 'validation.payment.insufficient' },
      ]);
      const overCard = await sell(s, shift.id, {
        ...base,
        payments: [{ method: 'CARD', amountMinor: 40_000 }],
      }).expect(400);
      expect(overCard.body.error.issues[0].message).toBe(
        'validation.payment.non_cash_exceeds_total',
      );
      const bigDiscount = await sell(s, shift.id, {
        lines: [
          { variantId: s.ids.rice, quantity: '1', discount: { kind: 'AMOUNT', value: 40_000 } },
        ],
        expectedTotalMinor: 0,
      }).expect(400);
      expect(bigDiscount.body.error.issues).toEqual([
        { path: 'lines.0.discount', message: 'validation.discount.exceeds_line' },
      ]);
      // A fully discounted sale needs no payment.
      await sell(s, shift.id, {
        lines: [{ variantId: s.ids.rice, quantity: '1' }],
        discount: { kind: 'PERCENT', value: 10_000 },
        expectedTotalMinor: 0,
      }).expect(201);
    });

    it('is idempotent on the sale id, including simultaneous retries', async () => {
      const s = await store();
      const shift = await openShift(s);
      const body = {
        id: randomUUID(),
        shiftId: shift.id,
        lines: [{ variantId: s.ids.soapS, quantity: '1' }],
        payments: [{ method: 'CASH', amountMinor: 59_000 }],
        expectedTotalMinor: 59_000,
      };
      const first = await ctx.http.post('/api/v1/sales').set(s.auth).send(body).expect(201);
      const retry = await ctx.http.post('/api/v1/sales').set(s.auth).send(body).expect(200);
      expect(retry.body.number).toBe(first.body.number);

      const reused = await ctx.http
        .post('/api/v1/sales')
        .set(s.auth)
        .send({
          ...body,
          lines: [{ variantId: s.ids.soapS, quantity: '2' }],
          expectedTotalMinor: 118_000,
          payments: [{ method: 'CASH', amountMinor: 118_000 }],
        })
        .expect(409);
      expect(reused.body.error.code).toBe('IDEMPOTENCY_CONFLICT');

      const id2 = randomUUID();
      const results = await Promise.all(
        [1, 2].map(() =>
          ctx.http
            .post('/api/v1/sales')
            .set(s.auth)
            .send({ ...body, id: id2 }),
        ),
      );
      expect(results.map((r) => r.status).sort()).toEqual([200, 201]);
      expect(results[0]!.body.number).toBe(results[1]!.body.number);
      expect(await stockQty(s, 'SOAP-S')).toBe('8');
      await expectLedgerConsistent(s.tenantId);
    });

    it('refuses to oversell by default and lets only one of two racing sales take the last item', async () => {
      const s = await store();
      const shift = await openShift(s);
      const many = await sell(s, shift.id, {
        lines: [{ variantId: s.ids.rice, quantity: '11' }],
        payments: [{ method: 'CASH', amountMinor: 352_000 }],
        expectedTotalMinor: 352_000,
      }).expect(409);
      expect(many.body.error.code).toBe('INSUFFICIENT_STOCK');

      await sell(s, shift.id, {
        lines: [{ variantId: s.ids.rice, quantity: '9' }],
        payments: [{ method: 'CASH', amountMinor: 288_000 }],
        expectedTotalMinor: 288_000,
      }).expect(201);
      const racing = await Promise.all(
        [1, 2].map(() =>
          sell(s, shift.id, {
            lines: [{ variantId: s.ids.rice, quantity: '1' }],
            payments: [{ method: 'CASH', amountMinor: 32_000 }],
            expectedTotalMinor: 32_000,
          }),
        ),
      );
      expect(racing.map((r) => r.status).sort()).toEqual([201, 409]);
      expect(await stockQty(s, 'RICE-1')).toBe('0');
      await expectLedgerConsistent(s.tenantId);
    });

    it('sells past recorded stock when the negative-stock policy allows it', async () => {
      const s = await store();
      const settings = (await ctx.http.get('/api/v1/settings').set(s.auth).expect(200)).body;
      await ctx.http
        .patch('/api/v1/settings')
        .set(s.auth)
        .send({ version: settings.version, checkout: { allowNegativeStock: true } })
        .expect(200);
      const shift = await openShift(s);
      await sell(s, shift.id, {
        lines: [{ variantId: s.ids.rice, quantity: '12' }],
        payments: [{ method: 'CASH', amountMinor: 384_000 }],
        expectedTotalMinor: 384_000,
      }).expect(201);
      expect(await stockQty(s, 'RICE-1')).toBe('-2');
      await expectLedgerConsistent(s.tenantId);
      // Other documents still cannot take stock that is not there.
      const adjustment = await ctx.http
        .post('/api/v1/stock-adjustments')
        .set(s.auth)
        .send({
          id: randomUUID(),
          branchId: s.branchId,
          reason: 'DAMAGED',
          lines: [{ variantId: s.ids.rice, quantity: '-1' }],
        })
        .expect(409);
      expect(adjustment.body.error.code).toBe('INSUFFICIENT_STOCK');
    });

    it('adds tax on top when prices exclude tax', async () => {
      const s = await store();
      const settings = (await ctx.http.get('/api/v1/settings').set(s.auth).expect(200)).body;
      expect(settings.checkout).toEqual({
        pricesIncludeTax: true,
        allowNegativeStock: false,
        receiptFooter: null,
        discountApprovalBp: null,
        refundsRequireApproval: true,
      });
      await ctx.http
        .patch('/api/v1/settings')
        .set(s.auth)
        .send({
          version: settings.version,
          checkout: { pricesIncludeTax: false, receiptFooter: 'Thank you!' },
        })
        .expect(200);
      const shift = await openShift(s);
      const sale = await sell(s, shift.id, {
        lines: [{ variantId: s.ids.soapS, quantity: '1' }],
        payments: [{ method: 'CASH', amountMinor: 69_620 }],
        expectedTotalMinor: 69_620, // 590.00 + 18 % = 696.20
      }).expect(201);
      expect(sale.body).toMatchObject({
        taxMinor: 10_620,
        totalMinor: 69_620,
        pricesIncludeTax: false,
      });
      const receipt = await ctx.http
        .get(`/api/v1/sales/${sale.body.id}/receipt`)
        .set(s.auth)
        .expect(200);
      expect(receipt.body.business.footer).toBe('Thank you!');
    });

    it('enforces sales permissions and shows cashiers only their own sales', async () => {
      const s = await store();
      const ownerShift = await openShift(s);
      await sell(s, ownerShift.id, {
        lines: [{ variantId: s.ids.rice, quantity: '1' }],
        payments: [{ method: 'CASH', amountMinor: 32_000 }],
        expectedTotalMinor: 32_000,
      }).expect(201);

      const stockStaff = bearer(
        (await login(ctx, (await addMember(ctx, s.tenantId, 'INVENTORY_STAFF')).email)).accessToken,
      );
      await ctx.http
        .post('/api/v1/shifts')
        .set(stockStaff)
        .send({ registerId: s.registerId, openingFloatMinor: 0 })
        .expect(403);
      await ctx.http.get('/api/v1/sales').set(stockStaff).expect(403);

      const cashier = bearer(
        (await login(ctx, (await addMember(ctx, s.tenantId, 'CASHIER')).email)).accessToken,
      );
      const listed = await ctx.http.get('/api/v1/sales').set(cashier).expect(200);
      expect(listed.body.items).toEqual([]);
      const all = await ctx.http.get('/api/v1/sales').set(s.auth).expect(200);
      expect(all.body.items).toHaveLength(1);
      await ctx.http.get(`/api/v1/sales/${all.body.items[0].id}`).set(cashier).expect(404);
    });

    it('filters sales by business day in the tenant timezone and by number', async () => {
      const s = await store();
      const shift = await openShift(s);
      const sale = (
        await sell(s, shift.id, {
          lines: [{ variantId: s.ids.rice, quantity: '1' }],
          payments: [{ method: 'CASH', amountMinor: 32_000 }],
          expectedTotalMinor: 32_000,
        }).expect(201)
      ).body;
      const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Colombo' }).format(
        new Date(sale.createdAt),
      );
      const hit = await ctx.http
        .get('/api/v1/sales')
        .query({ from: today, to: today, q: 'inv-0000' })
        .set(s.auth)
        .expect(200);
      expect(hit.body.items.map((x: { id: string }) => x.id)).toEqual([sale.id]);
      const miss = await ctx.http
        .get('/api/v1/sales')
        .query({ to: '2020-01-01' })
        .set(s.auth)
        .expect(200);
      expect(miss.body.items).toEqual([]);
    });
  });

  describe('tenant isolation', () => {
    it('hides sales, shifts and tax rates from other tenants and keeps sales immutable', async () => {
      const a = await store();
      const shift = await openShift(a);
      const sale = (
        await sell(a, shift.id, {
          lines: [{ variantId: a.ids.rice, quantity: '1' }],
          payments: [{ method: 'CASH', amountMinor: 32_000 }],
          expectedTotalMinor: 32_000,
        }).expect(201)
      ).body;

      const b = await store();
      await ctx.http.get(`/api/v1/sales/${sale.id}`).set(b.auth).expect(404);
      await ctx.http.get(`/api/v1/shifts/${shift.id}`).set(b.auth).expect(404);
      expect((await ctx.http.get('/api/v1/sales').set(b.auth).expect(200)).body.items).toEqual([]);
      // Using another tenant's shift or items fails as "not found".
      const foreign = await sell(b, shift.id, {
        lines: [{ variantId: a.ids.rice, quantity: '1' }],
        payments: [{ method: 'CASH', amountMinor: 32_000 }],
        expectedTotalMinor: 32_000,
      }).expect(400);
      expect(foreign.body.error.issues).toEqual([
        { path: 'shiftId', message: 'validation.shift.not_found' },
      ]);
      await ctx.http
        .patch(`/api/v1/tax-rates/${a.vat.id}`)
        .set(b.auth)
        .send({ version: 1, rateBp: 0 })
        .expect(404);

      // Row-level security and grants, below the API.
      const seen = await ctx.prisma.withTenant(b.tenantId, (tx) =>
        tx.sale.count({ where: { id: sale.id } }),
      );
      expect(seen).toBe(0);
      await expect(
        ctx.prisma.withTenant(a.tenantId, (tx) =>
          tx.sale.updateMany({ where: { id: sale.id }, data: { totalMinor: 1n } }),
        ),
      ).rejects.toThrow(/permission denied/);
      await expect(
        ctx.prisma.withTenant(a.tenantId, (tx) =>
          tx.salePayment.deleteMany({ where: { saleId: sale.id } }),
        ),
      ).rejects.toThrow(/permission denied/);
    });
  });
});
