import { ApiError } from '@pos/api-client';
import type { CatalogItem, CreateSaleRequest, Sale } from '@pos/contracts';
import { addToCart, emptyCart } from '@pos/domain';
import { describe, expect, it, vi } from 'vitest';
import {
  isRetryable,
  SyncEngine,
  type SyncApi,
  toCatalogCartItem,
  toOfflineSaleRequest,
} from './engine';
import { MemoryStore } from './store';

const item = (sku: string, overrides: Partial<CatalogItem> = {}): CatalogItem => ({
  variantId: `00000000-0000-4000-8000-${sku.padStart(12, '0')}`,
  productId: '11111111-1111-4111-8111-111111111111',
  productName: `Item ${sku}`,
  brand: null,
  sku,
  barcode: null,
  variantLabel: '',
  unit: 'piece',
  priceMinor: 10_000,
  taxRateId: null,
  active: true,
  ...overrides,
});

function fakeApi(overrides: Partial<{ create: (body: CreateSaleRequest) => Promise<Sale> }> = {}) {
  const pages = [
    { items: [item('1')], cursor: 'c1', hasMore: true },
    { items: [item('2', { barcode: '4006381333931' })], cursor: 'c2', hasMore: false },
  ];
  const catalog = vi.fn(async ({ cursor }: { cursor?: string }) =>
    cursor === 'c2'
      ? { items: [item('1', { active: false })], cursor: 'c3', hasMore: false }
      : pages[cursor === 'c1' ? 1 : 0]!,
  );
  const create = vi.fn(
    overrides.create ??
      (async (body: CreateSaleRequest) => ({ id: body.id, number: 'INV-1' }) as Sale),
  );
  const api: SyncApi = {
    sync: { catalog },
    sales: { create },
    taxRates: {
      list: async () => ({
        items: [
          { id: 'vat', name: 'VAT', rateBp: 1800, isDefault: true, status: 'ACTIVE', version: 1 },
        ],
      }),
    },
    settings: { get: async () => ({ currency: 'LKR' }) as never },
  };
  return { api, catalog, create };
}

const request = (id: string, capturedAt = '2026-10-17T08:00:00.000Z'): CreateSaleRequest => ({
  id,
  shiftId: '22222222-2222-4222-8222-222222222222',
  lines: [{ variantId: item('1').variantId, quantity: '1' }],
  payments: [],
  expectedTotalMinor: 0,
  offline: { capturedAt, pricesIncludeTax: true, lines: [{ unitPriceMinor: 0, taxRateBp: 0 }] },
});

describe('catalogue sync', () => {
  it('pages to the end, remembers the cursor and applies later changes', async () => {
    const store = new MemoryStore();
    const { api, catalog } = fakeApi();
    const engine = new SyncEngine(api, store);
    expect(await engine.syncCatalog()).toBe(2);
    expect(await store.getMeta('catalog.cursor')).toBe('c2');
    expect((await engine.findByCode('4006381333931'))?.sku).toBe('2');
    expect((await engine.findByCode('1'))?.sku).toBe('1');
    expect((await engine.cachedTaxRates())?.items[0]?.rateBp).toBe(1800);

    // Next sync resumes from the stored cursor; the item was archived meanwhile.
    expect(await engine.syncCatalog()).toBe(1);
    expect(catalog).toHaveBeenLastCalledWith({ cursor: 'c2', limit: 500 });
    expect(await engine.findByCode('1')).toBeNull();
    expect(await engine.search('item', 10)).toEqual([expect.objectContaining({ sku: '2' })]);
  });
});

