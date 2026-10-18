# ADR 0006 — Stock ledger, batches and inventory documents

- **Status:** Accepted (2026-10-16)

## Context

Stock must be right when two cashiers sell the last item at once, when a request is retried
after a timeout, and when an auditor asks why the shelf count differs from the system. Offline
devices (Slice 7) will later send stock changes as replayable commands.

## Decision

### Ledger plus balances

- `stock_movements` is an **append-only ledger** (UPDATE/DELETE revoked from the app role).
  Every movement records branch, variant, batch, signed quantity, balance after, type, reason,
  unit cost (receipts), the source document and the actor.
- `stock_levels` holds the current balance per (branch, variant, batch). It is changed **only**
  by `StockLedger.post`, in the same transaction as the movement:
  - increases: `INSERT … ON CONFLICT DO UPDATE SET quantity = quantity + delta`;
  - decreases: `UPDATE … SET quantity = quantity + delta` on the existing row (PostgreSQL checks
    CHECK constraints on the proposed insert row before conflict handling, so a negative upsert
    would always fail).
- Decreases only apply while the balance stays at or above zero (`WHERE quantity + delta >= 0`),
  so overselling is impossible under any concurrency: the second of two racing write-offs
  updates nothing and is reported as `409 INSUFFICIENT_STOCK`. No application lock is needed
  for single-row changes. (Originally a `CHECK (quantity >= 0)`; moved into the ledger in
  Slice 5 so sales can follow the tenant's negative-stock policy — see ADR 0007.)
- Tests assert the invariant **sum(movements) = balance** for every balance row.

### Batches and expiry

- Batches exist per variant (`batch_number`, optional `expiry_date`). Receiving requires them when
  the business profile tracks batches or expiry; with expiry-only tracking the batch is named
  `EXP-<date>`. A reused batch number with a different expiry is rejected.
- Outgoing stock without an explicit batch is allocated **first-expiry-first-out** (undated stock
  last) by `allocateFefo` in `@pos/domain`. Transfers carry the batch to the destination.

### Documents

- Goods receipts, adjustments and transfers take a **client-generated UUID** as their id. Re-sending
  the same id returns the original document (HTTP 200) instead of posting stock twice — including
  when the retries arrive simultaneously (the primary key decides).
- Document numbers (`PO-`, `GRN-`, `ADJ-`, `TRF-`, `CNT-`) are **gapless per tenant**: the sequence row
  is incremented inside the document's transaction, so a rollback never burns a number.
- Purchase orders: `DRAFT → ORDERED → PARTIALLY_RECEIVED → RECEIVED`, or `CANCELLED`
  (received stock stays). Only drafts are editable; transitions are version-checked.
- Transfers remove stock at creation (`IN_TRANSIT`), add it on receipt, or return it on cancel;
  receive and cancel claim the transfer atomically so only one can win.
- Stock counts: completion locks the counted balance rows (`SELECT … FOR UPDATE`) and posts
  `counted − current` as `COUNT_CORRECTION`, so sales during the count are not double-counted.
  Uncounted lines are left unchanged. One open count per branch.
- Adjustment reasons constrain direction (damaged/expired/lost/… only decrease; found only increases).

## Consequences

- Reporting reads the ledger; history is never rewritten, corrections are new movements.
- Cost: receipts record unit cost per movement; from Slice 9 a moving average cost is kept per
  variant and each sale movement stores its cost of goods (ADR 0011). The variant's manual cost
  price is the fallback before the first receipt.
- Staff-to-branch restrictions (which branches a user may operate) arrive with staff management
  in Slice 10; until then any member with the permission may act on any branch of the business.
