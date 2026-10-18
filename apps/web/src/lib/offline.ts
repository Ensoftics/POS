import type { CatalogItem } from '@pos/contracts';
import { isRetryable, type OfflineStore, type OutboxEntry, SyncEngine } from '@pos/offline';
import Dexie, { type Table } from 'dexie';
import { useCallback, useEffect, useState } from 'react';
import { api } from './api';
import { useAuthContext } from './auth-store';

interface StoredItem extends CatalogItem {
  /** Upper-cased SKU for case-insensitive lookups. */
  skuKey: string;
}

/** One IndexedDB database per business, so devices shared by businesses never mix data. */
class TillDatabase extends Dexie {
  items!: Table<StoredItem, string>;
  meta!: Table<{ key: string; value: string }, string>;
  outbox!: Table<OutboxEntry, string>;

  constructor(tenantId: string) {
    super(`pos-offline-${tenantId}`);
    this.version(1).stores({
      items: '&variantId, skuKey, barcode',
      meta: '&key',
      outbox: '&id, createdAt',
    });
  }
}

export class DexieStore implements OfflineStore {
  constructor(private readonly db: TillDatabase) {}

  async getMeta(key: string) {
    return (await this.db.meta.get(key))?.value ?? null;
  }
  async setMeta(key: string, value: string) {
    await this.db.meta.put({ key, value });
  }
  async putItems(items: CatalogItem[]) {
    await this.db.items.bulkPut(items.map((item) => ({ ...item, skuKey: item.sku.toUpperCase() })));
  }
  async findByCode(code: string) {
    const text = code.trim();
    const found =
      (await this.db.items.where('barcode').equals(text).first()) ??
      (await this.db.items.where('skuKey').equals(text.toUpperCase()).first());
    return found?.active ? strip(found) : null;
  }
  async search(text: string, limit: number) {
    const needle = text.trim().toLowerCase();
    const rows = await this.db.items
      .filter(
        (i) =>
          i.active &&
          [i.productName, i.brand ?? '', i.sku].some((f) => f.toLowerCase().includes(needle)),
      )
      .limit(limit)
      .toArray();
    return rows.map(strip);
  }
  countItems() {
    return this.db.items.count();
  }
  async putOutbox(entry: OutboxEntry) {
    await this.db.outbox.put(entry);
  }
  listOutbox() {
    return this.db.outbox.orderBy('createdAt').toArray();
  }
  async removeOutbox(id: string) {
    await this.db.outbox.delete(id);
  }
}

function strip({ skuKey: _skuKey, ...item }: StoredItem): CatalogItem {
  return item;
}

const engines = new Map<string, SyncEngine>();

/** The sync engine for a business on this browser (one per tenant, kept for the page's life). */
export function engineFor(tenantId: string): SyncEngine {
  let engine = engines.get(tenantId);
  if (!engine) {
    engine = new SyncEngine(api, new DexieStore(new TillDatabase(tenantId)));
    engines.set(tenantId, engine);
  }
  return engine;
}

/** Test hook: forget engines so each test starts with a fresh database. */
export function resetOfflineEngines() {
  engines.clear();
}

export interface OfflineStatus {
  engine: SyncEngine;
  /** False after a request failed for lack of a connection, until one succeeds. */
  reachable: boolean;
  pending: number;
  failed: OutboxEntry[];
  lastSyncedAt: string | null;
  /** Sends queued sales and refreshes the local catalogue now. */
  syncNow: () => Promise<void>;
  /** Re-reads the outbox (after queuing a sale). */
  refresh: () => Promise<void>;
}

const FLUSH_EVERY_MS = 30_000;
const CATALOG_EVERY_MS = 5 * 60_000;

/**
 * Keeps this browser's copy of the catalogue current and delivers queued sales:
 * on mount, when the browser comes back online, and periodically.
 */
export function useOfflineSync(): OfflineStatus {
  const { tenant } = useAuthContext();
  const engine = engineFor(tenant.id);
  const [reachable, setReachable] = useState(true);
  const [pending, setPending] = useState(0);
  const [failed, setFailed] = useState<OutboxEntry[]>([]);
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const entries = await engine.outbox();
    setPending(entries.filter((e) => e.state === 'PENDING').length);
    setFailed(entries.filter((e) => e.state === 'FAILED'));
    setLastSyncedAt(await engine.lastSyncedAt());
  }, [engine]);

  const flush = useCallback(async () => {
    const result = await engine.flush();
    setReachable(result.reachable);
    await refresh();
  }, [engine, refresh]);

  const syncCatalog = useCallback(async () => {
    try {
      await engine.syncCatalog();
      setReachable(true);
    } catch (error) {
      // Only a connection problem means "offline"; other errors leave the state alone.
      if (isRetryable(error)) setReachable(false);
    }
    await refresh();
  }, [engine, refresh]);

  const syncNow = useCallback(async () => {
    await flush();
    await syncCatalog();
  }, [flush, syncCatalog]);

  useEffect(() => {
    void syncNow();
    const flushTimer = setInterval(() => void flush(), FLUSH_EVERY_MS);
    const catalogTimer = setInterval(() => void syncCatalog(), CATALOG_EVERY_MS);
    const online = () => void syncNow();
    const offline = () => setReachable(false);
    window.addEventListener('online', online);
    window.addEventListener('offline', offline);
    return () => {
      clearInterval(flushTimer);
      clearInterval(catalogTimer);
      window.removeEventListener('online', online);
      window.removeEventListener('offline', offline);
    };
  }, [flush, syncCatalog, syncNow]);

  return { engine, reachable, pending, failed, lastSyncedAt, syncNow, refresh };
}