describe('outbox', () => {
  it('sends queued sales oldest first and removes them once confirmed', async () => {
    const store = new MemoryStore();
    const { api, create } = fakeApi();
    const engine = new SyncEngine(api, store);
    await engine.enqueue(request('b', '2026-10-17T09:00:00.000Z'));
    await engine.enqueue(request('a', '2026-10-17T08:00:00.000Z'));
    const result = await engine.flush();
    expect(create.mock.calls.map(([body]) => body.id)).toEqual(['a', 'b']);
    expect(result).toMatchObject({ pending: 0, reachable: true, failed: [] });
    expect(await engine.outbox()).toEqual([]);
  });

  it('keeps everything when the server is unreachable and stops at the first failure', async () => {
    const store = new MemoryStore();
    const { api, create } = fakeApi({
      create: async () => {
        throw new ApiError(0, 'NETWORK_ERROR', 'offline');
      },
    });
    const engine = new SyncEngine(api, store);
    await engine.enqueue(request('a'));
    await engine.enqueue(request('b', '2026-10-17T09:00:00.000Z'));
    const result = await engine.flush();
    expect(result).toMatchObject({ pending: 2, reachable: false });
    expect(create).toHaveBeenCalledTimes(1);
    expect((await engine.outbox())[0]?.attempts).toBe(1);
  });

  it('parks sales the server refuses, keeps sending the rest, and can retry or discard them', async () => {
    const store = new MemoryStore();
    let refuse = true;
    const { api } = fakeApi({
      create: async (body) => {
        if (body.id === 'a' && refuse) throw new ApiError(400, 'VALIDATION_FAILED', 'bad');
        return { id: body.id, number: `INV-${body.id}` } as Sale;
      },
    });
    const engine = new SyncEngine(api, store);
    await engine.enqueue(request('a'));
    await engine.enqueue(request('b', '2026-10-17T09:00:00.000Z'));
    const result = await engine.flush();
    expect(result.sent.map((s) => s.id)).toEqual(['b']);
    expect(result.failed).toEqual([
      expect.objectContaining({
        id: 'a',
        state: 'FAILED',
        lastError: { code: 'VALIDATION_FAILED', message: 'bad' },
      }),
    ]);
    // Failed sales are not resent automatically.
    expect((await engine.flush()).sent).toEqual([]);
    refuse = false;
    await engine.retry('a');
    expect((await engine.flush()).sent.map((s) => s.id)).toEqual(['a']);
    await engine.enqueue(request('c'));
    await engine.discard('c');
    expect(await engine.outbox()).toEqual([]);
  });

  it('shares one run between concurrent flushes, so no sale is sent twice at once', async () => {
    const store = new MemoryStore();
    const { api, create } = fakeApi();
    const engine = new SyncEngine(api, store);
    await engine.enqueue(request('a'));
    await Promise.all([engine.flush(), engine.flush()]);
    expect(create).toHaveBeenCalledTimes(1);
  });
});

describe('isRetryable', () => {
  it('keeps sales queued while the account is read-only, and refuses real rejections', () => {
    expect(isRetryable(new ApiError(402, 'SUBSCRIPTION_INACTIVE', 'read-only'))).toBe(true);
    expect(isRetryable(new ApiError(0, 'NETWORK_ERROR', 'offline'))).toBe(true);
    expect(isRetryable(new ApiError(400, 'VALIDATION_FAILED', 'bad'))).toBe(false);
    expect(isRetryable(new ApiError(409, 'PLAN_LIMIT_REACHED', 'limit'))).toBe(false);
  });
});

describe('toOfflineSaleRequest', () => {
  it('records the prices and tax charged with the device’s copy of the catalogue', () => {
    let cart = emptyCart('33333333-3333-4333-8333-333333333333');
    cart = addToCart(cart, toCatalogCartItem(item('1', { priceMinor: 11_800 })), '2');
    const body = toOfflineSaleRequest({
      cart,
      shiftId: '22222222-2222-4222-8222-222222222222',
      payments: [{ method: 'CASH', amountMinor: 23_600 }],
      taxRates: [
        { id: 'vat', name: 'VAT', rateBp: 1800, isDefault: true, status: 'ACTIVE', version: 1 },
      ],
      pricesIncludeTax: true,
      capturedAt: new Date('2026-10-17T10:00:00.000Z'),
    });
    expect(body).toMatchObject({
      id: cart.saleId,
      expectedTotalMinor: 23_600,
      payments: [{ method: 'CASH', amountMinor: 23_600, reference: null }],
      offline: {
        capturedAt: '2026-10-17T10:00:00.000Z',
        pricesIncludeTax: true,
        lines: [{ unitPriceMinor: 11_800, taxRateBp: 1800 }],
      },
    });
  });
});
