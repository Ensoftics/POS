# ADR 0003 — Tenant isolation with application scoping and PostgreSQL RLS

- **Status:** Accepted (2026-10-16)

## Context

All tenants share one database. A single missing `WHERE tenant_id = …` must not leak one
shop's sales to another.

## Decision

- **Shared schema, `tenant_id` column** on every tenant-owned table. Child tables reference
  parents with a composite `(tenant_id, parent_id)` foreign key (first used by `registers`).
- **Layer 1 — application:** tenant ID comes only from the verified session. Business data is
  accessed through `PrismaService.withTenant(tenantId, fn)`, which opens a transaction and runs
  `set_config('app.tenant_id', $1, true)` (transaction-local, so pooled connections never
  carry it over).
- **Layer 2 — database:** each tenant table has `ENABLE` + `FORCE ROW LEVEL SECURITY` and a
  `tenant_isolation` policy for both `USING` and `WITH CHECK`:
  `app_rls_bypass() OR tenant_id = app_current_tenant_id()`. With no context set, the policy
  matches nothing (fail closed).
- **Roles:** migrations run as the schema owner (`pos_owner`); the API runs as `pos_app`
  (`NOSUPERUSER NOBYPASSRLS`) with DML only. `audit_logs` additionally has UPDATE/DELETE revoked.
- **System context:** `PrismaService.asSystem(fn)` sets `app.rls_bypass` for identity flows
  that run before a tenant is known (register, login, refresh, password reset) and for
  cross-tenant platform jobs. It must not be used for business data; code review enforces this.

## Verification

Integration tests (`apps/api/test/tenant-isolation.int-spec.ts`) cover: API reads limited to
the caller's tenant; foreign IDs in bodies ignored; foreign pagination cursors; zero rows
without context; cross-tenant UPDATE/DELETE affecting zero rows; cross-tenant INSERT rejected;
no context leakage across pooled transactions; append-only audit log; cashier/manager
permission escalation attempts. Every future slice adds the same tests for its tables,
including exports and background jobs.

## Consequences

- Every tenant query runs in a transaction (two extra round trips). Acceptable at POS scale;
  revisit with pgbouncer transaction pooling, which is compatible with transaction-local settings.
- `app.rls_bypass` can be set by any SQL the app role runs, so SQL injection would defeat
  layer 2. Raw SQL must use Prisma's parameterised tagged templates (`$queryRaw`,
  `$executeRaw`); the `*Unsafe` variants are an ESLint error in `apps/api/src`.
- New tables need their policy written by hand in the migration (Prisma does not model RLS);
  the migration checklist in docs/roadmap.md includes this step.
