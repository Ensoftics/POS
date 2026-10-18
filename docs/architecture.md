# Architecture overview

## Shape of the system

```
 Android app (Expo)      Web app (React/Vite)      Admin console (Slice 12)
        │  Bearer + refresh token     │  Bearer + httpOnly cookie
        └──────────────┬──────────────┘
                       ▼
              NestJS API  /api/v1   (modular monolith)
   ┌──────────┬──────────┬────────┬────────┬───────────┐
   │ auth     │ tenant   │ audit  │ mail   │ health    │  … one module per business capability
   └──────────┴──────────┴────────┴────────┴───────────┘
                       ▼
        PostgreSQL 17 (Prisma, row-level security)      Mailpit / SMTP
```

Clients and API share `@pos/contracts` (Zod), so request validation on the server,
form validation in the clients and the OpenAPI document all come from one schema.

## API conventions

- **Prefix:** `/api/v1`; health probes live at `/health/live` and `/health/ready`.
- **Errors:** always `{ error: { code, message, requestId, issues? } }`. `code` is a stable
  enum (`ERROR_CODES` in contracts); `issues[].message` is an i18n key. Internal errors never
  reach clients; framework messages that could echo input are replaced.
- **Request IDs:** a well-formed `X-Request-Id` is honoured, otherwise generated; it is
  returned in a response header, in error envelopes, in access logs and in audit entries.
- **Logging:** one structured line per request (method, path without query, status,
  duration, tenant, user). Bodies, tokens and passwords are never logged.
- **Pagination:** cursor-based (`cursor`, `limit` ≤ 100, `nextCursor`), ordered by
  `(created_at DESC, id DESC)` backed by a matching composite index.
- **Body size:** JSON bodies up to 6 MB (for CSV imports of up to 5 MB); every route still
  validates its own schema, so large bodies are rejected early on other routes by field limits.
- **Transactions:** default 15 s timeout and 5 s to obtain a connection; CSV import allows 120 s.
- **Rate limits:** global per-IP limit plus a stricter `auth` limit applied only to routes
  marked `@SensitiveRateLimit()` (register, login, forgot/reset password). Counters are
  in-memory per instance — a Redis store is required before running multiple replicas.

## Tenancy and authorisation

See [ADR 0003](adr/0003-tenant-isolation.md). Summary:

1. The tenant is **always** taken from the verified session, never from a URL or body.
2. Each request resolves the caller from live database state (session active, membership
   active, user active, tenant not suspended) — logout, role changes and suspensions apply
   immediately.
3. `@RequirePermissions()` checks the live role against the permission map in `@pos/domain`.
4. Tenant data is accessed via `PrismaService.withTenant(tenantId, tx => …)`, which sets a
   transaction-local `app.tenant_id`; PostgreSQL RLS policies reject other tenants' rows even
   if application code forgets a filter. The API connects as `pos_app` (no BYPASSRLS).

## Authentication

See [ADR 0002](adr/0002-authentication-sessions.md). Short-lived JWT access tokens (15 min)
plus opaque, rotating refresh tokens stored only as SHA-256 hashes. Web receives the refresh
token as an httpOnly `SameSite=Strict` cookie scoped to `/api/v1/auth`; mobile stores it in
SecureStore. Replaying a rotated refresh token revokes the whole session family.

Passwords: scrypt (N=2¹⁶, r=8, p=1) via Node crypto; NIST-style policy (≥ 10 code points,
common-password deny-list, must not contain name/email). Accounts lock for 15 minutes after
5 consecutive failures. Password reset tokens are single-use, hashed, expire in 30 minutes,
are capped at 5 per hour per account, and a successful reset signs the user out everywhere.

## Audit log

`audit_logs` is append-only for the application role (UPDATE/DELETE revoked). Entries are
written in the same transaction as the change they describe and carry actor, request ID, IP
and user agent. Platform-level security events (failed logins, lockouts, password resets)
have no tenant and are invisible to tenants.

## Data model

`tenants` ─< `memberships` >─ `users`; `memberships` ─< `sessions`; `users` ─<
`password_reset_tokens`; `audit_logs` → tenant (nullable) and actor. Users are global so a
person can belong to several businesses (e.g. a manager working for two shops).

Slice 2 adds `tenant_settings` (1:1 with tenant), `branches` and `registers`. A register's
foreign key is `(tenant_id, branch_id) → branches(tenant_id, id)`, so even code running with
RLS bypassed cannot attach a register to another tenant's branch. Editable records carry a
`version` column: updates must send the version they read and are applied with
`UPDATE … WHERE version = $read`, answering 409 `VERSION_CONFLICT` otherwise. The same
mechanism will back offline conflict detection in Slice 7.

