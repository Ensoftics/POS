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

describe('Offline sales and catalogue sync (integration)', () => {
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

  /** A shop with two products (100.00 and 250.00, no tax), 5 of each, a cashier and an open shift. */
  async function shop() {
    const session = await onboardedTenant(ctx, 'GENERAL_RETAIL');
    const owner = bearer(session.accessToken);
    const tenantId = session.tenant.id as string;
    const branch = (await ctx.http.get('/api/v1/branches').set(owner).expect(200)).body.items[0];
    const create = async (name: string, sku: string, priceMinor: number) =>
      (
        await ctx.http
          .post('/api/v1/products')
          .set(owner)
          .send({ name, unit: 'piece', variants: [{ sku, priceMinor }] })
          .expect(201)
      ).body;
    const pen = await create('Blue Pen', 'PEN', 10_000);
    const book = await create('Note Book', 'BOOK', 25_000);
    await ctx.http
      .post('/api/v1/goods-receipts')
      .set(owner)
      .send({
        id: randomUUID(),
        branchId: branch.id,
        lines: [pen, book].map((p) => ({
          variantId: p.variants[0].id,
          quantity: '5',
          unitCostMinor: 1,
        })),
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
    return { tenantId, owner, cashier, shift, branchId: branch.id as string, pen, book };
  }
  type Shop = Awaited<ReturnType<typeof shop>>;

  /** A sale as an offline till would send it: priced by the till. */
  function offlineSale(
    s: Shop,
    lines: Array<{
      variantId: string;
      quantity: string;
      unitPriceMinor: number;
      taxRateBp?: number;
    }>,
    extra: Record<string, unknown> = {},
  ) {
    const total = lines.reduce((sum, l) => sum + l.unitPriceMinor * Number(l.quantity), 0);
    return {
      id: randomUUID(),
      shiftId: s.shift.id,
      lines: lines.map((l) => ({ variantId: l.variantId, quantity: l.quantity })),
      payments: [{ method: 'CASH', amountMinor: total }],
      expectedTotalMinor: total,
      offline: {
        capturedAt: new Date(Date.now() - 3_600_000).toISOString(),
        pricesIncludeTax: true,
        lines: lines.map((l) => ({
          unitPriceMinor: l.unitPriceMinor,
          taxRateBp: l.taxRateBp ?? 0,
        })),
      },
      ...extra,
    };
  }

  const stockOf = async (s: Shop, sku: string) =>
    (
      await ctx.http
        .get('/api/v1/stock')
        .query({ branchId: s.branchId, q: sku })
        .set(s.owner)
        .expect(200)
    ).body.items[0].quantity as string;

  describe('catalogue sync', () => {
    it('pages through everything, then returns only changes, including archived items', async () => {
      const s = await shop();
      const pull = (cursor?: string, limit = 1) =>
        ctx.http
          .get('/api/v1/sync/catalog')
          .query({ ...(cursor ? { cursor } : {}), limit })
          .set(s.cashier)
          .expect(200)
          .then((r) => r.body);

      const first = await pull();
      expect(first).toMatchObject({
        hasMore: true,
        items: [expect.objectContaining({ sku: 'PEN', priceMinor: 10_000, active: true })],
      });
      const second = await pull(first.cursor);
      expect(second).toMatchObject({
        hasMore: false,
        items: [expect.objectContaining({ sku: 'BOOK' })],
      });

      // Nothing changed: an overlap may re-send recent items, never anything unknown.
      const quiet = await pull(second.cursor, 100);
      expect(quiet.hasMore).toBe(false);

      // A price change and an archive show up on the next sync.
      const variant = s.pen.variants[0];
      await ctx.http
        .patch(`/api/v1/variants/${variant.id}`)
        .set(s.owner)
        .send({ version: variant.version, priceMinor: 12_000 })
        .expect(200);
      await ctx.http
        .patch(`/api/v1/products/${s.book.id}`)
        .set(s.owner)
        .send({ version: s.book.version, status: 'ARCHIVED' })
        .expect(200);
      const changes = await pull(quiet.cursor, 100);
      expect(changes.items).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ sku: 'PEN', priceMinor: 12_000, active: true }),
          expect.objectContaining({ sku: 'BOOK', active: false }),
        ]),
      );

      await ctx.http
        .get('/api/v1/sync/catalog')
        .query({ cursor: 'garbage' })
        .set(s.cashier)
        .expect(400);
      // Other businesses' items never appear.
      const other = await shop();
      const all = await ctx.http
        .get('/api/v1/sync/catalog')
        .query({ limit: 100 })
        .set(other.cashier)
        .expect(200);
      expect(all.body.items.map((i: { productId: string }) => i.productId).sort()).toEqual(
        [other.pen.id, other.book.id].sort(),
      );
    });
  });

  describe('offline sales', () => {
    it('records the price the customer paid and flags the difference', async () => {
      const s = await shop();
      const variant = s.pen.variants[0];
      await ctx.http
        .patch(`/api/v1/variants/${variant.id}`)
        .set(s.owner)
        .send({ version: variant.version, priceMinor: 12_000 })
        .expect(200);
      const body = offlineSale(s, [
        { variantId: variant.id, quantity: '2', unitPriceMinor: 10_000 },
      ]);
      const sale = (await ctx.http.post('/api/v1/sales').set(s.cashier).send(body).expect(201))
        .body;
      expect(sale).toMatchObject({
        totalMinor: 20_000,
        capturedOffline: true,
        createdAt: body.offline.capturedAt,
        conflicts: [{ type: 'PRICE_CHANGED', resolved: false }],
      });
      expect(sale.lines[0].unitPriceMinor).toBe(10_000);
      expect(sale.syncedAt).not.toBeNull();

      const list = await ctx.http.get('/api/v1/sale-conflicts').set(s.owner).expect(200);
      expect(list.body.items[0]).toMatchObject({
        type: 'PRICE_CHANGED',
        saleNumber: sale.number,
        detail: { lines: [{ sku: 'PEN', chargedMinor: 10_000, currentMinor: 12_000 }] },
      });
    });

    it('dates sale lines with their sale, which the database enforces', async () => {
      const s = await shop();
      const body = offlineSale(s, [
        { variantId: s.pen.variants[0].id, quantity: '1', unitPriceMinor: 10_000 },
      ]);
      const sale = (await ctx.http.post('/api/v1/sales').set(s.cashier).send(body).expect(201))
        .body;
      const line = await ctx.owner.saleLine.findFirstOrThrow({ where: { saleId: sale.id } });
      // Reports by date read lines directly: an offline line carries the capture time.
      expect(line.createdAt.toISOString()).toBe(body.offline.capturedAt);
      expect(line.branchId).toBe(s.branchId);

      // Whatever an insert says, the line takes its sale's date and branch.
      const id = '0f0f0f0f-0f0f-4f0f-8f0f-0f0f0f0f0f0f';
      await ctx.owner.$executeRaw`
        INSERT INTO sale_lines (id, tenant_id, sale_id, position, variant_id, product_name, sku,
          variant_label, unit, quantity, unit_price_minor, line_discount_minor, cart_discount_minor,
          tax_rate_bp, tax_minor, total_minor, created_at, branch_id)
        SELECT ${id}::uuid, tenant_id, sale_id, 9, variant_id, product_name, sku, variant_label,
          unit, quantity, unit_price_minor, 0, 0, 0, 0, 0, '2000-01-01', gen_random_uuid()
        FROM sale_lines WHERE id = ${line.id}::uuid`;
      const forced = await ctx.owner.saleLine.findUniqueOrThrow({ where: { id } });
      expect(forced.createdAt).toEqual(line.createdAt);
      expect(forced.branchId).toBe(s.branchId);
    });

    it('takes stock even when records are short, and flags it', async () => {
      const s = await shop();
      const body = offlineSale(s, [
        { variantId: s.pen.variants[0].id, quantity: '7', unitPriceMinor: 10_000 },
      ]);
      const sale = (await ctx.http.post('/api/v1/sales').set(s.cashier).send(body).expect(201))
        .body;
      expect(sale.conflicts.map((c: { type: string }) => c.type)).toEqual(['STOCK_SHORT']);
      expect(await stockOf(s, 'PEN')).toBe('-2');
      // Online sales still respect the policy.
      const online = {
        ...body,
        id: randomUUID(),
        offline: undefined,
        expectedTotalMinor: 10_000,
        lines: [{ variantId: s.pen.variants[0].id, quantity: '1' }],
        payments: [{ method: 'CASH', amountMinor: 10_000 }],
      };
      expect(
        (await ctx.http.post('/api/v1/sales').set(s.cashier).send(online).expect(409)).body.error
          .code,
      ).toBe('INSUFFICIENT_STOCK');
    });

    it('accepts sales from a shift closed meanwhile, archived items and unapproved discounts — all flagged', async () => {
      const s = await shop();
      const settings = (await ctx.http.get('/api/v1/settings').set(s.owner).expect(200)).body;
      await ctx.http
        .patch('/api/v1/settings')
        .set(s.owner)
        .send({ version: settings.version, checkout: { discountApprovalBp: 1000 } })
        .expect(200);
      await ctx.http
        .patch(`/api/v1/products/${s.book.id}`)
        .set(s.owner)
        .send({ version: s.book.version, status: 'ARCHIVED' })
        .expect(200);
      const shift = (await ctx.http.get(`/api/v1/shifts/${s.shift.id}`).set(s.cashier).expect(200))
        .body;
      await ctx.http
        .post(`/api/v1/shifts/${s.shift.id}/close`)
        .set(s.cashier)
        .send({ version: shift.version, countedCashMinor: 0 })
        .expect(200);

      const body = offlineSale(
        s,
        [{ variantId: s.book.variants[0].id, quantity: '1', unitPriceMinor: 25_000 }],
        {
          discount: { kind: 'PERCENT', value: 5000 },
          expectedTotalMinor: 12_500,
          payments: [{ method: 'CASH', amountMinor: 12_500 }],
        },
      );
      const sale = (await ctx.http.post('/api/v1/sales').set(s.cashier).send(body).expect(201))
        .body;
      expect(sale.conflicts.map((c: { type: string }) => c.type).sort()).toEqual([
        'APPROVAL_MISSING',
        'ITEM_ARCHIVED',
        'SHIFT_CLOSED',
      ]);
      expect(sale.approvedByName).toBeNull();

      // The same sale sent online would have been refused.
      const online = { ...body, id: randomUUID(), offline: undefined };
      expect(
        (await ctx.http.post('/api/v1/sales').set(s.cashier).send(online).expect(409)).body.error
          .code,
      ).toBe('SHIFT_NOT_OPEN');
    });

    it('refuses offline sales whose own arithmetic is wrong or that are too old', async () => {
      const s = await shop();
      const wrong = offlineSale(
        s,
        [{ variantId: s.pen.variants[0].id, quantity: '1', unitPriceMinor: 10_000 }],
        { expectedTotalMinor: 9_000, payments: [{ method: 'CASH', amountMinor: 9_000 }] },
      );
      expect(
        (await ctx.http.post('/api/v1/sales').set(s.cashier).send(wrong).expect(409)).body.error
          .code,
      ).toBe('TOTAL_MISMATCH');
      const old = offlineSale(s, [
        { variantId: s.pen.variants[0].id, quantity: '1', unitPriceMinor: 10_000 },
      ]);
      old.offline.capturedAt = new Date(Date.now() - 40 * 86_400_000).toISOString();
      const res = await ctx.http.post('/api/v1/sales').set(s.cashier).send(old).expect(400);
      expect(res.body.error.issues).toEqual([
        { path: 'offline.capturedAt', message: 'validation.offline.captured_at' },
      ]);
      const mismatched = offlineSale(s, [
        { variantId: s.pen.variants[0].id, quantity: '1', unitPriceMinor: 10_000 },
      ]);
      mismatched.offline.lines = [];
      await ctx.http.post('/api/v1/sales').set(s.cashier).send(mismatched).expect(400);
    });

    it('treats a re-send from the outbox of a sale that already reached the server as a retry', async () => {
      const s = await shop();
      const online = {
        id: randomUUID(),
        shiftId: s.shift.id,
        lines: [{ variantId: s.pen.variants[0].id, quantity: '1' }],
        payments: [{ method: 'CASH', amountMinor: 10_000 }],
        expectedTotalMinor: 10_000,
      };
      const first = await ctx.http.post('/api/v1/sales').set(s.cashier).send(online).expect(201);
      const resend = await ctx.http
        .post('/api/v1/sales')
        .set(s.cashier)
        .send({
          ...online,
          offline: {
            capturedAt: new Date().toISOString(),
            pricesIncludeTax: true,
            lines: [{ unitPriceMinor: 10_000, taxRateBp: 0 }],
          },
        })
        .expect(200);
      expect(resend.body).toMatchObject({ number: first.body.number, capturedOffline: false });
      expect(await stockOf(s, 'PEN')).toBe('4');
    });
  });

  describe('review', () => {
    it('lets managers resolve conflicts once; cashiers cannot see the queue', async () => {
      const s = await shop();
      await ctx.http
        .post('/api/v1/sales')
        .set(s.cashier)
        .send(
          offlineSale(s, [
            { variantId: s.pen.variants[0].id, quantity: '6', unitPriceMinor: 10_000 },
          ]),
        )
        .expect(201);
      await ctx.http.get('/api/v1/sale-conflicts').set(s.cashier).expect(403);
      const open = (await ctx.http.get('/api/v1/sale-conflicts').set(s.owner).expect(200)).body
        .items;
      expect(open).toHaveLength(1);
      const resolved = await ctx.http
        .post(`/api/v1/sale-conflicts/${open[0].id}/resolve`)
        .set(s.owner)
        .send({ note: 'Counted shelf; one pen was in the back room.' })
        .expect(200);
      expect(resolved.body).toMatchObject({
        resolvedByName: expect.any(String),
        resolutionNote: expect.stringContaining('back room'),
      });
      await ctx.http
        .post(`/api/v1/sale-conflicts/${open[0].id}/resolve`)
        .set(s.owner)
        .send({ note: 'again' })
        .expect(409);
      expect(
        (await ctx.http.get('/api/v1/sale-conflicts').set(s.owner).expect(200)).body.items,
      ).toEqual([]);
      expect(
        (
          await ctx.http
            .get('/api/v1/sale-conflicts')
            .query({ status: 'RESOLVED' })
            .set(s.owner)
            .expect(200)
        ).body.items,
      ).toHaveLength(1);

      const other = await shop();
      await ctx.http
        .post(`/api/v1/sale-conflicts/${open[0].id}/resolve`)
        .set(other.owner)
        .send({ note: 'x' })
        .expect(404);
      await expect(
        ctx.prisma.withTenant(s.tenantId, (tx) => tx.saleConflict.deleteMany({})),
      ).rejects.toThrow(/permission denied/);
    });
  });
});
