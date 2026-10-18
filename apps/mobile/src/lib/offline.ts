import type { CatalogItem } from '@pos/contracts';
import { isRetryable, type OfflineStore, type OutboxEntry, SyncEngine } from '@pos/offline';
import * as SQLite from 'expo-sqlite';
import { useCallback, useEffect, useState } from 'react';
import { AppState } from 'react-native';
import { api } from './api';

/**
 * SQLite storage for one business on this device: the catalogue copy, small
 * cached values and the outbox of sales waiting to be sent. It survives app
 * restarts, so sales completed offline are never lost.
 */
export class SqliteStore implements OfflineStore {
  private ready: Promise<SQLite.SQLiteDatabase> | null = null;

  constructor(private readonly name: string) {}

  private db(): Promise<SQLite.SQLiteDatabase> {
    this.ready ??= (async () => {
      const db = await SQLite.openDatabaseAsync(this.name);
      await db.execAsync(`
        PRAGMA journal_mode = WAL;
        CREATE TABLE IF NOT EXISTS items (
          variant_id TEXT PRIMARY KEY NOT NULL,
          sku_key TEXT NOT NULL,
          barcode TEXT,
          search TEXT NOT NULL,
          active INTEGER NOT NULL,
          json TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS items_sku ON items (sku_key);
        CREATE INDEX IF NOT EXISTS items_barcode ON items (barcode);
        CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS outbox (
          id TEXT PRIMARY KEY NOT NULL,
          created_at TEXT NOT NULL,
          json TEXT NOT NULL
        );
      `);
      return db;
    })();
    return this.ready;
  }

  async getMeta(key: string) {
    const row = await (
      await this.db()
    ).getFirstAsync<{ value: string }>('SELECT value FROM meta WHERE key = ?', key);
    return row?.value ?? null;
  }

  async setMeta(key: string, value: string) {
    await (
      await this.db()
    ).runAsync(
      'INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
      key,
      value,
    );
  }

  async putItems(items: CatalogItem[]) {
    const db = await this.db();
    await db.withTransactionAsync(async () => {
      for (const item of items)
        await db.runAsync(
          `INSERT INTO items (variant_id, sku_key, barcode, search, active, json) VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT(variant_id) DO UPDATE SET sku_key = excluded.sku_key, barcode = excluded.barcode,
             search = excluded.search, active = excluded.active, json = excluded.json`,
          item.variantId,
          item.sku.toUpperCase(),
          item.barcode,
          [item.productName, item.brand ?? '', item.sku].join(' ').toLowerCase(),
          item.active ? 1 : 0,
          JSON.stringify(item),
        );
    });
  }

  async findByCode(code: string) {
    const text = code.trim();
    const row = await (
      await this.db()
    ).getFirstAsync<{ json: string }>(
      'SELECT json FROM items WHERE active = 1 AND (barcode = ? OR sku_key = ?) LIMIT 1',
      text,
      text.toUpperCase(),
    );
    return row ? (JSON.parse(row.json) as CatalogItem) : null;
  }

  async search(text: string, limit: number) {
    const rows = await (
      await this.db()
    ).getAllAsync<{ json: string }>(
      "SELECT json FROM items WHERE active = 1 AND search LIKE ? ESCAPE '\\' LIMIT ?",
      `%${text
        .trim()
        .toLowerCase()
        .replace(/[%_\\]/g, (c) => `\\${c}`)}%`,
      limit,
    );
    return rows.map((r) => JSON.parse(r.json) as CatalogItem);
  }

  async countItems() {
    const row = await (
      await this.db()
    ).getFirstAsync<{ n: number }>('SELECT COUNT(*) AS n FROM items');
    return row?.n ?? 0;
  }

  async putOutbox(entry: OutboxEntry) {
    await (
      await this.db()
    ).runAsync(
      `INSERT INTO outbox (id, created_at, json) VALUES (?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET json = excluded.json`,
      entry.id,
      entry.createdAt,
      JSON.stringify(entry),
    );
  }

  async listOutbox() {
    const rows = await (
      await this.db()
    ).getAllAsync<{ json: string }>('SELECT json FROM outbox ORDER BY created_at, id');
    return rows.map((r) => JSON.parse(r.json) as OutboxEntry);
  }

  async removeOutbox(id: string) {
    await (await this.db()).runAsync('DELETE FROM outbox WHERE id = ?', id);
  }
}

let storeFactory: (tenantId: string) => OfflineStore = (tenantId) =>
  new SqliteStore(`pos-offline-${tenantId}.db`);
const engines = new Map<string, SyncEngine>();

/** Tests replace SQLite with an in-memory store. */
export function setOfflineStoreFactory(factory: (tenantId: string) => OfflineStore) {
  storeFactory = factory;
  engines.clear();
}

export function engineFor(tenantId: string): SyncEngine {
  let engine = engines.get(tenantId);
  if (!engine) {
    engine = new SyncEngine(api, storeFactory(tenantId));
    engines.set(tenantId, engine);
  }
  return engine;
}

const FLUSH_EVERY_MS = 30_000;

/** Sends queued sales and refreshes the catalogue copy: now, when the app returns to the foreground, and every 30 s. */
export function useOfflineSync(tenantId: string) {
  const engine = engineFor(tenantId);
  const [reachable, setReachable] = useState(true);
  const [pending, setPending] = useState(0);
  const [failed, setFailed] = useState(0);

  const refresh = useCallback(async () => {
    const entries = await engine.outbox();
    setPending(entries.filter((e) => e.state === 'PENDING').length);
    setFailed(entries.filter((e) => e.state === 'FAILED').length);
  }, [engine]);

  const syncNow = useCallback(async () => {
    const result = await engine.flush();
    let ok = result.reachable;
    try {
      await engine.syncCatalog();
    } catch (error) {
      if (isRetryable(error)) ok = false;
    }
    setReachable(ok);
    await refresh();
  }, [engine, refresh]);

  useEffect(() => {
    void syncNow();
    const timer = setInterval(() => void engine.flush().then(refresh), FLUSH_EVERY_MS);
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') void syncNow();
    });
    return () => {
      clearInterval(timer);
      subscription.remove();
    };
  }, [engine, refresh, syncNow]);

  return { engine, reachable, pending, failed, syncNow, refresh };
}
