# ADR 0016 — Loyalty points

- **Status:** Accepted (2026-10-17)

## Context

Shops want to reward returning customers: points for buying, spent later at the till. Points
have money value, so they need the same guarantees as other customer balances: no double
spending, exact reversal on returns, a complete history, and no surprises when offline.

## Decision

### Rules

- Owners switch loyalty on in **Settings › Taxes & checkout** and set:
  - the spend per point (e.g. 1 point per LKR 100);
  - the value of a point when paying (e.g. LKR 1);
  - the fewest points usable at once.
- Platform staff can switch it off per business with the `loyalty` feature flag (default on);
  then nobody earns or spends.
- Points are whole numbers and money is in minor units, so all rules are exact
  (`@pos/domain` `loyalty.ts`).

### Earning and paying

- **Earning:** points are earned on sales with a customer attached: whole points on what was
  paid by any method except points.
- **Paying:** points are a payment method (`LOYALTY`):
  - only for the attached customer;
  - only whole points, at least the minimum, within the balance;
  - **online only**: a till without a connection cannot know the balance. The server refuses
    `LOYALTY` in offline sales, and the web and Android checkouts never save such a sale on
    the device.
- **No double spending:** the balance lives on the customer and changes only through one
  conditional `UPDATE … WHERE loyalty_points + change >= 0`, so two tills cannot spend the
  same points (tested concurrently). Each change writes an append-only `loyalty_entries` row
  with the balance after it.
- **Rates are frozen per sale:** each sale stores the points it earned, the points used and
  what they were worth, so later rate changes never alter past sales.

### Returns

Points follow the money back:

- refunding a points payment (refunds go back by method, as before) returns those points;
- earned points are taken back in proportion to the refund.

Both use cumulative shares rounded down until everything is returned, so several partial
returns add up exactly to the original points. Taking back earned points may leave a negative
balance when the customer already spent them; that blocks spending until they earn again.

### Adjustments and history

- Managers (`customers.credit`) can add or deduct points with a reason (goodwill,
  corrections). Deductions never go below zero; the request id makes retries safe; each
  adjustment is audited.
- The customer page shows the balance and the full history; receipts show points used,
  earned and the new balance.
- Points cannot pay off an account balance (a database check and the API both refuse it).

## Consequences

- Points are treated as a payment method (a liability being settled), so sales totals and tax
  stay the same whether a customer pays with points or money; reports show points as their
  own payment method.
- Customers attached on an offline till still earn points when the sale syncs, but cannot
  spend them until the till is online.
- There is no expiry of points yet; expiry would need a scheduled job and customer notices.
