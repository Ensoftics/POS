import { isApiError } from '@pos/api-client';
import type {
  CatalogItem,
  CatalogSyncPage,
  CreateSaleRequest,
  Sale,
  TaxRateList,
  TenantSettings,
} from '@pos/contracts';
import {
  type Cart,
  type CartItem,
  type PaymentInput,
  priceCart,
  resolveTaxRateBp,
} from '@pos/domain';
import type { OfflineStore, OutboxEntry } from './store';

/** The API calls the engine needs (a subset of the shared API client). */
export interface SyncApi {
  sync: { catalog(query: { cursor?: string; limit?: number }): Promise<CatalogSyncPage> };
  sales: { create(body: CreateSaleRequest): Promise<Sale> };
  taxRates: { list(): Promise<TaxRateList> };
  settings: { get(): Promise<TenantSettings> };
}

export interface FlushResult {
  sent: Sale[];
  failed: OutboxEntry[];
  /** Still waiting because the server could not be reached. */
  pending: number;
  /** False when flushing stopped because the server was unreachable. */
  reachable: boolean;
}

const META = {
  cursor: 'catalog.cursor',
  taxRates: 'taxRates',
  settings: 'settings',
  syncedAt: 'catalog.syncedAt',
};

/**
 * True for errors where trying again later may work: no connection, server down,
 * rate limit, signed out, or a read-only (unpaid) account that may be paid soon.
 */
export function isRetryable(error: unknown): boolean {
  if (!isApiError(error)) return true;
  return (
    error.isTransient ||
    error.code === 'SESSION_EXPIRED' ||
    error.code === 'UNAUTHENTICATED' ||
    error.code === 'SUBSCRIPTION_INACTIVE'
  );
}

export function toCatalogCartItem(item: CatalogItem): CartItem {
  return {
    variantId: item.variantId,
    productName: item.productName,
    sku: item.sku,
    variantLabel: item.variantLabel,
    unit: item.unit,
    unitPriceMinor: item.priceMinor,
    taxRateId: item.taxRateId,
  };
}

/**
 * Builds the request for a sale completed without a connection: the cart priced
 * with the device's copy of the catalogue, and the prices and tax actually charged,
 * so the server can record it as it happened.
 */
export function toOfflineSaleRequest(input: {
  cart: Cart;
  shiftId: string;
  payments: Array<PaymentInput & { reference?: string | null }>;
  taxRates: TaxRateList['items'];
  pricesIncludeTax: boolean;
  capturedAt?: Date;
  customerId?: string | null;
}): CreateSaleRequest {
  const totals = priceCart(input.cart, input.taxRates, input.pricesIncludeTax);
  return {
    id: input.cart.saleId,
    shiftId: input.shiftId,
    ...(input.customerId ? { customerId: input.customerId } : {}),
    lines: input.cart.lines.map((l) => ({
      variantId: l.variantId,
      quantity: l.quantity,
      discount: l.discount,
    })),
    discount: input.cart.discount,
    payments: input.payments.map((p) => ({
      method: p.method,
      amountMinor: p.amountMinor,
      reference: p.reference ?? null,
    })),
    expectedTotalMinor: totals.totalMinor,
    offline: {
      capturedAt: (input.capturedAt ?? new Date()).toISOString(),
      pricesIncludeTax: input.pricesIncludeTax,
      lines: input.cart.lines.map((l) => ({
        unitPriceMinor: l.unitPriceMinor,
        taxRateBp: resolveTaxRateBp(l.taxRateId, input.taxRates),
      })),
    },
  };
}

/**
 * Keeps a device's copy of the catalogue current and delivers queued sales.
 * Sales are sent oldest first with their original ids, so a sale the server
 * already has is answered with the original instead of being recorded twice.
 */
export class SyncEngine {
  private flushing: Promise<FlushResult> | null = null;

  constructor(
    private readonly api: SyncApi,
    private readonly store: OfflineStore,
  ) {}

