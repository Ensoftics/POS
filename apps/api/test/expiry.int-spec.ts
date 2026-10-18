import { randomUUID } from 'node:crypto';
import { localDateIn } from '@pos/domain';
import {
  bearer,
  createTestContext,
  onboardedTenant,
  resetDatabase,
  type TestContext,
} from './helpers';

const PRICE = 125_000;

describe('Expired stock at the till (integration)', () => {
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

  /** A cosmetics shop with 2 of an expired batch and 3 of a good batch of one lipstick. */
  async function shop(goodExpiry = '2030-12-31') {
    const session = await onboardedTenant(ctx, 'COSMETICS');
    const auth = bearer(session.accessToken);
    const branch = (await ctx.http.get('/api/v1/branches').set(auth).expect(200)).body.items[0];
    const product = (
      await ctx.http
        .post('/api/v1/products')
        .set(auth)
        .send({
          name: 'Matte Lipstick',
          unit: 'piece',
          variants: [{ sku: 'LIP-RUBY', attributes: { shade: 'Ruby' }, priceMinor: PRICE }],
        })
        .expect(201)
    ).body;
    const variantId = product.variants[0].id as string;
    await ctx.http
      .post('/api/v1/goods-receipts')
      .set(auth)
      .send({
        id: randomUUID(),
        branchId: branch.id,
        lines: [
          {
            variantId,
            quantity: '2',
            unitCostMinor: 50_000,
            batchNumber: 'OLD',
            expiryDate: '2025-01-31',
          },
          {
            variantId,
            quantity: '3',
            unitCostMinor: 50_000,
            batchNumber: 'NEW',
            expiryDate: goodExpiry,
          },
        ],
      })
      .expect(201);
    const shift = (
      await ctx.http
        .post('/api/v1/shifts')
        .set(auth)
        .send({ registerId: branch.registers[0].id, openingFloatMinor: 0 })
        .expect(201)
    ).body;
    const level = async (batchNumber: string) => {
      const row = await ctx.owner.stockLevel.findFirstOrThrow({
        where: { tenantId: session.tenant.id, variantId, batch: { batchNumber } },
      });
      return row.quantity.toString();
    };
    return { auth, shiftId: shift.id as string, variantId, level };
  }

  const sale = (shiftId: string, variantId: string, quantity: number, offline = false) => ({
    id: randomUUID(),
    shiftId,
    lines: [{ variantId, quantity: String(quantity) }],
    payments: [{ method: 'CASH', amountMinor: PRICE * quantity }],
    expectedTotalMinor: PRICE * quantity,
    ...(offline
      ? {
          offline: {
            capturedAt: new Date(Date.now() - 3_600_000).toISOString(),
            pricesIncludeTax: true,
            lines: [{ unitPriceMinor: PRICE, taxRateBp: 0 }],
          },
        }
      : {}),
  });

  it('sells from good batches and refuses when only expired stock is left', async () => {
    const s = await shop();
    await ctx.http
      .post('/api/v1/sales')
      .set(s.auth)
      .send(sale(s.shiftId, s.variantId, 3))
      .expect(201);
    expect(await s.level('NEW')).toBe('0');
    expect(await s.level('OLD')).toBe('2');

    const refused = await ctx.http
      .post('/api/v1/sales')
      .set(s.auth)
      .send(sale(s.shiftId, s.variantId, 1))
      .expect(409);
    expect(refused.body.error.code).toBe('EXPIRED_STOCK');
    expect(refused.body.error.message).toContain('Matte Lipstick (LIP-RUBY)');
    expect(await s.level('OLD')).toBe('2');
  });

  it('refuses expired stock even where selling without recorded stock is allowed', async () => {
    const s = await shop();
    const settings = (await ctx.http.get('/api/v1/settings').set(s.auth).expect(200)).body;
    await ctx.http
      .patch('/api/v1/settings')
      .set(s.auth)
      .send({ version: settings.version, allowNegativeStock: true })
      .expect(200);
    const refused = await ctx.http
      .post('/api/v1/sales')
      .set(s.auth)
      .send(sale(s.shiftId, s.variantId, 4))
      .expect(409);
    expect(refused.body.error.code).toBe('EXPIRED_STOCK');
  });

  it('treats the expiry date itself as the last day of sale', async () => {
    const today = localDateIn(new Date(), 'Asia/Colombo');
    const s = await shop(today);
    await ctx.http
      .post('/api/v1/sales')
      .set(s.auth)
      .send(sale(s.shiftId, s.variantId, 3))
      .expect(201);
    expect(await s.level('NEW')).toBe('0');
  });

  it('records offline sales of expired stock and flags them for review', async () => {
    const s = await shop();
    await ctx.http
      .post('/api/v1/sales')
      .set(s.auth)
      .send(sale(s.shiftId, s.variantId, 4, true))
      .expect(201);
    expect(await s.level('NEW')).toBe('0');
    expect(await s.level('OLD')).toBe('1');

    const conflicts = await ctx.http.get('/api/v1/sale-conflicts').set(s.auth).expect(200);
    expect(conflicts.body.items).toHaveLength(1);
    expect(conflicts.body.items[0]).toMatchObject({
      type: 'EXPIRED_SOLD',
      detail: {
        lines: [{ sku: 'LIP-RUBY', batchNumber: 'OLD', expiryDate: '2025-01-31', quantity: '1' }],
      },
    });
  });
});
