# Roadmap — vertical slices

Each slice ships end to end (migration → domain → API → web/mobile UI → tests → docs) and
leaves the application working. A slice is **done** only when its checklist below is met
with evidence (CI green, tests listed).

| #   | Slice                                                                               | Status                     |
| --- | ----------------------------------------------------------------------------------- | -------------------------- |
| 0   | Repository, tooling, Docker Compose, CI, health checks                              | ✅ Done                    |
| 1   | Tenant registration, login, sessions, password reset, onboarding                    | ✅ Done                    |
| 2   | Business settings: currency, timezone, languages, branches, registers, profiles     | ✅ Done                    |
| 3   | Products, categories, barcodes, variants, attributes, units, pricing, CSV           | ✅ Done                    |
| 4   | Suppliers, purchase orders, receiving, stock ledger, adjustments, transfers, counts | ✅ Done                    |
| 5   | POS checkout, cart, discounts, taxes, split payments, receipts, shifts              | ✅ Done                    |
| 6   | Returns, refunds, voids, approvals, cash reconciliation                             | ✅ Done                    |
| 7   | Offline sales (SQLite / IndexedDB), outbox, idempotent sync, conflicts              | ✅ Done                    |
| 8   | Customers, purchase history, credit, collections, statements                        | ✅ Done                    |
| 9   | Reports, dashboards, profit, CSV/PDF exports                                        | ✅ Done                    |
| 10  | Staff management, roles, permissions, devices                                       | ✅ Done                    |
| 11  | Plans, entitlements, trials, subscription lifecycle, payment-provider adapter       | ✅ Done                    |
| 12  | Super-admin console (`/platform` in the web app), support tools                     | ✅ Done                    |
| 13  | Notifications, loyalty, integrations, industry modules, feature flags               | Done (13a–13f)             |
| 14  | Security review, load tests, backups/restore drills, deployment, pilot              | In progress (14a–14c done) |

## Slice 0 — acceptance criteria (met)

- [x] pnpm + Turborepo monorepo with `api`, `web`, `mobile` apps and shared packages.
- [x] Strict TypeScript, ESLint 10, Prettier; `pnpm lint`, `typecheck`, `format:check` pass.
- [x] Docker Compose: Postgres 17 (owner + restricted app role, test DB), Mailpit, Redis (opt-in).
- [x] Validated environment config that fails fast with readable errors; `.env.example` files.
- [x] Liveness and readiness endpoints; structured logs with request IDs; error envelope.
- [x] GitHub Actions CI: format, lint, typecheck, build, clean-database migrations, unit +
      integration tests, Playwright E2E.
- [x] ADRs 0001–0004, README, architecture overview.

## Slice 1 — acceptance criteria (met)

- [x] An owner can register a business; tenant, owner account and membership are created atomically.
- [x] Login with lockout, tenant selection for multi-business users, constant-work failure path.
- [x] Access/refresh tokens with rotation, reuse detection, logout, logout-all; web cookie + CSRF header; mobile SecureStore.
- [x] Forgot/reset password via email, single-use hashed tokens, per-account cap, all sessions revoked.
- [x] Onboarding: business name, type (cosmetics / textile / general retail), contact phone.
- [x] Tenant isolation in API and PostgreSQL RLS; cross-tenant and escalation tests.
- [x] Append-only audit log with tenant-scoped, paginated activity view (owners, managers).
- [x] Web UI with loading, empty, error/retry and success states; keyboard and screen-reader labels; en/si/ta switcher.
- [x] Android app: sign in, business selection, forgot password, session restore, offline-at-start retry, sign out (all devices).
- [x] Tests: domain/contracts/client unit tests, API unit + integration, web component tests, Playwright E2E (desktop + mobile viewport), mobile Jest tests, Android bundle export.

## Slice 2 — acceptance criteria (met)

- [x] Tenant settings (legal name, tax registration number, address, country, currency, IANA
      timezone, default and enabled languages) with defaults LKR / Asia/Colombo / en+si+ta.
- [x] Industry profiles: presets for cosmetics (batches, expiry), textiles (part quantities,
      metres, colour/size/design) and general retail; applied once at onboarding, editable after.