  /** Pulls catalogue changes, tax rates and settings. Throws when the server is unreachable. */
  async syncCatalog(): Promise<number> {
    let cursor = (await this.store.getMeta(META.cursor)) ?? undefined;
    let received = 0;
    for (;;) {
      const page = await this.api.sync.catalog({ ...(cursor ? { cursor } : {}), limit: 500 });
      await this.store.putItems(page.items);
      received += page.items.length;
      if (page.cursor) {
        cursor = page.cursor;
        await this.store.setMeta(META.cursor, page.cursor);
      }
      if (!page.hasMore) break;
    }
    const [rates, settings] = await Promise.all([
      this.api.taxRates.list(),
      this.api.settings.get(),
    ]);
    await this.store.setMeta(META.taxRates, JSON.stringify(rates));
    await this.store.setMeta(META.settings, JSON.stringify(settings));
    await this.store.setMeta(META.syncedAt, new Date().toISOString());
    return received;
  }

  async cachedTaxRates(): Promise<TaxRateList | null> {
    const raw = await this.store.getMeta(META.taxRates);
    return raw ? (JSON.parse(raw) as TaxRateList) : null;
  }

  async cachedSettings(): Promise<TenantSettings | null> {
    const raw = await this.store.getMeta(META.settings);
    return raw ? (JSON.parse(raw) as TenantSettings) : null;
  }

  /** Keeps a JSON value for use without a connection (e.g. the register's open shift). */
  async remember(key: string, value: unknown): Promise<void> {
    await this.store.setMeta(`cache.${key}`, JSON.stringify(value));
  }

  /** The value last remembered under `key`, or undefined when there is none. */
  async recall<T>(key: string): Promise<T | undefined> {
    const raw = await this.store.getMeta(`cache.${key}`);
    return raw === null ? undefined : (JSON.parse(raw) as T);
  }

  async lastSyncedAt(): Promise<string | null> {
    return this.store.getMeta(META.syncedAt);
  }

  findByCode(code: string) {
    return this.store.findByCode(code);
  }

  search(text: string, limit = 8) {
    return this.store.search(text, limit);
  }

  /** Queues a completed sale. Safe to call twice for the same sale. */
  async enqueue(request: CreateSaleRequest, now = new Date()): Promise<void> {
    await this.store.putOutbox({
      id: request.id,
      request,
      createdAt: request.offline?.capturedAt ?? now.toISOString(),
      attempts: 0,
      state: 'PENDING',
      lastError: null,
    });
  }

  async outbox(): Promise<OutboxEntry[]> {
    return this.store.listOutbox();
  }

  /** Removes a failed sale after a person has dealt with it. */
  async discard(id: string): Promise<void> {
    await this.store.removeOutbox(id);
  }

  /** Puts a failed sale back in the queue (e.g. after the cause was fixed on the server). */
  async retry(id: string): Promise<void> {
    const entry = (await this.store.listOutbox()).find((e) => e.id === id);
    if (entry) await this.store.putOutbox({ ...entry, state: 'PENDING', lastError: null });
  }

  /** Sends queued sales; concurrent calls share one run. */
  flush(): Promise<FlushResult> {
    this.flushing ??= this.run().finally(() => {
      this.flushing = null;
    });
    return this.flushing;
  }

  private async run(): Promise<FlushResult> {
    const sent: Sale[] = [];
    const failed: OutboxEntry[] = [];
    let reachable = true;
    for (const entry of await this.store.listOutbox()) {
      if (entry.state !== 'PENDING') {
        failed.push(entry);
        continue;
      }
      try {
        sent.push(await this.api.sales.create(entry.request));
        await this.store.removeOutbox(entry.id);
      } catch (error) {
        const attempts = entry.attempts + 1;
        if (isRetryable(error)) {
          await this.store.putOutbox({ ...entry, attempts });
          // Order matters (shift, stock): stop and try everything again later.
          reachable = false;
          break;
        }
        const refused: OutboxEntry = {
          ...entry,
          attempts,
          state: 'FAILED',
          lastError: isApiError(error)
            ? { code: error.code, message: error.message }
            : { code: 'UNKNOWN', message: String(error) },
        };
        await this.store.putOutbox(refused);
        failed.push(refused);
      }
    }
    const pending = (await this.store.listOutbox()).filter((e) => e.state === 'PENDING').length;
    return { sent, failed, pending, reachable };
  }
}
