# ADR 0009 — Offline sales: outbox, catalogue sync and conflict review

- **Status:** Accepted (2026-10-17). Implements the strategy of ADR 0004 for sales.

## Context

A till must keep selling when the connection drops: the customer pays and leaves, and the
sale has to be recorded later without being lost, duplicated or silently changed. The
server cannot apply its online rules to such a sale (the price may have changed, stock may
be short, the shift may have been closed elsewhere, a manager could not enter a PIN).

## Decision

### Shared engine, platform storage

`@pos/offline` holds the logic both tills share: `SyncEngine` (catalogue sync, outbox,
cached settings/tax rates/shift), `toOfflineSaleRequest` and `buildLocalReceipt`.
Storage is an `OfflineStore` interface implemented with **IndexedDB (Dexie)** on the web
and **SQLite (expo-sqlite)** on Android, one database per tenant. Tests use `MemoryStore`.

### Catalogue copy

`GET /sync/catalog` returns variants with their product data in change order
(`GREATEST(variant.updated_at, product.updated_at), id`), including archived items as
inactive so devices drop them. Cursors are opaque; the cursor a device keeps between syncs
is replayed with a 60-second overlap because a change committed late may carry an earlier
timestamp than one already sent. Re-sent items are idempotent upserts. Tax rates, settings
and the register's open shift are cached alongside. Devices sync on start, when they come
back online or to the foreground, and every five minutes (sales every 30 seconds).

### Outbox, never "maybe sent"

When a sale cannot reach the server (no connection, 5xx, rate limit), the till **finishes
it locally**: it queues the request under the cart's existing client id, prints a receipt
marked "pending", and starts a new cart. Queued sales are sent oldest first; sending stops
at the first connection failure so order is kept. Because the id is the idempotency key —
and the request fingerprint ignores the `offline` block — a sale that did reach the server
before the connection failed is answered with the original instead of being recorded twice.
Sales the server _refuses_ (4xx) are parked as FAILED and shown on the till; they are never
retried silently, and only a manager may discard one.

### The server records offline sales as they happened

A sale with an `offline` block (capture time, the prices and tax rates charged, whether
prices included tax) is accepted even when an online sale would be refused, and each
difference becomes a **sale conflict** for review:

| Situation                         | Online                                | Offline                                        |
| --------------------------------- | ------------------------------------- | ---------------------------------------------- |
| Price or tax changed              | `TOTAL_MISMATCH`, cashier re-confirms | Recorded at the charged price, `PRICE_CHANGED` |
| Not enough stock (policy off)     | `INSUFFICIENT_STOCK`                  | Stock goes negative, `STOCK_SHORT`             |
| Shift closed                      | `SHIFT_NOT_OPEN`                      | Recorded on that shift, `SHIFT_CLOSED`         |
| Discount above limit, no approval | `APPROVAL_REQUIRED`                   | Recorded, `APPROVAL_MISSING`                   |
| Item archived                     | validation error                      | Recorded, `ITEM_ARCHIVED`                      |

The server still checks the till's own arithmetic: the charged prices must reproduce
the total the customer paid (`TOTAL_MISMATCH` otherwise) and payments must settle.
Capture times more than 5 minutes in the future or 30 days in the past are refused.
`createdAt` is the till's capture time; `syncedAt` records arrival. Approval PINs are never
stored on devices, so over-limit discounts made offline always arrive as `APPROVAL_MISSING`.

### Review

Managers (`shifts.manage`) see open conflicts with the facts (charged vs current price,
sold vs recorded stock) and resolve them with a note; resolution is audited. Conflicts
can be resolved but not deleted. Follow-up actions use the existing tools (returns,
adjustments, counts).

## Consequences

- No sale is lost or duplicated by a dropped connection; differences become visible work
  instead of silent corrections.
- The web till keeps working offline **while the page stays open**; reloading without a
  connection needs a service worker (app-shell caching), not yet added. Android stores
  everything in SQLite and survives restarts.
- Opening and closing shifts, returns, voids and cash movements still need a connection.
- Access tokens expire after 15 minutes; an offline till keeps selling and queues, and the
  outbox is sent after the session is renewed.