The catalogue (Slice 3) is `categories` ─< `products` ─< `product_variants`, all with RLS
and composite tenant foreign keys. Money is stored in integer minor units and quantities as
`DECIMAL(12,3)`; see [ADR 0005](adr/0005-money-and-catalog-model.md).

Inventory (Slice 4) is an append-only `stock_movements` ledger with per-batch `stock_levels`
balances that can never go negative, plus purchasing and stock documents with client-generated
ids for safe retries; see [ADR 0006](adr/0006-stock-ledger.md).

Checkout (Slice 5) prices carts with one shared function on clients and server, records
immutable, idempotent sales within cashier shifts, and takes stock through the ledger under
the tenant's negative-stock policy; see [ADR 0007](adr/0007-checkout-sales-and-shifts.md).
Returns, voids, manager approvals and drawer cash (Slice 6) add insert-only records linked to
sales, never edits; see [ADR 0008](adr/0008-returns-voids-approvals.md).
Offline selling (Slice 7) shares one sync engine (`@pos/offline`) between the tills, with an
outbox of idempotent sales and a manager review queue for differences found on sync; see
[ADR 0009](adr/0009-offline-sales-and-sync.md).
Customers (Slice 8) have an account balance kept by an insert-only ledger with race-safe credit
limits, payment on account, collections into the drawer and statements; see
[ADR 0010](adr/0010-customers-and-accounts.md).
Reporting (Slice 9) aggregates the immutable records in SQL by business day, with cost of goods
captured on each sale at the moving average cost; see [ADR 0011](adr/0011-reporting-and-costing.md).
Staff management (Slice 10) adds e-mail invitations, role rules, per-member branch restrictions
enforced in the API and enrolled Android devices that can be blocked; see
[ADR 0012](adr/0012-staff-branches-devices.md).
Subscriptions (Slice 11) add plans with limits, a trial → active → past due → read-only
lifecycle, PayHere hosted checkout with verified, idempotent notifications, and owner e-mail
verification; see [ADR 0013](adr/0013-plans-subscriptions-billing.md).
The platform console (Slice 12) gives operator staff a separately authenticated (password +
authenticator code), fully audited view of businesses, subscriptions and plans, with no access
to trading data; see [ADR 0014](adr/0014-platform-console.md).
Feature flags and notifications (Slice 13a) add per-business switches managed by staff, and
per-person in-app notifications with a once-a-day run in each business's time zone; see
[ADR 0015](adr/0015-feature-flags-and-notifications.md).
Loyalty points (Slice 13b) are a race-safe customer balance with an append-only history,
spent as an online-only payment method and reversed exactly on returns; see
[ADR 0016](adr/0016-loyalty-points.md).
Product images (Slice 13c) are re-encoded on upload and kept in a private S3-compatible bucket;
apps load them through stable signed links that redirect to short-lived bucket URLs; see
[ADR 0017](adr/0017-product-images.md).
Sales never take stock from expired batches online, and offline sales that had to are flagged
for review (Slice 13d); see [ADR 0018](adr/0018-expired-stock-at-the-till.md).
Android tills print receipts on Bluetooth LE thermal printers as ESC/POS raster images, so
every script prints as on screen (Slice 13e); see
[ADR 0019](adr/0019-bluetooth-receipt-printers.md).
Customer messages (Slice 13f) go only to customers with recorded consent, are queued and sent
in the background by e-mail or Notify.lk SMS, and always carry an opt-out link; see
[ADR 0020](adr/0020-customer-messaging-and-consent.md).

Industry behaviour lives in the settings row as explicit switches (batch numbers, expiry
dates, fractional quantities, variant attributes, units). Presets in `@pos/domain` seed them at
first onboarding; owners can change them later without a code change.

## Offline-first (planned, Slice 7)

See [ADR 0004](adr/0004-offline-strategy.md). Each device keeps its own local store (SQLite on
Android, IndexedDB on web) and a durable outbox of idempotent commands; the server is the
source of truth for stock. Per-device stores **cannot** share live inventory with each other
while offline — that needs a separate LAN coordination server, designed separately.

## Known limitations (current)

- Rate-limit counters are per process (Redis store needed for multiple API replicas).
- Sinhala and Tamil strings are drafts pending native-speaker review (shared in `@pos/i18n`).
- The mobile app does not yet support offline sign-in; if the server is unreachable at start
  it keeps the stored session and offers a retry (Slice 7 adds offline operation).
- Activity-log times still render in the viewer's timezone; business-timezone rendering
  arrives with the first business-day features (shifts, Slice 5).
