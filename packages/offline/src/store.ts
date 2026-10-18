import type { CatalogItem, CreateSaleRequest } from '@pos/contracts';

/** A sale waiting to be sent, kept until the server has confirmed it. */
export interface OutboxEntry {
  /** The sale's client-generated id, which is also its idempotency key. */
  id: string;
  request: CreateSaleRequest;
  /** ISO time the till completed the sale. */
  createdAt: string;
  attempts: number;
  /** PENDING: will be sent. FAILED: the server refused it; a person must look at it. */
  state: 'PENDING' | 'FAILED';
  lastError: { code: string; message: string } | null;
}

/**
 * Local storage for one business on one device. The web till implements it with
 * IndexedDB (Dexie), Android with SQLite; tests use `MemoryStore`. Implementations
 * must keep data per tenant (open one store per tenant).
 */
export interface OfflineStore {
  getMeta(key: string): Promise<string | null>;
  setMeta(key: string, value: string): Promise<void>;
  /** Inserts or replaces items by variantId. */
  putItems(items: CatalogItem[]): Promise<void>;
  /** Exact barcode, or SKU compared case-insensitively. Active items only. */
  findByCode(code: string): Promise<CatalogItem | null>;
  /** Name, brand or SKU contains the text (case-insensitive). Active items only. */
  search(text: string, limit: number): Promise<CatalogItem[]>;
  countItems(): Promise<number>;
  putOutbox(entry: OutboxEntry): Promise<void>;
  /** Oldest first. */
  listOutbox(): Promise<OutboxEntry[]>;
  removeOutbox(id: string): Promise<void>;
}

/** In-memory store for tests and for platforms without persistent storage. */
export class MemoryStore implements OfflineStore {
  private readonly meta = new Map<string, string>();
  private readonly items = new Map<string, CatalogItem>();
  private readonly outbox = new Map<string, OutboxEntry>();

  async getMeta(key: string) {
    return this.meta.get(key) ?? null;
  }
  async setMeta(key: string, value: string) {
    this.meta.set(key, value);
  }
  async putItems(items: CatalogItem[]) {
    for (const item of items) this.items.set(item.variantId, item);
  }
  async findByCode(code: string) {
    const text = code.trim();
    const upper = text.toUpperCase();
    for (const item of this.items.values())
      if (item.active && (item.barcode === text || item.sku.toUpperCase() === upper)) return item;
    return null;
  }
  async search(text: string, limit: number) {
    const needle = text.trim().toLowerCase();
    return [...this.items.values()]
      .filter(
        (i) =>
          i.active &&
          [i.productName, i.brand ?? '', i.sku].some((field) =>
            field.toLowerCase().includes(needle),
          ),
      )
      .sort((a, b) => a.productName.localeCompare(b.productName))
      .slice(0, limit);
  }
  async countItems() {
    return this.items.size;
  }
  async putOutbox(entry: OutboxEntry) {
    this.outbox.set(entry.id, entry);
  }
  async listOutbox() {
    return [...this.outbox.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }
  async removeOutbox(id: string) {
    this.outbox.delete(id);
  }
}
