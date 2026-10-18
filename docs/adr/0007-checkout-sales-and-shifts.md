# ADR 0007 — Checkout: pricing, tax, sales, payments and shifts

- **Status:** Accepted (2026-10-17)

## Context

A sale moves money and stock at the same time. The till may lose its connection after
the server has recorded a sale, prices can change while a customer waits, and two tills
can sell the last item at once. Tax rates differ by business and must never be
hard-coded. Card data must never be stored.

## Decision

### One pricing function for client and server

`computeCart` in `@pos/domain` prices a cart in integer minor units with BigInt
intermediates and half-up rounding:

1. line gross = unit price × quantity;
2. line discounts (percent in basis points, or an amount), capped at the line;
3. the sale discount is shared across lines in proportion to their discounted amounts
   (largest-remainder allocation, so the shares always add up exactly);
4. tax per line on what remains: **extracted** when the business's prices include tax
   (`tax = amount × r / (1 + r)`), otherwise **added** on top.

The web and Android tills call the same function for live totals. The API calls it again
with **its own** prices and tax rates. The client also sends `expectedTotalMinor` — the
amount shown to the customer. If the server's total differs (a price or rate changed),
the sale is refused with `409 TOTAL_MISMATCH`, the till reprices the cart, and the cashier
confirms the new total. The customer is never charged an amount they were not shown.

### Tax rates

`tax_rates` are per tenant (name, basis points, at most one default enforced by a partial
unique index). A product either names a rate or uses the default. A 0 % rate is how a
product is made exempt. Rates in use by products cannot be archived. Each sale line
copies the rate's name and basis points, so later changes never alter past receipts.
A single rate applies per line; compound taxes are out of scope until a market needs them.

### Sales are idempotent, immutable records

- The sale id is a client-generated UUID created once per cart and reused for every
  attempt. A retry returns the original sale (`200`). Simultaneous retries are settled by
  the primary key: the loser's transaction rolls back (including its stock movements)
  and it returns the winner's sale.
- A SHA-256 of the request is stored. Reusing an id for a _different_ sale returns
  `409 IDEMPOTENCY_CONFLICT` instead of silently returning the wrong receipt.
- Sale numbers (`INV-000001`) are gapless per tenant (shared `document_sequences`).
- `sales`, `sale_lines` and `sale_payments` have `UPDATE`/`DELETE` revoked from the app
  role. CHECK constraints make totals self-consistent (`total = subtotal − discount (+ tax
when exclusive)`, `paid = total + change`). Voids and returns (Slice 6) will be new records.

### Payments

Methods: cash, card, bank transfer, other; up to 10 per sale. Only cash may exceed the
amount still due (the excess is change); non-cash tenders may not exceed the total, so
change is never paid out against a card. Card payments store only an optional terminal
approval code (validated to reject anything that looks like a card number). No card
data, ever.

### Shifts

A shift belongs to one register (a partial unique index allows one open shift per
register) and to the cashier who opened it. Sales require an open shift; cashiers sell
only on their own shift (`shifts.manage` lets managers act on any). Expected drawer cash =
opening float + cash received − change given, computed from the database at close.

Closing takes `SELECT … FOR UPDATE` on the shift row; each sale takes `FOR SHARE` while it
is recorded. Closing therefore waits for in-flight sales, and a sale arriving after the
close sees `SHIFT_NOT_OPEN`. The count can never miss a sale.

### Stock and the negative-stock policy

Sales take stock through `StockLedger` (`SALE` movements, earliest expiry first). The
tenant setting `allowNegativeStock` (default **off**) decides what happens when records
show too little stock:

- off: `409 INSUFFICIENT_STOCK`, nothing recorded;
- on: the sale goes through; the shortfall is booked against unbatched stock, which goes
  below zero until a receipt or stock count corrects it.

To make the policy possible, the "never below zero" rule moved from the
`stock_levels`/`stock_movements` CHECK constraints into the ledger's conditional
`UPDATE … WHERE quantity + delta >= 0`. PostgreSQL re-evaluates that condition on the
latest row version after waiting for a concurrent writer, so it stays race-safe (tested
with simultaneous sales of the last item). Adjustments, transfers and counts never use the
policy.

## Consequences

- Clients can show exact totals offline-capable (same code), which Slice 7 relies on.
- A cashier may see "prices changed" on a slow day of price edits; this is deliberate.
- Discounts need the `sales.discount` permission (owners, managers, cashiers by default);
  per-discount approval limits arrive with approvals in Slice 6.
- Receipt printing on the web uses the browser's print dialog with an 80 mm layout.
  Direct thermal printing (ESC/POS, Bluetooth) on Android is a later hardware slice.