- [x] Branches and registers with per-tenant / per-branch unique codes, archive and restore,
      at least one active branch (row-locked), registers blocked in archived branches.
- [x] Optimistic concurrency (`version`, 409 `VERSION_CONFLICT`) on settings, branches, registers.
- [x] RLS on `tenant_settings`, `branches`, `registers`; tenant-scoped composite foreign key
      register → branch; CHECK constraints for codes, currency, country and versions.
- [x] Permissions: every role reads settings and branches; owners edit settings; owners and
      managers manage branches and registers.
- [x] Every change audited with a field-level diff and shown in the activity log.
- [x] Web settings area (business, currency & language, product options, branches & registers)
      with loading, empty, error/retry, conflict and read-only states; business default language.
- [x] Android: choose the device's register (stored per tenant, re-validated on every load),
      currency and register shown on the home screen.
- [x] Shared `@pos/i18n` package used by web and mobile, with key-consistency tests.
- [x] Tests: domain, contracts, client, 19 new API integration tests (concurrency, isolation,
      permissions, FK), web component tests, mobile tests, Playwright settings journey.

**Deferred by design:** currency becomes read-only once the first sale exists (enforced in
Slice 5 together with sales); branch/register limits per plan arrive with entitlements in
Slice 11; device enrolment (Slice 10) now records the register choice on the server too.

## Slice 3 — acceptance criteria (met)

- [x] Categories (two levels, case-insensitive unique names per parent, archive/restore).
- [x] Products with one or more variants; variant options limited to the enabled attributes;
      units limited to the enabled units; part-quantity rule for reorder levels.
- [x] SKUs and barcodes unique per tenant (including archived items), EAN/UPC check digits
      verified, field-level errors for taken codes, 409 fallback for races.
- [x] Integer minor-unit money end to end with decimal-safe parsing and formatting (ADR 0005).
- [x] Search by name/brand (trigram index), SKU prefix and exact barcode; category filter
      including subcategories; cursor pagination.
- [x] Barcode-first lookup endpoint for checkout; archived items are never returned.
- [x] CSV import with dry run, line/column error report, all-or-nothing apply and SKU upsert;
      CSV export with formula-injection protection and a UTF-8 BOM.
- [x] Costs hidden from cashiers; inventory staff manage products; only owners/managers import
      and export.
- [x] RLS on `categories`, `products`, `product_variants`; tenant-scoped composite foreign keys;
      CHECK constraints for SKU format, money and quantities.
- [x] Web: product list (barcode Enter opens the item, responsive rows on phones), product
      editor with variants, categories, CSV import/export. Android: price check that works
      with keyboard-wedge scanners.
- [x] Tests: domain (money, barcodes, CSV, quantities), contracts, client, 18 new API
      integration tests, web component tests, mobile tests, Playwright catalogue journey.

**Deferred by design:** stock quantities and batch/expiry capture arrive with receiving
(Slice 4); camera barcode scanning on Android arrives with the checkout screen (Slice 5);
product images need object storage and are scheduled with Slice 13 integrations.

## Slice 4 — acceptance criteria (met)

- [x] Suppliers (case-insensitive unique names, archive/restore).
- [x] Purchase orders: draft → ordered → partially/fully received, or cancelled; drafts editable,
      version-checked transitions, totals computed exactly (BigInt, half-up).
- [x] Goods receiving with or without an order; items must be on the order; batch/expiry required
      when the profile tracks them; unit costs recorded on the ledger.
- [x] Append-only stock ledger and per-batch balances that can never go negative, even under
      concurrent requests; ledger sum equals balance (tested).
- [x] Adjustments with reasons and direction rules; FEFO allocation for removals.
- [x] Transfers between branches (in transit → received / cancelled, exactly once).
- [x] Stock counts that correct to the counted quantity at completion time, including items
      added during the count; one open count per branch.
