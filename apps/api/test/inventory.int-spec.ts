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

describe('Purchasing and inventory (integration)', () => {
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

  /** A textile shop (part quantities allowed, no batches) with one product, two variants and a supplier. */
  async function shop(type: 'TEXTILE' | 'COSMETICS' = 'TEXTILE') {
    const session = await onboardedTenant(ctx, type);
    const auth = bearer(session.accessToken);
    const branches = (await ctx.http.get('/api/v1/branches').set(auth).expect(200)).body.items;
    const product = (
      await ctx.http
        .post('/api/v1/products')
        .set(auth)
        .send({
          name: type === 'TEXTILE' ? 'Cotton Fabric' : 'Face Cream',
          unit: type === 'TEXTILE' ? 'metre' : 'piece',
          variants:
            type === 'TEXTILE'
              ? [
                  {
                    sku: 'COT-W',
                    attributes: { colour: 'White' },
                    priceMinor: 45000,
                    reorderLevel: '10',
                  },
                  { sku: 'COT-B', attributes: { colour: 'Blue' }, priceMinor: 47500 },
                ]
              : [{ sku: 'CRM-1', priceMinor: 250000 }],
        })
        .expect(201)
    ).body;
    const supplier = (
      await ctx.http
        .post('/api/v1/suppliers')
        .set(auth)
        .send({ name: 'Lanka Mills', phone: '+94 11 234 5678' })
        .expect(201)
    ).body;
    return {
      session,
      auth,
      branchId: branches[0].id as string,
      product,
      variants: product.variants as Array<{ id: string; sku: string }>,
      supplier,
    };
  }

  const variantId = (s: Awaited<ReturnType<typeof shop>>, sku: string) =>
    s.variants.find((v) => v.sku === sku)!.id;

  async function stockOf(s: Awaited<ReturnType<typeof shop>>, branchId: string, sku: string) {
    const page = await ctx.http
      .get('/api/v1/stock')
      .query({ branchId, q: sku })
      .set(s.auth)
      .expect(200);
    return page.body.items.find((row: { sku: string }) => row.sku === sku);
  }

  function receive(s: Awaited<ReturnType<typeof shop>>, body: Record<string, unknown>) {
    return ctx.http
      .post('/api/v1/goods-receipts')
      .set(s.auth)
      .send({ id: randomUUID(), branchId: s.branchId, ...body });
  }

  /** Ledger invariant: for every balance row, the sum of its movements equals the balance. */
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

  describe('suppliers', () => {
    it('creates, searches and protects unique names', async () => {
      const s = await shop();
      const dup = await ctx.http
        .post('/api/v1/suppliers')
        .set(s.auth)
        .send({ name: 'lanka mills' })
        .expect(409);
      expect(dup.body.error.code).toBe('DUPLICATE_NAME');
      const found = await ctx.http
        .get('/api/v1/suppliers')
        .query({ q: 'mills' })
        .set(s.auth)
        .expect(200);
      expect(found.body.items.map((x: { name: string }) => x.name)).toEqual(['Lanka Mills']);
    });

    it('is not available to cashiers', async () => {
      const s = await shop();
      const cashier = await login(
        ctx,
        (await addMember(ctx, s.session.tenant.id, 'CASHIER')).email,
      );
      await ctx.http.get('/api/v1/suppliers').set(bearer(cashier.accessToken)).expect(403);
      // Cashiers can still see stock levels.
      await ctx.http
        .get('/api/v1/stock')
        .query({ branchId: s.branchId })
        .set(bearer(cashier.accessToken))
        .expect(200);
      await ctx.http
        .post('/api/v1/stock-adjustments')
        .set(bearer(cashier.accessToken))
        .send({
          id: randomUUID(),
          branchId: s.branchId,
          reason: 'FOUND',
          lines: [{ variantId: s.variants[0]!.id, quantity: '1' }],
        })
        .expect(403);
    });
  });

  describe('purchase orders and receiving', () => {
    it('runs draft -> ordered -> partially received -> received with stock and cost recorded', async () => {
      const s = await shop();
      const white = variantId(s, 'COT-W');
      const blue = variantId(s, 'COT-B');
      const draft = (
        await ctx.http
          .post('/api/v1/purchase-orders')
          .set(s.auth)
          .send({
            supplierId: s.supplier.id,
            branchId: s.branchId,
            lines: [
              { variantId: white, quantity: '100', unitCostMinor: 30000 },
              { variantId: blue, quantity: '50.5', unitCostMinor: 31000 },
            ],
          })
          .expect(201)
      ).body;
      expect(draft).toMatchObject({
        number: 'PO-000001',
        status: 'DRAFT',
        totalMinor: 30000 * 100 + 31000 * 50.5,
      });

      // Receiving against a draft is refused.
      const early = await receive(s, {
        purchaseOrderId: draft.id,
        lines: [{ variantId: white, quantity: '1', unitCostMinor: 30000 }],
      }).expect(409);
      expect(early.body.error.code).toBe('INVALID_STATE');

      const ordered = (
        await ctx.http
          .post(`/api/v1/purchase-orders/${draft.id}/order`)
          .set(s.auth)
          .send({ version: draft.version })
          .expect(200)
      ).body;
      expect(ordered.status).toBe('ORDERED');
      await ctx.http
        .patch(`/api/v1/purchase-orders/${draft.id}`)
        .set(s.auth)
        .send({ version: ordered.version, notes: 'x' })
        .expect(409);

      const first = await receive(s, {
        purchaseOrderId: draft.id,
        supplierReference: 'INV-778',
        lines: [{ variantId: white, quantity: '60', unitCostMinor: 30000 }],
      }).expect(201);
      expect(first.body).toMatchObject({
        number: 'GRN-000001',
        supplierName: 'Lanka Mills',
        purchaseOrderNumber: 'PO-000001',
        totalMinor: 1800000,
      });
      expect(
        (await ctx.http.get(`/api/v1/purchase-orders/${draft.id}`).set(s.auth).expect(200)).body
          .status,
      ).toBe('PARTIALLY_RECEIVED');

      await receive(s, {
        purchaseOrderId: draft.id,
        lines: [
          { variantId: white, quantity: '40', unitCostMinor: 30000 },
          { variantId: blue, quantity: '50.5', unitCostMinor: 31000 },
        ],
      }).expect(201);
      const done = (
        await ctx.http.get(`/api/v1/purchase-orders/${draft.id}`).set(s.auth).expect(200)
      ).body;
      expect(done.status).toBe('RECEIVED');
      expect(done.lines.map((l: { quantityReceived: string }) => l.quantityReceived)).toEqual([
        '100',
        '50.5',
      ]);

      expect((await stockOf(s, s.branchId, 'COT-W')).quantity).toBe('100');
      expect((await stockOf(s, s.branchId, 'COT-B')).quantity).toBe('50.5');
      const movements = await ctx.http
        .get('/api/v1/stock/movements')
        .query({ variantId: white })
        .set(s.auth)
        .expect(200);
      expect(
        movements.body.items.map(
          (m: { type: string; balanceAfter: string; unitCostMinor: number }) => [
            m.type,
            m.balanceAfter,
            m.unitCostMinor,
          ],
        ),
      ).toEqual([
        ['RECEIPT', '100', 30000],
        ['RECEIPT', '60', 30000],
      ]);
      await expectLedgerConsistent(s.session.tenant.id);
    });

    it('rejects items that are not on the order', async () => {
      const s = await shop();
      const order = (
        await ctx.http
          .post('/api/v1/purchase-orders')
          .set(s.auth)
          .send({
            supplierId: s.supplier.id,
            branchId: s.branchId,
            lines: [{ variantId: variantId(s, 'COT-W'), quantity: '1', unitCostMinor: 1 }],
          })
          .expect(201)
      ).body;
      await ctx.http
        .post(`/api/v1/purchase-orders/${order.id}/order`)
        .set(s.auth)
        .send({ version: 1 })
        .expect(200);
      const bad = await receive(s, {
        purchaseOrderId: order.id,
        lines: [{ variantId: variantId(s, 'COT-B'), quantity: '1', unitCostMinor: 1 }],
      }).expect(400);
      expect(bad.body.error.issues).toContainEqual({
        path: 'lines.0.variantId',
        message: 'validation.purchase_order.item_not_ordered',
      });
    });

    it('treats a repeated receipt id as the same receipt (no double stock)', async () => {
      const s = await shop();
      const id = randomUUID();
      const body = {
        id,
        branchId: s.branchId,
        lines: [{ variantId: variantId(s, 'COT-W'), quantity: '5', unitCostMinor: 100 }],
      };
      const first = await ctx.http
        .post('/api/v1/goods-receipts')
        .set(s.auth)
        .send(body)
        .expect(201);
      const retry = await ctx.http
        .post('/api/v1/goods-receipts')
        .set(s.auth)
        .send(body)
        .expect(200);
      expect(retry.body.number).toBe(first.body.number);
      // Even simultaneous retries post once.
      const id2 = randomUUID();
      const results = await Promise.all(
        [1, 2].map(() =>
          ctx.http
            .post('/api/v1/goods-receipts')
            .set(s.auth)
            .send({ ...body, id: id2 }),
        ),
      );
      expect(results.filter((r) => r.status === 201)).toHaveLength(1);
      expect((await stockOf(s, s.branchId, 'COT-W')).quantity).toBe('10');
      await expectLedgerConsistent(s.session.tenant.id);
    });

    it('requires batch and expiry for cosmetics and refuses conflicting expiry dates', async () => {
      const s = await shop('COSMETICS');
      const cream = variantId(s, 'CRM-1');
      const missing = await receive(s, {
        lines: [{ variantId: cream, quantity: '5', unitCostMinor: 1 }],
      }).expect(400);
      expect(missing.body.error.issues).toEqual(
        expect.arrayContaining([
          { path: 'lines.0.batchNumber', message: 'validation.batch.required' },
          { path: 'lines.0.expiryDate', message: 'validation.batch.expiry_required' },
        ]),
      );
      await receive(s, {
        lines: [
          {
            variantId: cream,
            quantity: '5',
            unitCostMinor: 1,
            batchNumber: 'B1',
            expiryDate: '2027-01-31',
          },
        ],
      }).expect(201);
      const clash = await receive(s, {
        lines: [
          {
            variantId: cream,
            quantity: '1',
            unitCostMinor: 1,
            batchNumber: 'B1',
            expiryDate: '2027-06-30',
          },
        ],
      }).expect(400);
      expect(clash.body.error.issues).toContainEqual({
        path: 'lines.0.expiryDate',
        message: 'validation.batch.expiry_mismatch',
      });
    });

    it('rejects part quantities for whole-unit businesses', async () => {
      const s = await shop('COSMETICS');
      const bad = await receive(s, {
        lines: [
          {
            variantId: variantId(s, 'CRM-1'),
            quantity: '1.5',
            unitCostMinor: 1,
            batchNumber: 'B',
            expiryDate: '2027-01-01',
          },
        ],
      }).expect(400);
      expect(bad.body.error.issues).toContainEqual({
        path: 'lines.0.quantity',
        message: 'validation.quantity.fraction_not_allowed',
      });
    });
  });

  describe('adjustments', () => {
    it('never lets stock go below zero, and writes nothing when refused', async () => {
      const s = await shop();
      const white = variantId(s, 'COT-W');
      await receive(s, { lines: [{ variantId: white, quantity: '3', unitCostMinor: 1 }] }).expect(
        201,
      );
      const refused = await ctx.http
        .post('/api/v1/stock-adjustments')
        .set(s.auth)
        .send({
          id: randomUUID(),
          branchId: s.branchId,
          reason: 'DAMAGED',
          lines: [{ variantId: white, quantity: '-3.5' }],
        })
        .expect(409);
      expect(refused.body.error.code).toBe('INSUFFICIENT_STOCK');
      expect((await stockOf(s, s.branchId, 'COT-W')).quantity).toBe('3');
      expect(await ctx.owner.stockAdjustment.count()).toBe(0);
    });

    it('lets only one of two concurrent write-offs take the last stock', async () => {
      const s = await shop();
      const white = variantId(s, 'COT-W');
      await receive(s, { lines: [{ variantId: white, quantity: '5', unitCostMinor: 1 }] }).expect(
        201,
      );
      const results = await Promise.all(
        [1, 2].map(() =>
          ctx.http
            .post('/api/v1/stock-adjustments')
            .set(s.auth)
            .send({
              id: randomUUID(),
              branchId: s.branchId,
              reason: 'LOST',
              lines: [{ variantId: white, quantity: '-5' }],
            }),
        ),
      );
      expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
      expect((await stockOf(s, s.branchId, 'COT-W')).quantity).toBe('0');
      await expectLedgerConsistent(s.session.tenant.id);
    });

    it('takes expiring batches first', async () => {
      const s = await shop('COSMETICS');
      const cream = variantId(s, 'CRM-1');
      await receive(s, {
        lines: [
          {
            variantId: cream,
            quantity: '5',
            unitCostMinor: 1,
            batchNumber: 'LATE',
            expiryDate: '2028-01-01',
          },
          {
            variantId: cream,
            quantity: '2',
            unitCostMinor: 1,
            batchNumber: 'SOON',
            expiryDate: '2026-12-01',
          },
        ],
      }).expect(201);
      const adjustment = await ctx.http
        .post('/api/v1/stock-adjustments')
        .set(s.auth)
        .send({
          id: randomUUID(),
          branchId: s.branchId,
          reason: 'EXPIRED',
          lines: [{ variantId: cream, quantity: '-3' }],
        })
        .expect(201);
      expect(
        adjustment.body.lines.map((l: { batchNumber: string; quantity: string }) => [
          l.batchNumber,
          l.quantity,
        ]),
      ).toEqual([
        ['SOON', '-2'],
        ['LATE', '-1'],
      ]);
      const row = await stockOf(s, s.branchId, 'CRM-1');
      expect(
        row.batches.map((b: { batchNumber: string; quantity: string }) => [
          b.batchNumber,
          b.quantity,
        ]),
      ).toEqual([['LATE', '4']]);
    });
  });

  describe('transfers', () => {
    it('moves stock out on send, in on receive, and back on cancel', async () => {
      const s = await shop();
      const white = variantId(s, 'COT-W');
      const other = (
        await ctx.http
          .post('/api/v1/branches')
          .set(s.auth)
          .send({ code: 'KANDY', name: 'Kandy' })
          .expect(201)
      ).body.id;
      await receive(s, { lines: [{ variantId: white, quantity: '20', unitCostMinor: 1 }] }).expect(
        201,
      );

      const same = await ctx.http
        .post('/api/v1/stock-transfers')
        .set(s.auth)
        .send({
          id: randomUUID(),
          fromBranchId: s.branchId,
          toBranchId: s.branchId,
          lines: [{ variantId: white, quantity: '1' }],
        })
        .expect(400);
      expect(same.body.error.issues).toContainEqual({
        path: 'toBranchId',
        message: 'validation.transfer.same_branch',
      });

      const sent = (
        await ctx.http
          .post('/api/v1/stock-transfers')
          .set(s.auth)
          .send({
            id: randomUUID(),
            fromBranchId: s.branchId,
            toBranchId: other,
            lines: [{ variantId: white, quantity: '7.5' }],
          })
          .expect(201)
      ).body;
      expect(sent.status).toBe('IN_TRANSIT');
      expect((await stockOf(s, s.branchId, 'COT-W')).quantity).toBe('12.5');
      expect((await stockOf(s, other, 'COT-W')).quantity).toBe('0');

      await ctx.http
        .post(`/api/v1/stock-transfers/${sent.id}/receive`)
        .set(s.auth)
        .send({ version: sent.version })
        .expect(200);
      expect((await stockOf(s, other, 'COT-W')).quantity).toBe('7.5');
      await ctx.http
        .post(`/api/v1/stock-transfers/${sent.id}/receive`)
        .set(s.auth)
        .send({ version: sent.version + 1 })
        .expect(409);

      const second = (
        await ctx.http
          .post('/api/v1/stock-transfers')
          .set(s.auth)
          .send({
            id: randomUUID(),
            fromBranchId: s.branchId,
            toBranchId: other,
            lines: [{ variantId: white, quantity: '2.5' }],
          })
          .expect(201)
      ).body;
      await ctx.http
        .post(`/api/v1/stock-transfers/${second.id}/cancel`)
        .set(s.auth)
        .send({ version: second.version })
        .expect(200);
      expect((await stockOf(s, s.branchId, 'COT-W')).quantity).toBe('12.5');

      const tooMuch = await ctx.http
        .post('/api/v1/stock-transfers')
        .set(s.auth)
        .send({
          id: randomUUID(),
          fromBranchId: s.branchId,
          toBranchId: other,
          lines: [{ variantId: white, quantity: '13' }],
        })
        .expect(409);
      expect(tooMuch.body.error.code).toBe('INSUFFICIENT_STOCK');
      await expectLedgerConsistent(s.session.tenant.id);
    });

    it('lets only one of a concurrent receive and cancel win', async () => {
      const s = await shop();
      const white = variantId(s, 'COT-W');
      const other = (
        await ctx.http
          .post('/api/v1/branches')
          .set(s.auth)
          .send({ code: 'B2', name: 'Two' })
          .expect(201)
      ).body.id;
      await receive(s, { lines: [{ variantId: white, quantity: '4', unitCostMinor: 1 }] }).expect(
        201,
      );
      const sent = (
        await ctx.http
          .post('/api/v1/stock-transfers')
          .set(s.auth)
          .send({
            id: randomUUID(),
            fromBranchId: s.branchId,
            toBranchId: other,
            lines: [{ variantId: white, quantity: '4' }],
          })
          .expect(201)
      ).body;
      const results = await Promise.all([
        ctx.http
          .post(`/api/v1/stock-transfers/${sent.id}/receive`)
          .set(s.auth)
          .send({ version: sent.version }),
        ctx.http
          .post(`/api/v1/stock-transfers/${sent.id}/cancel`)
          .set(s.auth)
          .send({ version: sent.version }),
      ]);
      expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
      const total =
        Number((await stockOf(s, s.branchId, 'COT-W')).quantity) +
        Number((await stockOf(s, other, 'COT-W')).quantity);
      expect(total).toBe(4);
    });
  });

  describe('stock counts', () => {
    it('posts counted minus current stock, including changes made during the count', async () => {
      const s = await shop();
      const white = variantId(s, 'COT-W');
      const blue = variantId(s, 'COT-B');
      await receive(s, {
        lines: [
          { variantId: white, quantity: '10', unitCostMinor: 1 },
          { variantId: blue, quantity: '4', unitCostMinor: 1 },
        ],
      }).expect(201);

      const count = (
        await ctx.http
          .post('/api/v1/stock-counts')
          .set(s.auth)
          .send({ branchId: s.branchId })
          .expect(201)
      ).body;
      expect(
        count.lines.map((l: { sku: string; expectedQuantity: string }) => [
          l.sku,
          l.expectedQuantity,
        ]),
      ).toEqual([
        ['COT-B', '4'],
        ['COT-W', '10'],
      ]);
      await ctx.http
        .post('/api/v1/stock-counts')
        .set(s.auth)
        .send({ branchId: s.branchId })
        .expect(409);

      const counted = (
        await ctx.http
          .patch(`/api/v1/stock-counts/${count.id}`)
          .set(s.auth)
          .send({ version: count.version, lines: [{ variantId: white, countedQuantity: '9' }] })
          .expect(200)
      ).body;
      // Two metres are written off while the count is open.
      await ctx.http
        .post('/api/v1/stock-adjustments')
        .set(s.auth)
        .send({
          id: randomUUID(),
          branchId: s.branchId,
          reason: 'DAMAGED',
          lines: [{ variantId: white, quantity: '-2' }],
        })
        .expect(201);

      const completed = (
        await ctx.http
          .post(`/api/v1/stock-counts/${count.id}/complete`)
          .set(s.auth)
          .send({ version: counted.version })
          .expect(200)
      ).body;
      expect(completed.status).toBe('COMPLETED');
      const whiteLine = completed.lines.find((l: { sku: string }) => l.sku === 'COT-W');
      expect(whiteLine).toMatchObject({ countedQuantity: '9', varianceQuantity: '1' }); // 9 counted - 8 on hand
      expect(
        completed.lines.find((l: { sku: string }) => l.sku === 'COT-B').varianceQuantity,
      ).toBeNull(); // not counted
      expect((await stockOf(s, s.branchId, 'COT-W')).quantity).toBe('9');
      expect((await stockOf(s, s.branchId, 'COT-B')).quantity).toBe('4');
      await expectLedgerConsistent(s.session.tenant.id);
    });
  });

  describe('stock list', () => {
    it('filters low stock and soon-expiring batches', async () => {
      const s = await shop();
      const white = variantId(s, 'COT-W'); // reorder level 10
      await receive(s, { lines: [{ variantId: white, quantity: '4', unitCostMinor: 1 }] }).expect(
        201,
      );
      const low = await ctx.http
        .get('/api/v1/stock')
        .query({ branchId: s.branchId, filter: 'LOW' })
        .set(s.auth)
        .expect(200);
      expect(low.body.items.map((r: { sku: string; low: boolean }) => [r.sku, r.low])).toEqual([
        ['COT-W', true],
      ]);

      const c = await shop('COSMETICS');
      const now = new Date();
      const soon = new Date(now.getTime() + 10 * 86_400_000).toISOString().slice(0, 10);
      await receive(c, {
        lines: [
          {
            variantId: variantId(c, 'CRM-1'),
            quantity: '2',
            unitCostMinor: 1,
            batchNumber: 'S',
            expiryDate: soon,
          },
        ],
      }).expect(201);
      const expiring = await ctx.http
        .get('/api/v1/stock')
        .query({ branchId: c.branchId, filter: 'EXPIRING', days: 30 })
        .set(c.auth)
        .expect(200);
      expect(expiring.body.items[0]).toMatchObject({ sku: 'CRM-1', nextExpiry: soon });
      const notYet = await ctx.http
        .get('/api/v1/stock')
        .query({ branchId: c.branchId, filter: 'EXPIRING', days: 5 })
        .set(c.auth)
        .expect(200);
      expect(notYet.body.items).toEqual([]);
    });
  });

  describe('tenant isolation', () => {
    it('cannot read or post into another tenant’s branches, documents or items', async () => {
      const a = await shop();
      const b = await shop();
      const receiptB = (
        await receive(b, {
          lines: [{ variantId: variantId(b, 'COT-W'), quantity: '5', unitCostMinor: 1 }],
        }).expect(201)
      ).body;

      await ctx.http.get(`/api/v1/goods-receipts/${receiptB.id}`).set(a.auth).expect(404);
      const intoB = await ctx.http
        .post('/api/v1/goods-receipts')
        .set(a.auth)
        .send({
          id: randomUUID(),
          branchId: b.branchId,
          lines: [{ variantId: variantId(a, 'COT-W'), quantity: '1', unitCostMinor: 1 }],
        })
        .expect(400);
      expect(intoB.body.error.issues).toContainEqual({
        path: 'branchId',
        message: 'validation.branch.not_found',
      });
      const foreignItem = await receive(a, {
        lines: [{ variantId: variantId(b, 'COT-W'), quantity: '1', unitCostMinor: 1 }],
      }).expect(400);
      expect(foreignItem.body.error.issues).toContainEqual({
        path: 'lines.0.variantId',
        message: 'validation.item.not_found',
      });
      // Re-using another tenant's document id cannot reveal or overwrite it.
      const reuse = await ctx.http
        .post('/api/v1/goods-receipts')
        .set(a.auth)
        .send({
          id: receiptB.id,
          branchId: a.branchId,
          lines: [{ variantId: variantId(a, 'COT-W'), quantity: '1', unitCostMinor: 1 }],
        });
      expect(reuse.status).not.toBe(200);
      expect(
        (await ctx.http.get('/api/v1/stock/movements').set(a.auth).expect(200)).body.items,
      ).toEqual([]);
    });

    it('keeps the stock ledger append-only and invisible without tenant context', async () => {
      const s = await shop();
      await receive(s, {
        lines: [{ variantId: variantId(s, 'COT-W'), quantity: '1', unitCostMinor: 1 }],
      }).expect(201);
      expect(await ctx.prisma.stockMovement.count()).toBe(0);
      expect(await ctx.prisma.stockLevel.count()).toBe(0);
      await expect(
        ctx.prisma.withTenant(s.session.tenant.id, (tx) => tx.stockMovement.deleteMany({})),
      ).rejects.toThrow(/permission denied/);
    });
  });
});
