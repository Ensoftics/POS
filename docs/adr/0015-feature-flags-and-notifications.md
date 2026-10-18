# ADR 0015 — Feature flags and notifications

- **Status:** Accepted (2026-10-17)

## Context

Owners and staff should hear about problems without opening reports: stock running low,
batches about to expire, offline sales that need review, a subscription that needs payment,
and how yesterday went. The operator also needs to switch features on or off per business
(pilots, gradual rollout, or a misbehaving feature) without a deployment.

## Decision

### Feature flags

- Flag keys are defined in code (`FEATURE_FLAGS` in `@pos/domain`). The database holds each
  flag's **default** (`feature_flags`, platform data) and optional **per-business overrides**
  (`tenant_feature_flags`, row-level secured). Effective value = override ?? default; unknown
  keys are ignored.
- Platform staff change defaults (versioned) and set or clear overrides (reason required) in
  the console. Both are written to the platform audit log.
- The session context returns the business's enabled flags (`features`), so the apps can
  adapt. The server checks flags where the behaviour lives, never trusting the client.
- First flags:
  - `notifications.daily_summary`: yesterday's sales summary;
  - `notifications.email`: morning digest e-mails, a per-business kill switch.

### Notifications

- One `notifications` row per person, with a `kind`, parameters (`data`) for translated text,
  and an in-app `link`. A unique `(tenant, user, dedupeKey)` makes every generator
  idempotent. Text is rendered in the reader's language by the apps; the server stores no
  sentences.
- Sources:

  | Kind              | When                                                                                  | Who                                                                            |
  | ----------------- | ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
  | `INVENTORY_ALERT` | Daily, per branch with low stock (≤ reorder level) or batches expiring within 30 days | People with `inventory.read` who may work at that branch                       |
  | `DAILY_SUMMARY`   | Daily, if the flag is on and there were sales or refunds yesterday                    | People with `reports.view` and access to every branch (whole-business figures) |
  | `SALE_CONFLICT`   | When an offline sale is recorded with differences                                     | People with `shifts.manage` at that branch                                     |
  | `SUBSCRIPTION`    | When a subscription becomes past due, read-only or ended                              | Owners (`billing.manage`)                                                      |

- **Daily run:** a sweep (`NOTIFICATIONS_SWEEP_SECONDS`, default 15 min) finds active,
  onboarded, usable businesses whose local time is at or after 07:00. It claims the local date
  in `daily_runs` inside the same transaction that creates the notifications. The day runs
  once across many API instances, and a failed run is retried on the next sweep.
- **E-mail:** one digest per person per day, listing their lines, if the business's
  `notifications.email` flag is on and the person has not turned it off (`email_digest` on
  the membership, changeable on the Notifications page). In-app notifications are always
  created.
- Notifications older than 90 days are deleted by the sweep. Reading and marking
  notifications stay possible while an account is read-only.

### Clients

- **Web:** a bell in the header with the unread count (refreshed every minute), a
  Notifications page (unread filter, mark all, open → marks read and follows the link) and the
  e-mail preference. Stock alerts open the inventory page on the right branch and filter.
- **Android:** a button on the home screen when there are unread notifications, and a list
  where tapping marks one read.
- **Console:** a Feature flags page and per-business flag settings on the business page.

## Consequences

- Alerts arrive once a day, not the moment stock drops; real-time alerts would need events on
  every stock movement and are not justified yet.
- No push notifications to phones yet (that needs FCM credentials and device tokens); the
  Android app shows the count when opened.
- Daily figures use each business's own time zone; businesses whose clock never reaches 07:00
  between sweeps (e.g. when the sweep is disabled) simply get nothing that day.