- [x] Idempotent receipts, adjustments and transfers via client-generated ids; gapless numbers.
- [x] RLS on all 15 new tables; tenant-scoped composite foreign keys everywhere.
- [x] Web: stock levels with low/expiring filters and history, receive (from a PO), adjust,
      transfers, counts, suppliers, purchase orders. Android: price check shows stock at the
      device's branch.
- [x] Tests: domain (milli-unit quantities, FEFO, exact line totals), contracts, 16 new API
      integration tests including races and the ledger invariant, web component tests (including
      retry with the same document id), mobile tests, Playwright purchase-to-count journey.

**Deferred by design:** weighted-average cost of goods sold (Slice 9 with profit reports);
approval rules for large adjustments (Slice 6); staff-to-branch restrictions (done in Slice 10);
selling decrements stock through the same ledger in Slice 5.

## Slice 5 — acceptance criteria (met)

- [x] Configurable tax rates (never hard-coded): one default, per-product override, 0 % for
      exempt items, rates in use cannot be archived; prices inclusive or exclusive of tax.
- [x] Cart with barcode/SKU scanning (keyboard-wedge scanners and typing on web and Android;
      camera scanning on Android), quantity editing, line and sale discounts (percent or
      amount, permission-gated).
- [x] Shared exact pricing (`computeCart`): BigInt, half-up, proportional discount allocation;
      the API re-prices with its own data and refuses a different total (`TOTAL_MISMATCH`).
- [x] Split payments (cash, card, bank transfer, other); change only from cash; no card data —
      only an approval code, with card-number-like input rejected.
- [x] Idempotent sale submission (client id reused on retry, simultaneous retries settled by
      the primary key, request fingerprint detects a reused id); gapless `INV-` numbers.
- [x] Stock taken through the ledger (`SALE`, FEFO); negative-stock policy setting (default off),
      race-safe either way.
- [x] Shifts: opening float, one open shift per register, cashier ownership, close with counted
      cash, expected cash and difference; closing waits for in-flight sales.
- [x] Receipts with business identity (name, legal name, tax number, address, branch, footer),
      tax breakdown, payments and change; 80 mm print layout on the web; receipt on Android.
- [x] Sales history (business-day filters in the tenant timezone, number search); cashiers see
      only their own shifts' sales.
- [x] RLS on all 5 new tables; sales, lines and payments are immutable for the app role;
      CHECK constraints keep totals consistent.
- [x] Tests: domain pricing/cart/allocation, contracts, 15 API integration tests (concurrency,
      idempotency, isolation, grants), web component tests (including retry and fast-scan
      regressions), Android tests (camera hand-off, retry), Playwright checkout journey.

**Deferred by design:** voids, returns, refunds and approval limits (Slice 6); offline sales and
surviving an app restart mid-sale (Slice 7); customers on sales (Slice 8); direct thermal /
Bluetooth printing (hardware integration, Slice 13); compound taxes.

## Slice 6 — acceptance criteria (met)

- [x] Returns as new, immutable records linked to the sale (sales never change); partial and
      repeated returns; returned state derived per sale and per line.
- [x] Exact pro-rated refunds (cumulative rounding, discount share and tax included) shared by
      API and web form; refunds limited to the original payment methods and amounts.
- [x] Restocked items go back through the ledger to the batches they were sold from; damaged
      items are refunded without restocking.
- [x] Voids: whole sale, original payments mirrored, only in its open shift and before any return,
      at most once.
- [x] Manager approvals with personal PINs (scrypt, password to set, lockout after 5 failures,
      audited) for over-limit discounts, returns (configurable), voids and pay-outs; approver
      recorded; clients retry the same request with the approval.
- [x] Cash pay-ins / pay-outs per shift; expected drawer cash includes refunds and movements;
      shift summary shows returns, refunds by method and cash movements.
- [x] Idempotent returns and cash movements; simultaneous returns cannot over-refund (advisory
      lock); returns, refunds and cash movements are insert-only for the app role.
- [x] Web: find any receipt by number, return form with live refund, void, approval dialog,
      cash in/out, approval settings and personal PIN. Android: approval prompt for
      discounts, cash in/out.
