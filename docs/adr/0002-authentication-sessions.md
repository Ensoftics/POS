# ADR 0002 — Authentication and sessions

- **Status:** Accepted (2026-10-16)

## Context

Cashiers share devices, staff leave, phones get lost. Revocation must be immediate, web
tokens must resist XSS theft, and Android devices must stay signed in for a full shift (and
later, work offline).

## Decision

1. **Access token:** HS256 JWT, 15-minute TTL, claims `sub` (user), `tid` (tenant), `sid`
   (session family), `role` (informational). Issuer/audience/algorithm are pinned on verify.
2. **Every request re-checks live state:** the guard loads the session family's active row
   with its membership, user and tenant. Logout, disabled staff, role changes and tenant
   suspension take effect on the next request rather than at token expiry. Cost: one indexed
   query per request; a short-lived cache can be added if profiling shows a need.
3. **Refresh token:** 256-bit random, stored as SHA-256. Sliding expiry (14 days web, 30 days
   mobile) capped by an absolute family lifetime (90 days).
4. **Rotation with reuse detection:** every refresh atomically claims the current row
   (`UPDATE … WHERE revoked_at IS NULL`) and issues a new row in the same family. Presenting a
   rotated token within 30 s is treated as a benign race (concurrent tabs) and rejected quietly;
   later replays revoke the whole family and are audited.
5. **Token delivery:** web gets the refresh token only as an httpOnly, `SameSite=Strict`,
   `Secure` (production) cookie with `Path=/api/v1/auth`; cookie-authenticated calls must send
   the `x-pos-client: web` header, which forces a CORS preflight. The web access token lives in
   memory only. Mobile receives the refresh token in the body and stores it in SecureStore.
6. **Tenant selection:** users are global; a user with several active memberships must pick
   one at login. A supplied `tenantId` is accepted only if it is one of the user's memberships.
7. **Brute-force protection:** per-IP throttling on auth routes, per-account lockout (5 failures
   → 15 minutes), constant-work login for unknown emails, identical error for unknown email and
   wrong password.

## Consequences

- A device that loses the response of a refresh (crash between server rotation and local save)
  will present a rotated token later and be signed out. Acceptable: rare, safe failure mode.
- Platform super-admin sessions will be separate (Slice 12) rather than a tenant membership.
- JWT secret rotation requires a key ID (`kid`) scheme; deferred to Slice 14 hardening.
