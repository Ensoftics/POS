# ADR 0010 — Customers, accounts on credit, collections and statements

- **Status:** Accepted (2026-10-17)

## Context

Many Sri Lankan shops sell to regulars "on the book": goods now, payment later. The shop
needs each customer's balance, a limit on how much they may owe, a record of payments, and a
statement to show them. Customer details are personal data and must be kept to a minimum.

## Decision

### Customers

- Name is required; phone, email, address and notes are optional. Phones are normalised to
  E.164 in the business's country (`077 123 4567` → `+94771234567`) so a customer is found
  however the number is typed; a phone is unique per business (not across businesses).
- Marketing consent is a timestamp, set when the customer agrees and kept while consent
  continues; withdrawing clears it.
- The audit log records customer changes by **field name only**; phones, emails and
  addresses never appear in logs.
- Cashiers may add and edit customers; only `customers.credit` (owners, managers) may set a
  credit limit.

### Account balance and ledger

- `customers.balance_minor`: positive = the customer owes; negative = store credit.
- It is changed only by `CustomerLedger.post`, which appends a `customer_ledger_entries`
  row (CHARGE, PAYMENT, REFUND) with the balance after, in the same transaction. Ledger
  entries and customer payments are insert-only for the app role.
- The credit limit is enforced by a conditional UPDATE
  (`… WHERE balance + amount <= credit_limit`), so simultaneous sales at two tills cannot
  push a customer over the limit; the loser gets `409 CREDIT_LIMIT_EXCEEDED` and its whole
  sale (stock included) rolls back.

### Selling, refunding and collecting

- `ACCOUNT` is a payment method. It requires a customer on the sale and is non-cash, so it
  can never exceed the total or produce change. Available credit = limit − balance (store
  credit adds to it).
- Returns and voids refund by the original methods (ADR 0008), so an account sale is refunded
  to the account (a REFUND entry), never in cash.
- Collections (`POST /customers/:id/payments`) are idempotent, numbered `PAY-…`, and may
  exceed what is owed (the excess becomes store credit). Cash collections must name the
  collector's open shift: they count in its expected drawer cash, and closing the shift waits
  for them.
- Offline account sales cannot check the limit: they are charged as they happened and flagged
  `CREDIT_LIMIT_EXCEEDED` for review if the balance went over (ADR 0009).

### Statements and history

A statement covers business days in the tenant's timezone: opening balance (the last entry
before the period), entries with running balances, closing balance; printable on the web.
Cashiers can see a customer's full purchase history (with `customers.read`), while the
general sales list still shows them only their own shifts.

## Consequences

- Balances are always explainable from the ledger; corrections are new entries, never edits.
- Write-offs of bad debt and interest are not supported yet; they would be new entry types
  with approval.
- Customers cannot be attached on an offline till yet (lookup needs the server), but an
  attached customer survives a dropped connection.