- [x] Tests: domain (pro-rating, refund limits, approval rule, drawer cash), 13 API integration
      tests (lockout, races, batches, isolation, grants), web and Android component tests,
      Playwright return → void → pay-out → reconcile journey.

**Deferred by design:** price overrides at the till (discounts with approval cover it);
returns on Android (Slice 7, with offline sales); printable shift / Z reports (Slice 9
reports); remote approval requests.

## Slice 7 — acceptance criteria (met)

- [x] Shared `@pos/offline` engine with storage adapters: IndexedDB (Dexie) on the web, SQLite on
      Android (survives restarts), memory for tests; one database per tenant.
- [x] Catalogue delta sync (`/sync/catalog`) with resumable cursors, overlap against late commits,
      archived items propagated; tax rates, settings and the open shift cached.
- [x] Scanning and search fall back to the local catalogue when the server is unreachable.
- [x] Sales that cannot reach the server are completed locally with a pending-number receipt and
      queued under their original id; sent oldest first; a re-send of a sale the server already has
      returns the original (fingerprint ignores offline details); refused sales parked for review.
- [x] Server records offline sales at the charged prices, takes stock regardless, accepts closed
      shifts/archived items/unapproved discounts — each flagged as a conflict; still checks the
      till's arithmetic, payments and capture time.
- [x] Manager review queue with facts and resolution notes (audited; conflicts never deleted).
- [x] Android returns screen (find receipt, steppers limited to what is left, refunds by original
      method, approval).
- [x] Tests: engine (paging, ordering, failures, concurrency), 7 API integration tests, web tests
      with fake IndexedDB (offline completion and send, offline scanning, review), Android tests
      (offline completion, offline scanning, returns), Playwright with the browser really offline.

**Deferred by design:** service worker so the web till can be reloaded offline; offline shift
open/close, returns, voids and cash movements; customers on offline sales (Slice 8).

## Slice 8 — acceptance criteria (met)

- [x] Customer profiles with minimal personal data, phone normalised to E.164 (unique per business),
      timestamped marketing consent, archive; personal details never written to audit logs.
- [x] Lookup by phone (any format), name or number at the till (web and Android) and in the back office;
      quick add from the till.
- [x] Account balance with an insert-only ledger (charge, payment, refund); credit limits set only by
      managers and enforced race-safely; store credit from overpayments and refunds.
- [x] `ACCOUNT` payment method on web and Android; refunds of account sales go back to the account;
      offline account sales over the limit flagged for review.
- [x] Collections (idempotent, numbered, any method); cash collections tied to the collector's open
      shift and counted in expected drawer cash.
- [x] Statements by business-day range with opening/closing and running balances, printable;
      purchase history per customer.
- [x] Tests: domain (phone normalisation, available credit, running balances), 8 API integration
      tests (limit race, refunds to account, store credit, statements, isolation, grants), web and
      Android tests, Playwright account-sale → collection → statement journey.

**Deferred by design:** bad-debt write-offs and interest; customer attach on an offline till;
loyalty points (Slice 13); customer messaging (Slice 13, consent already recorded).

## Slice 9 — acceptance criteria (met)

- [x] Moving weighted-average cost per variant (4-decimal precision, updated under lock on each
      receipt); cost of goods stored on every sale movement; returns restocked at their original
      cost; one-off backfill for existing data.
- [x] Sales report by day, branch, cashier, category, item or payment method; refunds by return
      date; tax report net of refunded tax; profit and margin by day, category or item with
      unknown-cost warnings; stock valuation; aged receivables; shift (Z) reports.
- [x] All periods are business days in the tenant timezone; fixed, parameterised SQL.
- [x] Dashboard for owners and managers: today vs yesterday tiles, 7-day sales chart (accessible:
      focusable bars, tooltip, hidden data table), top items, attention links.
- [x] CSV export of every report from the API with formula injection neutralised; print layouts
      for saving as PDF.
- [x] Access: `reports.view` and `reports.profit` for owners and managers only.
- [x] Tests: domain (average cost, cost of quantity, margin, FIFO ageing), 6 API integration tests
      (costing incl. concurrent receipts, all reports, CSV, permissions, isolation), web tests,
      Playwright journey with a real CSV download and a Z report.

