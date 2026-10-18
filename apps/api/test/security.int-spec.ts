import { createTestContext, type TestContext } from './helpers';

/**
 * Database guard rails that every migration must keep. These read the live
 * schema, so a new table without row-level security, or a grant that lets the
 * application rewrite history, fails here rather than in production.
 */
describe('Database security invariants (integration)', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await createTestContext();
  });
  afterAll(async () => {
    await ctx.close();
  });

  // Business tables use `tenant_isolation`; platform tables that name a business use `system_only`.
  it('forces row-level security on every table that names a business', async () => {
    const rows = await ctx.owner.$queryRaw<
      Array<{ table: string; enabled: boolean; forced: boolean; policy: boolean }>
    >`
      SELECT c.relname AS table, c.relrowsecurity AS enabled, c.relforcerowsecurity AS forced,
             EXISTS (SELECT 1 FROM pg_policies p
                     WHERE p.schemaname = 'public' AND p.tablename = c.relname
                       AND p.policyname IN ('tenant_isolation', 'system_only')) AS policy
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind = 'r'
        AND EXISTS (SELECT 1 FROM information_schema.columns col
                    WHERE col.table_schema = 'public' AND col.table_name = c.relname
                      AND col.column_name = 'tenant_id')
      ORDER BY c.relname`;
    expect(rows.length).toBeGreaterThan(40);
    expect(rows.filter((row) => !row.enabled || !row.forced || !row.policy)).toEqual([]);
  });

  it('runs the application as a restricted role', async () => {
    const [role] = await ctx.owner.$queryRaw<
      Array<{ superuser: boolean; bypass: boolean; createrole: boolean; createdb: boolean }>
    >`
      SELECT rolsuper AS superuser, rolbypassrls AS bypass, rolcreaterole AS createrole,
             rolcreatedb AS createdb
      FROM pg_roles WHERE rolname = 'pos_app'`;
    expect(role).toEqual({ superuser: false, bypass: false, createrole: false, createdb: false });

    const owned = await ctx.owner.$queryRaw<Array<{ table: string }>>`
      SELECT tablename AS table FROM pg_tables
      WHERE schemaname = 'public' AND tableowner = 'pos_app'`;
    expect(owned).toEqual([]);

    const truncatable = await ctx.owner.$queryRaw<Array<{ table: string }>>`
      SELECT table_name AS table FROM information_schema.role_table_grants
      WHERE grantee = 'pos_app' AND table_schema = 'public' AND privilege_type = 'TRUNCATE'`;
    expect(truncatable).toEqual([]);

    const migrations = await ctx.owner.$queryRaw<Array<{ privilege: string }>>`
      SELECT privilege_type AS privilege FROM information_schema.role_table_grants
      WHERE grantee = 'pos_app' AND table_name = '_prisma_migrations'`;
    expect(migrations).toEqual([]);
  });

  it('keeps records that are evidence append-only for the application', async () => {
    const appendOnly = [
      'audit_logs',
      'cash_movements',
      'consent_events',
      'customer_ledger_entries',
      'customer_payments',
      'loyalty_entries',
      'payment_events',
      'platform_audit_logs',
      'sale_lines',
      'sale_payments',
      'sale_return_lines',
      'sale_return_refunds',
      'sale_returns',
      'sales',
      'stock_movements',
    ];
    const writable = await ctx.owner.$queryRaw<Array<{ table: string; privilege: string }>>`
      SELECT table_name AS table, privilege_type AS privilege
      FROM information_schema.role_table_grants
      WHERE grantee = 'pos_app' AND table_schema = 'public'
        AND privilege_type IN ('UPDATE', 'DELETE')
        AND table_name = ANY(${appendOnly})`;
    expect(writable).toEqual([]);
  });

  it('cannot read another business’s rows even when asked for them by id', async () => {
    const [tenant] = await ctx.owner.$queryRaw<Array<{ id: string }>>`
      SELECT gen_random_uuid()::text AS id`;
    // No tenant context at all: the application role sees nothing.
    const leaked = await ctx.prisma.$transaction(async (tx) => {
      const counts = await tx.$queryRaw<Array<{ n: number }>>`
        SELECT (SELECT COUNT(*) FROM customers)::int + (SELECT COUNT(*) FROM sales)::int
             + (SELECT COUNT(*) FROM audit_logs)::int AS n`;
      return counts[0]!.n;
    });
    expect(leaked).toBe(0);
    // A made-up tenant id sees nothing either.
    const none = await ctx.prisma.withTenant(tenant!.id, (tx) => tx.customer.count());
    expect(none).toBe(0);
  });
});
