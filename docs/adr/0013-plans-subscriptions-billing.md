# ADR 0013 — Plans, subscriptions and billing

- **Status:** Accepted (2026-10-17)

## Context

The platform is sold by subscription. Businesses need a free trial, plans that limit how
much they can set up, a way to pay in LKR, and a predictable outcome when they do not pay.
The owner's e-mail address must be proven before money is involved.

## Decision

### Plans and limits

- `plans` is platform data (not tenant data): code, name, tax-exclusive monthly and yearly
  prices, currency, and limits on **branches, registers, staff and tills**. The application
  role can only read it; platform admins manage plans from Slice 12. Launch plans (Starter,
  Growth, Business) are seeded by the migration.
- Limits are checked in the API when something is added or brought back: creating or restoring
  a branch or register, inviting staff (open invitations count), re-enabling a member,
  accepting an invitation, registering or allowing a till (`PLAN_LIMIT_REACHED`, 409).
- Each check first locks the business's subscription row (`FOR UPDATE`), so concurrent
  requests cannot both take the last place.
- Changing to a smaller plan is refused while usage is above its limits
  (`validation.plan.too_many_<resource>`).

### Subscription lifecycle

One `subscriptions` row per business:

| Status      | Meaning                                                       | Access             |
| ----------- | ------------------------------------------------------------- | ------------------ |
| `TRIALING`  | Free trial (`TRIAL_DAYS`, default 14) on `TRIAL_PLAN_CODE`    | Full               |
| `ACTIVE`    | Paid until `current_period_end`                               | Full               |
| `PAST_DUE`  | Trial or period ended unpaid; `GRACE_DAYS` (default 7) to pay | Full, with banners |
| `SUSPENDED` | Grace period over, or a chargeback                            | Read-only          |
| `CANCELLED` | Ended at period end as the owner asked                        | Read-only          |

- The transition rules are pure functions in `@pos/domain` (`nextTransition`,
  `paidPeriodStart`, `addInterval`) and are tested with fixed clocks.
- A sweep (`BILLING_SWEEP_SECONDS`, default 15 min) applies due transitions. It sends one
  reminder before a trial ends (3 days) or a paid period ends (7 days), and a notice on each
  transition. Each subscription is processed in its own transaction with
  `FOR UPDATE SKIP LOCKED`, so several API instances can sweep safely.
- **Read-only** is a global guard: reads (including reports and exports) keep working, so data
  is never held hostage. Writes return `SUBSCRIPTION_INACTIVE` (402), except billing,
  e-mail verification and sign-out. Offline tills treat 402 as "try later", so sales queued
  offline are kept and sync once the business has paid.
- The status is read live on every request (like permissions), so paying unlocks at once.

### Paying

- **One payment per period, no automatic charging.** The owner pays each month or year through
  a hosted checkout; reminders arrive before the period ends. This avoids storing card tokens
  and needs no cancellation API: "cancel" means "end at period end, no reminders".
- Paying early continues from the end of the current period (same plan); paying during a trial
  keeps the remaining trial days. A plan change takes effect when paid, with no proration.
- Checkout opens a `billing_invoices` row (numbered `SUB-000001` per business, tax from
  `BILLING_TAX_RATE_BP`, which defaults to 0 and is never hard-coded). Only one invoice can be
  open; a new checkout voids the previous one. A payment for a voided invoice is still honoured.
- **Provider adapter:** `PaymentProvider` defines `isConfigured`, `checkout` (a form POST to the
  provider's hosted page) and `parseNotification` (verify and normalise). The first
  implementation is **PayHere** (Sri Lanka): MD5 checkout hash and notification signature over
  merchant id, order id, amount, currency (and status), with the upper-cased MD5 of the
  merchant secret, as PayHere specifies. The signature is compared in constant time.
- Without credentials (`PAYHERE_MERCHANT_ID`/`SECRET`), checkout returns
  `PAYMENTS_UNAVAILABLE` (503) and the web app says so. Nothing is simulated. Production
  refuses to start with sandbox credentials.
- **Notifications** (`POST /api/v1/billing/webhooks/payhere`, form-encoded, public):
  - unsigned, foreign-merchant or unknown-order notifications get 400 and change nothing;
  - each `(provider, payment_id:status)` is stored once in the append-only `payment_events`
    table, so retried notifications are applied exactly once;
  - the amount and currency must equal the invoice, otherwise the event is recorded as
    `REJECTED` and audited;
  - `PAID` activates the period, `FAILED`/`CANCELLED` are audited, and `CHARGEBACK` suspends
    at once.
- Card numbers and holder names in notifications are never stored or logged; only the method
  label (e.g. VISA) is kept.

### E-mail verification

- Registration sends a single-use link (`EMAIL_VERIFICATION_TTL_HOURS`, default 48; hash
  stored only; newest link wins; at most 5 per hour). Accepting an invitation or resetting a
  password also proves the address.
- Checkout requires a verified address (`EMAIL_NOT_VERIFIED`). Owners see a banner with
  "send again" until they confirm.

### Data protection

`subscriptions`, `billing_invoices` and `payment_events` have forced row-level security.
Invoices and subscriptions cannot be deleted by the application, and payment events cannot
be changed. Invoice amounts are guarded by CHECK constraints (total = subtotal + tax,
`paid_at` set only when paid).

## Consequences

- Owners must remember to pay each period (reminders help). Saved-card renewals would need
  the provider's recurring API and a stored token, and can be added behind the same adapter.
- PayHere must be able to reach `API_PUBLIC_URL`; local development cannot receive real
  notifications. The automated tests sign notifications themselves, so the real sandbox
  round trip must be checked manually before going live.
- Prices and limits are data, so changing them needs no deployment. Existing subscriptions
  keep their plan, and a change of plan only takes effect when paid.