**Deferred by design:** server-rendered PDF files and scheduled/e-mailed reports; materialised
summaries for very large tenants; reports on Android (managers use the web app).

## Migration checklist (every slice)

1. `pnpm db:migrate` to generate SQL, then **hand-add RLS** (`ENABLE` + `FORCE` + `tenant_isolation`
   policy) for every new tenant-owned table, and indexes that start with `tenant_id`.
2. Verify on a clean database: `pnpm db:test:deploy` after `docker compose down -v`.
3. Add cross-tenant read/update/delete/export tests for the new tables.
4. Generated SQL always contains `DROP INDEX "product_variants_sku_prefix_idx"` followed by the
   same `CREATE INDEX`: Prisma cannot compare operator classes on multi-column indexes. Remove
   both lines. Never accept a generated drop of `stock_levels_branch_variant_batch_key` or
   `stock_count_lines_item_key` (NULLS NOT DISTINCT keys the stock ledger depends on).

## Slice 10 — acceptance criteria (met)

- [x] Invite staff by e-mail with a role and optional branches: single-use 7-day link, only the
      token hash stored, re-inviting replaces the open link, invitations can be withdrawn.
- [x] Public accept page: new people choose name and password (policy-checked); existing
      accounts confirm with their password; the link is claimed atomically and cannot be reused.
- [x] Role rules: owners manage everyone, managers manage cashiers and inventory staff; nobody
      changes their own access; at least one active owner is kept under a row lock.
- [x] Disable/enable members and change roles or branches with optimistic versions; every change
      signs the member out everywhere and takes effect on the next request.
- [x] Branch restrictions enforced in the API on shifts, sales, returns, customer payments,
      stock levels and history, receipts, adjustments, counts, transfers, reports and the branch
      list (`BRANCH_NOT_ALLOWED`).
- [x] Devices: each Android install has an id sent at sign-in and enrolled when choosing a
      register; owners and managers list, block (signs out and refuses sign-in) and allow tills.
- [x] Audit of invitations, joins, role/status/branch changes and device events, without e-mail
      addresses.
- [x] Web: Settings › Staff and Devices, accept-invitation page; Android: device id, enrolment,
      blocked-device message; en/si/ta strings.
- [x] Tests: domain rules, 18 API integration tests (invitations, role rules, sign-out on change,
      branch enforcement, devices, isolation), web and Android tests, Playwright invite → accept →
      restricted → disabled journey through real e-mail.

