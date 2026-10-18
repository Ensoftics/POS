# ADR 0004 — Offline-first strategy (direction)

- **Implemented for sales in Slice 7:** see [ADR 0009](0009-offline-sales-and-sync.md).
- **Status:** Proposed — to be finalised and implemented in Slice 7.

## Context

Shops in Sri Lanka face power and connectivity interruptions. Checkout must keep working.

## Direction

- **Local persistence first:** Android uses SQLite (expo-sqlite), web uses IndexedDB (Dexie).
  A sale is committed locally before the UI shows success.
- **Durable outbox:** each locally created transaction gets a client-generated UUID and an
  idempotency key; outbox rows track status (pending / syncing / synced / failed), attempt
  count, next retry time (exponential backoff with jitter) and last error.
- **Server is authoritative for stock:** devices send _movements_ (sold 2 units), never
  absolute quantities. The server applies them in its stock ledger; duplicates are rejected
  by idempotency key and acknowledged so the device can mark them synced.
- **Conflicts:** versioned records (`version` column) for catalogue edits; field-level policies
  (e.g. price edits from back office win over device caches; sales are never rejected for
  stale prices — the price at sale time is preserved and flagged if outside tolerance).
- **Clock skew:** server records both device time and receipt time; reports use server time
  with device time kept for audit.
- **Offline auth:** a device may keep selling for a bounded window after its last successful
  refresh, with permissions cached from that refresh; sensitive actions (refunds over limit,
  voids) require connectivity or a cached manager approval rule.
- **What this does not do:** several devices offline at the same time cannot see each other's
  sales, so they can oversell the same last item. Shops that need shared live stock while the
  internet is down need a LAN coordination server, which will be designed separately.

## Open questions for Slice 7

Offline window length per plan, negative-stock policy when offline sales sync late, and how
offline refunds are approved.
