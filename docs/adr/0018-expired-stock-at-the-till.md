# ADR 0018 — Expired stock at the till

- **Status:** Accepted (2026-10-17)

## Context

Cosmetics shops track batches with expiry dates (Slice 4). Sales took stock first-expiry-first-out,
but expired batches were included: a sale could quietly book an expired lipstick, and the stock
records then showed good stock that was really the expired items still on the shelf. Selling
expired cosmetics is also a consumer-protection risk.

## Decision

- A batch is usable **through** its expiry date and expired from the next day. The date is
  judged on the business's calendar (`tenant_settings.timezone`). For offline sales, it is the
  date the sale was made (`capturedAt`).
- **Online sales** never take stock from expired batches while unexpired stock is left:
  - if the unexpired stock is not enough and expired stock exists, the sale is refused with
    `409 EXPIRED_STOCK`;
  - this also holds where the business allows selling without recorded stock, because the
    item in the cashier's hand most likely comes from the expired batch;
  - the cashier is told to check the date and to write off expired stock.
- **Offline sales** are recorded as they happened, because the goods have already left the
  shop:
  - unexpired stock is used first, then expired batches (most recently expired first), then
    any shortfall as before;
  - the sale gets an `EXPIRED_SOLD` conflict with the SKU, batch number, expiry date and
    quantity, so a manager reviews it under **Offline sales to review**.
- Other stock movements (write-offs, transfers, counts) can still use expired batches, since
  writing them off is the intended clean-up.
- The rule is one pure function, `allocateForSale` in `@pos/domain`, used by
  `StockLedger.takeOutForSale`.

## Consequences

- A shop that does not track expiry dates is unaffected: batches without a date never expire.
- Tills learn of expired stock only when the server refuses the sale, because the offline
  catalogue does not hold batch dates. Expiring batches are already announced in advance by the
  daily stock alerts (Slice 13a).
- Textiles needed no change: measured quantities (metres, yards), fractional quantities and
  size/colour variants were already covered by the core.
