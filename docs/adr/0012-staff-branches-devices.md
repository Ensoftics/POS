# ADR 0012 — Staff, branch restrictions and devices

- **Status:** Accepted (2026-10-17)

## Context

Until now staff could only be added by hand. Owners need to invite people, decide what they
may do and where, take access away at once, and stop a lost or stolen till from being used.

## Decision

### Invitations

- An owner or manager invites by e-mail with a role and, optionally, branches. The e-mail
  carries a single-use link (`/accept-invite?token=…`) valid for 7 days. Only the SHA-256 hash
  of the token is stored, like password-reset tokens.
- A new invitation to the same address replaces any open one (a partial unique index allows
  one open invitation per address per business). Invitations can be withdrawn.
- The accept page reads the token from the address bar once and removes it. The token goes in
  POST bodies (`/auth/invitations/preview`, `/auth/invitations/accept`), never in a URL the
  API logs. Invalid, used, withdrawn and expired links all get the same answer
  (`INVITATION_INVALID`).
- A person new to the system chooses a name and a password (checked against the password
  policy, including the "no name or e-mail in the password" rule). Someone who already has an
  account proves it with their password, so an invitation alone never grants access to an
  existing account. Accepting claims the invitation with a conditional update first, so a link
  cannot be used twice even by two tabs at once.
- The audit log records `staff.invited` and `staff.joined` with the role and invitation id, not
  the e-mail address.

### Roles and who may change them

- `staff.manage` (owners and managers) opens the staff screens.
- Owners manage everyone. Managers manage cashiers and inventory staff only, and can only grant
  those roles (`canManageRole` in `@pos/domain`, used by API and web).
- Nobody changes their own role, status or branches.
- A business always keeps one active owner. Demoting or disabling an owner locks the owner
  memberships (`FOR UPDATE`), so two owners cannot remove each other at the same moment.
- Membership changes use optimistic versions (`version`), like other editable records.
- Any change to role, status or branches revokes all of that member's sessions. Permissions are
  already resolved live on every request, so the change applies at once; signing out makes the
  apps reload the new rights.

### Branch restrictions

- `membership_branches` lists the branches a member may work at. No rows means every branch;
  owners always have every branch.
- The request principal carries `branchIds` (null = every branch); `/auth/me` and sign-in
  return it so clients can adapt (for example, reports without an "All branches" choice).
- Enforced in the API, not only hidden in the UI (`BRANCH_NOT_ALLOWED`, 403):
  - opening shifts, and reading or acting on shifts, sales, returns and customer payments of
    other branches (another branch's shift is "not found");
  - stock levels and history, receipts, adjustments and counts at other branches;
  - transfers: sending stock **to** any branch is allowed, but receiving is done at the
    destination and cancelling at the source;
  - reports: a restricted member picks one of their branches; with a single branch it is used
    automatically. The branch list only shows their branches.
- Offline sales need no extra check: a sale belongs to a shift, and shifts can only be opened
  at allowed branches.

### Devices (Android tills)

- Each install creates a random UUID on first use, stored in SecureStore. It is sent at sign-in
  and when the till picks its register (`PUT /devices/:id`, which also records the branch and
  register and updates "last used").
- Sessions remember the device they signed in on (`sessions.device_id`).
- Blocking a device (`POST /devices/:id/revoke`) revokes every session on it and stops it signing
  in (`DEVICE_REVOKED`) or re-registering until it is allowed again (`/restore`). Devices are
  never deleted, so the history stays.
- Device rows are keyed by `(tenant_id, id)`, so the same install can serve several businesses
  and one business cannot see or block another's tills.

### Database

- New tables `membership_branches`, `invitations`, `devices`, all with `FORCE ROW LEVEL
SECURITY` and the `tenant_isolation` policy. Invitations and devices have no `DELETE` grant
  for the application role; membership branches are replaced as a set.

## Consequences

- Taking access away is immediate everywhere, at the cost of the member signing in again
  after any change, even one that widens their access.
- A device id identifies an install, not the hardware. Reinstalling the app gives a new id,
  and someone with valid credentials can still sign in on a different device or a browser.
  Blocking a device protects against a lost till's stored session, not a stolen password.
  Strong device attestation (Play Integrity) can be added later.
- A restricted manager's dashboard shows their first branch. Totals across several allowed
  branches would need report queries that accept a set of branches.
- The last-owner rule is enforced for concurrent changes, but there is no ownership transfer
  flow yet: an owner can only be removed by another owner.
