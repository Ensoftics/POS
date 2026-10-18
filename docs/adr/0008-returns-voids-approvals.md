# ADR 0008 — Returns, voids, manager approvals and drawer cash

- **Status:** Accepted (2026-10-17)

## Context

Customers bring items back days later, sometimes to another branch and another cashier.
Mistakes at the till need undoing before the customer leaves. Each of these moves money
and stock, so it must be traceable, idempotent and impossible to over-refund. Cashiers
need a manager's sign-off for sensitive actions without the manager logging in on the
cashier's device.

## Decision

### Returns and voids are new records; sales never change

- `sale_returns` (+ lines and refund tenders) record each return. A **void** is a return of
  kind `VOID`: the whole sale, every payment mirrored, only while the sale's own shift is
  still open and nothing has been returned yet. At most one void per sale (partial unique
  index).
- A sale's state (`NONE` / `PARTIAL` / `FULL`, `voided`) is **derived** from its returns.
  Sales, returns, refunds and cash movements are all insert-only for the app role
  (`UPDATE`/`DELETE` revoked explicitly, because the role's default privileges would
  otherwise grant them).
- Returns are idempotent on a client-generated id with a request fingerprint, like sales.
  Concurrent returns of the same sale are serialised by a transaction-scoped advisory lock
  on the sale id (a row lock would need `UPDATE` privilege on `sales`, which is revoked).

### Exact, pro-rated refunds

The refund for returning `q` more units of a line is
`round(lineTotal × (returnedBefore + q) / sold) − refundedBefore` (half-up, BigInt), and the
same for tax. Returning a line in several visits therefore always adds up to exactly what
was paid for it, including its share of the sale discount. `lineRefund` in `@pos/domain`
is used by the API and by the web form, so the cashier sees the server's amount.

### Refunds go back the way the money came in

Per method, the refundable amount is what was paid with it (cash net of change) minus
earlier refunds by that method. Refund tenders must add up to the refund exactly and stay
within each method's limit, so a card purchase cannot be refunded in cash. Card refunds
record only a reference.

### Stock

Restocked items return through the ledger (`RETURN` movements) to the **batches the sale
took them from**, net of earlier restocks, at the branch where the return happens. Items
marked "not back to stock" (damaged) create no movement.

### Manager approvals

- Members whose role has `approvals.grant` (owner, manager) set a personal 4–8 digit
  **approval PIN** after re-entering their password. It is hashed with scrypt like a
  password and never returned.
- A cashier's request carries `approval: { approverId, pin }`. Verification runs in its
  **own transaction before the action**, so failed attempts are counted even though the
  action is then refused; five failures lock that approver for 15 minutes (audited).
  Unknown approvers cost the same as real ones.
- Needs approval (unless the caller has `approvals.grant`):
  - discounts above the tenant's limit (`discountApprovalBp`, off by default);
  - returns, when `refundsRequireApproval` is on (default);
  - every void and every cash pay-out.
- The approver is stored on the sale, return or cash movement and in the audit log. The
  API answers `403 APPROVAL_REQUIRED` / `APPROVAL_INVALID` / `APPROVAL_LOCKED`; clients ask
  for the manager and PIN and resend the **same** request (same id), so a retry can never
  create a second record.

### Drawer cash

Pay-ins and pay-outs (`cash_movements`) belong to the cashier's open shift; a pay-out may
not exceed the cash the drawer should hold. Expected cash at close =
opening float + cash received − change − cash refunds + pay-ins − pay-outs, computed in the
database. Cash movements and closing both lock the shift row; refunds take `FOR SHARE`
like sales, so a count never misses a movement.

## Consequences

- A return can be taken at any till: cashiers find any sale by its receipt number
  (`sales.refund`), while the sales list still shows them only their own shifts.
- Managers approve on the cashier's device without a session switch; there is no
  remote/asynchronous approval queue yet.
- Price overrides at the till are not supported: prices come from the catalogue, and
  discounts (with approval above the limit) cover the same need.
- Returns are recorded on the web back office and at the web till; the Android app records
  approvals for discounts and cash in/out, and returns arrive there with offline sales
  (Slice 7).
