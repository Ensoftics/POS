# ADR 0014 — Platform console for operator staff

- **Status:** Accepted (2026-10-17)

## Context

Ensoftic staff need to support and run the service: find a business, see its subscription
and payments, give extra days, record a bank transfer, change plans and prices, and suspend
or close accounts. These powers reach across every tenant, so they need stronger sign-in,
tighter scope and a complete record of who did what.

## Decision

### Separate identity and sessions

- Platform access is a flag on an ordinary account plus an **authenticator-app secret**
  (TOTP, RFC 6238, verified against the RFC test vectors). It is granted, reset or revoked only
  from the server by an operator:
  `pnpm --filter @pos/api platform:admin <grant|reset-totp|revoke> <email>`. There is no API to
  make someone an admin. The person must already have an account, so passwords never pass
  through the tool, and the secret is printed once.
- Secrets are stored encrypted (AES-256-GCM, key derived by HKDF from the server secret). Each
  code works once: the accepted time step is recorded under a conditional update, so even
  concurrent replays fail. Failed attempts share the account lockout (5 tries → 15 minutes),
  and every failure gives the same message.
- Console sessions are their own table and token audience (`pos-platform`). Tenant tokens are
  refused by the console and console tokens by tenant routes. Sessions end on sign-out, after
  `PLATFORM_IDLE_MINUTES` (default 30) idle, after `PLATFORM_SESSION_HOURS` (default 8), and
  immediately when access is revoked. The web console keeps the token in memory only, so
  reloading signs out.

### Scope: accounts, not trading data

The console shows and changes **business metadata, subscriptions, plans and billing**:

- the overview (businesses, sign-ups, subscription statuses, recurring revenue, payments,
  provider status, last billing sweep);
- the list of businesses with search and filters;
- business details: owners, usage and limits, invoices and payment notifications.

It has no access to a shop's sales, products, stock or customers. Supporting a shop's data
would need an explicit, time-limited, owner-approved access feature, which is not built.

### Actions

| Action         | Effect                                                                                                                         |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Suspend        | Tenant status `SUSPENDED`: all sessions revoked; sign-in refused (`TENANT_SUSPENDED`); data kept                               |
| Reinstate      | Back to `ACTIVE`                                                                                                               |
| Close          | Final (`CLOSED`); the business slug must be typed to confirm; data kept for retention                                          |
| Extend         | Adds days to a trial or paid period, or revives a lapsed subscription from today                                               |
| Change plan    | Without payment (agreed deals); refused if current usage exceeds the plan                                                      |
| Record payment | Bank transfer or cash as a `MANUAL` paid invoice, applied by the same code path as provider payments; one record per reference |
| Plans          | Create; edit with optimistic versions; hide or offer; never delete (subscriptions refer to them)                               |

- Every action requires a **reason**.
- Each action is written to `platform_audit_logs` with the acting admin, IP and request id.
  This table is append-only for the application role.
- Actions affecting a business also appear in **that business's activity log** as
  "… by Ensoftic support", so owners can see what staff did.
- Viewing a business's details is itself logged.

### Where it lives

The console is a separate route tree (`/platform`) in the existing web app rather than a new
`apps/admin`. It reuses the design system, i18n and API client, and has its own sign-in,
session store and API client instance. A separate deployment (another origin, IP allow-list)
can be added at the proxy without code changes, because the console only talks to
`/api/v1/platform/*`.

## Consequences

- Operators need an authenticator app, and admins are managed by whoever can run commands on
  the server, which is deliberate.
- Reloading the console signs out (token in memory only), trading convenience for a smaller
  exposure window.
- Feature flags (planned for this slice originally) are not built: no feature needs gradual
  rollout yet. They will arrive with the first integration that does (Slice 13).
- Recurring revenue is an estimate from plan list prices (yearly ÷ 12), before tax, for paid
  and grace-period subscriptions.