**Deferred by design:** ownership transfer; dashboards across several allowed branches at once
(a restricted manager's dashboard shows their first branch); hardware attestation of devices
(Play Integrity); per-plan staff and device limits (Slice 11).

## Slice 11 — acceptance criteria (met)

- [x] Plans as platform data (Starter, Growth, Business; LKR, tax-exclusive monthly and yearly
      prices) with limits on branches, registers, staff (including open invitations) and tills,
      enforced in the API under a subscription row lock, including restores and re-enables.
- [x] Every new business starts a free trial (configurable days and plan); existing businesses
      were given one by the migration.
- [x] Lifecycle: trial → active → past due (grace period) → suspended (read-only), or cancelled
      at period end; pure, clock-tested domain rules; a multi-instance-safe sweep sends one
      reminder before each trial or period ends and a notice on each change.
- [x] Read-only mode: reads and exports keep working; changes return `SUBSCRIPTION_INACTIVE`
      except billing, verification and sign-out; offline tills keep queued sales until paid.
- [x] Payment-provider adapter with PayHere hosted checkout: signed checkout form, verified
      notifications (constant-time signature check, merchant and amount checks), idempotent
      `payment_events`, chargebacks suspend, no card data stored, and no fake responses when
      unconfigured (`PAYMENTS_UNAVAILABLE`).
- [x] Invoices in LKR with configurable tax, one open invoice at a time, period dates set when
      paid; paying early keeps paid and trial days.
- [x] Owner e-mail verification (single-use links, resend, proven by invitation or reset)
      required before paying.
- [x] Web: Plan & billing (status, usage meters, plans, monthly/yearly, checkout, waiting for
      confirmation, cancel/resume, invoices), verify-email page, account banners; Android:
      read-only notice; en/si/ta strings.
- [x] Tests: domain lifecycle/period/tax rules, PayHere adapter unit tests, 19 API integration
      tests (trial, verification, checkout, signatures, idempotency, mismatches, chargeback,
      limits incl. concurrency, lifecycle, read-only, isolation), web, Android and offline
      tests, Playwright verification → trial → plan-limit journey.

**Deferred by design:** saved-card automatic renewal (needs the provider's recurring API and
tokens); proration on plan changes; PDF invoices; manual bank-transfer payments recorded by
platform staff (Slice 12 console); a manual end-to-end check against the PayHere sandbox with
real credentials before launch.

## Slice 12 — acceptance criteria (met)

- [x] Platform staff sign in separately: password plus a single-use authenticator code (TOTP,
      RFC 6238 vectors tested), encrypted secrets, shared lockout, one generic error.
- [x] Admins are granted, reset and revoked only by the server command-line tool
      (`platform:admin`); revoking ends console sessions at once.
- [x] Separate session table and token audience: tenant tokens cannot open the console and
      console tokens cannot open tenant routes; idle (30 min) and absolute (8 h) limits; sign-out.
- [x] Overview (businesses, sign-ups, subscription statuses, recurring revenue, payments,
      provider and billing-sweep status), business search and filters, business details
      limited to account, subscription and billing data.
- [x] Support actions with mandatory reasons: suspend (sessions revoked, sign-in refused),
      reinstate, close (typed slug confirmation), extend, change plan (must fit usage), record
      bank transfers (same payment path, one per reference).
- [x] Plan management: create, edit with versions, offer or hide; never delete.
- [x] Append-only platform audit log (actor, IP, request id; viewing a business is logged), and
      matching "by Ensoftic support" entries in the business's own activity log.
- [x] Web console at `/platform` with its own in-memory session; en strings.
- [x] Tests: TOTP and encryption unit tests, 13 API integration tests, web tests, Playwright
      journey using the real CLI to grant and revoke access.

**Deferred by design:** feature flags (with the first feature that needs them, Slice 13);
owner-approved, time-limited support access to a shop's data; a separate admin deployment
origin (possible at the proxy); console translations beyond English.

## Slice 13a — acceptance criteria (met): feature flags and notifications

- [x] Feature flags defined in code with database defaults and per-business overrides; platform
      console page and per-business settings (versioned defaults, reasons, platform audit);
      enabled flags returned in the session.
- [x] Per-person notifications with idempotent generation (dedupe keys) and 90-day retention.
- [x] Daily run per business after 07:00 local time, claimed once across instances: stock alerts
      per branch (low stock, batches expiring within 30 days) for people who may work there;
      yesterday's sales summary for unrestricted managers behind a flag.
- [x] Event notifications: offline sales needing review (reviewers at that branch) and
      subscription changes (owners).
- [x] Morning digest e-mail per person, with a business-level flag and a personal opt-out.
- [x] Web: header bell with unread count, Notifications page, stock page opened from alerts;
      Android: unread button and list; console: flag management.
- [x] Tests: domain (flag resolution, timing), 9 API integration tests (timing, idempotency,
      branch access, flags, opt-out, retention, conflicts, subscription, inbox isolation),
      web and Android tests.

**Deferred by design:** push notifications to phones (needs FCM credentials and device
tokens); real-time stock alerts on each movement.

## Slice 13b — acceptance criteria (met): loyalty points

- [x] Owner settings (on/off, spend per point, point value, minimum use) behind a platform flag.
- [x] Points earned on sales with a customer (on what was not paid with points); points as a
      payment method, whole points only, within the balance, online only (server and both
      checkouts refuse offline use).
- [x] Race-safe balance (conditional update; concurrent spending tested) and an append-only
      points history with the balance after each entry; rates frozen on each sale.
- [x] Returns give back spent points and take back earned points proportionally, exact over
      partial returns; negative balances allowed after spent points are reversed.
- [x] Manager adjustments with reasons (idempotent, audited, never below zero); points cannot
      pay off accounts.
- [x] Web: settings, checkout points hint and one-tap use, receipts, customer points card;
      Android: points at checkout and on the receipt.
- [x] Tests: domain rules, 10 API integration tests, web and Android tests.

**Deferred by design:** points expiry; tiers and promotions.

## Slice 13c — acceptance criteria (met): product images

- [x] Private S3-compatible bucket (SeaweedFS locally and in CI; any S3 service in production);
      uploads refused with `STORAGE_UNAVAILABLE` when no bucket is configured.
- [x] Upload, reorder (main photo first) and remove, for `products.manage` only; up to 8 per
      product; JPEG/PNG/WebP checked by content; size and pixel limits.
- [x] Every photo re-encoded to WebP (1600 px and 400 px), upright, with EXIF/GPS removed;
      the same file uploaded twice is kept once; failed saves remove the stored files.
- [x] Stable signed links (HMAC, constant-time check) that redirect to short-lived bucket URLs;
      forged or re-pointed links get 404; the bucket refuses direct reads.
- [x] Photos in product responses and the till catalogue sync; changes audited and picked up
      by delta sync.
- [x] Web: Photos card on the product page, thumbnails in the product list and item picker;
      Android: photo on the price check.
- [x] Tests: image processing and link signing (unit), 6 API integration tests against real
      storage, web and Android tests, an end-to-end photo upload on desktop and phone.

**Deferred by design:** taking photos inside the Android app; a sweeper for files left behind
by failed deletes.

## Slice 13d — acceptance criteria (met): expired stock at the till

- [x] Online sales never take stock from expired batches; when only expired stock would cover
      the sale, it is refused with `EXPIRED_STOCK` (also under a negative-stock policy).
- [x] Expiry judged on the business's calendar; the expiry date itself is the last day of sale.
- [x] Offline sales are recorded as they happened (unexpired first, then expired, then any
      shortfall) and flagged `EXPIRED_SOLD` with batch, date and quantity for manager review.
- [x] Textiles checked: measured and fractional quantities and size/colour variants are already
      covered by the core; no change needed.
- [x] Tests: domain allocation rules, 4 API integration tests, web review page.

## Slice 13e — acceptance criteria (met): Bluetooth receipt printers on Android

- [x] Receipt printer screen: find nearby printers, choose one (print characteristic found
      and saved per device), paper width 58/80 mm, automatic printing, test page, forget.
- [x] Receipts print as an ESC/POS raster image, so Sinhala, Tamil and Latin text print as on
      screen; jobs are chunked to the Bluetooth MTU and paced; the app disconnects after each job.
- [x] Print button and optional automatic printing after every sale, including sales saved
      offline; errors explained in plain words (Bluetooth off, permission, unreachable, ...).
- [x] Android permissions declared by the config plugin (Nearby devices; location only on
      Android 11 and older); the Bluetooth and screenshot modules build and the app's native
      code compiles against them (a full APK build on Windows needs long paths enabled).
- [x] Tests: ESC/POS encoding, base64 and PNG decoding, printer screen and receipt printing
      against a fake Bluetooth manager.

**Deferred by design:** classic-Bluetooth-only printers; cash drawers on the printer port;
checking on real printer models (pilot checklist, Slice 14).

## Slice 13f — acceptance criteria (met): customer messaging with recorded consent

- [x] Append-only consent history (granted or withdrawn, by staff with a note, or by the
      customer through the link), back-filled for earlier consents; shown on the customer page.
- [x] Opt-out link in every message (`/u/<code>`, also `List-Unsubscribe`); confirming
      withdraws consent and skips queued messages; no sign-in; rate-limited.
- [x] E-mail and SMS campaigns to customers who agreed, with `{name}`; idempotent; queued and
      sent in the background once per message across instances, consent re-checked before
      sending, temporary failures retried up to three times.
- [x] Notify.lk SMS with Unicode for Sinhala and Tamil; unavailable (503) until configured;
      SMS part counting; monthly SMS allowance per plan, enforced under a lock.
- [x] `customers.message` permission (owners, managers) and a `messaging` feature flag.
- [x] Tests: SMS length and personalisation rules, 9 API integration tests (including the
      gateway's request format against a local server), web tests for the composer, consent
      history and opt-out page.

**Deferred by design:** delivery reports; audience filters and scheduled sending; editing the
SMS allowance in the platform console.

## Slice 14a — acceptance criteria (met): security review

- [x] Code and configuration review recorded in
      [docs/security/review-2026-10.md](security/review-2026-10.md) with findings, fixes and
      accepted risks.
- [x] Fixed: vulnerable `nodemailer` (upgraded), `deepmerge-ts` and `js-yaml` (pinned); row-level
      security on the platform audit log; Android backups off and https required in release
      builds; https required for public links in production; opt-out codes masked in logs.
- [x] Guards that keep it so: every route must declare a permission, `@SelfService` or a
      reviewed `@Public`; the live schema must force RLS on every table naming a business, keep
      the application role restricted, and keep evidence tables append-only; CI fails on new
      advisories in shipped dependencies.

**Still to do:** an independent penetration test of the deployed pilot; web hosting security
headers (with 14c); upgrade test tooling to Vitest 4 (dev-only advisories, S-11).

## Slice 14b — acceptance criteria (met): load tests

- [x] Reproducible load tests (`infra/load`): seed through the public API, k6 scenarios for shop
      traffic, year-long reports, write throughput and a ceiling ramp; targets set beforehand.
- [x] Results recorded in [docs/performance/load-test-2026-10.md](performance/load-test-2026-10.md):
      every target met with 40 tills, offline-sync bursts and managers on reports; no failed
      requests; one API process sustains about 65–70 sales per second within target on a laptop.
- [x] Fixed what the tests found: product, category, tax and profit reports and the dashboard
      grew with a shop's whole history; sale lines now carry their sale's date and branch
      (copied by a database trigger), and reports filter by them (year-long category report p95
      3.97 s → 2.6 s; dashboard 726 → 84 ms; one-day category report 1.7 s → 0.3 s).

**Still to do:** repeat on staging with production PostgreSQL settings before the pilot.

## Slice 14c — acceptance criteria (met): backups, restore drills and deployment

- [x] Production images: API (read-only, unprivileged, health-checked), a migration job run
      before every release, and the web app on unprivileged nginx with a strict
      Content-Security-Policy, HSTS and no framing; fonts self-hosted so the policy allows only
      the app's own origin (plus the image bucket and PayHere checkout).
- [x] Compose stack for one server with automatic HTTPS (Caddy); managed PostgreSQL and S3;
      database role setup script; trusted proxy hops configurable so client IPs cannot be forged.
- [x] Smoke-tested in production mode: migrations, health, headers, caching, image upload and
      signed links in the Linux image, a browser journey over HTTPS with no CSP violations,
      secure refresh cookie, correct client IP behind two proxies. CI builds the images and
      checks the headers.
- [x] Backups: nightly dump with checksum and row-count manifest; dumps and images copied
      off-site encrypted (rclone crypt), 35 days kept; restore drill script that verifies
      checksum, row counts, migrations and row-level security; drills passed (database from local
      and off-site copies, images) and a tampered backup was rejected.
- [x] Runbooks: [deployment](operations/deployment.md) and
      [backup and restore](operations/backup-and-restore.md) with targets and a drill log.

**Still to do:** a real server, domain, registry and managed database (with the pilot); a
slimmer migration image.

## Slice 14d — next

Pilot readiness: a go-live checklist and runbook (first deployment, monitoring and alerts,
support and incident steps, data protection notices), and checking receipt printers on the
shops' own models.

## Slice 13 — original scope

Notifications (low stock, expiring batches, daily summary) by e-mail and in the apps, customer
messaging with recorded consent, loyalty points, integrations (product images in object
storage, Bluetooth receipt printers on Android), feature flags for gradual rollout, and
industry-specific additions for cosmetics (batches and expiry) and textiles (sizes and
measured quantities) where the core does not yet cover them.
