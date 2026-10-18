import {
  addMember,
  bearer,
  createTestContext,
  login,
  registerTenant,
  resetDatabase,
  type TestContext,
} from './helpers';

describe('Tenant isolation and permissions (integration)', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await createTestContext();
  });
  beforeEach(async () => {
    await resetDatabase(ctx.owner);
  });
  afterAll(async () => {
    await ctx.close();
  });

  async function twoTenants() {
    const a = await registerTenant(ctx, { businessName: 'Alpha Textiles' });
    const b = await registerTenant(ctx, { businessName: 'Beta Beauty' });
    return { a, b };
  }

  describe('API', () => {
    it('only ever returns the caller’s own tenant', async () => {
      const { a, b } = await twoTenants();
      const responseA = await ctx.http.get('/api/v1/tenant').set(bearer(a.accessToken)).expect(200);
      const responseB = await ctx.http.get('/api/v1/tenant').set(bearer(b.accessToken)).expect(200);
      expect(responseA.body.id).toBe(a.tenant.id);
      expect(responseB.body.id).toBe(b.tenant.id);
    });

    it('updates only the caller’s tenant during onboarding', async () => {
      const { a, b } = await twoTenants();
      await ctx.http
        .post('/api/v1/tenant/onboarding')
        .set(bearer(a.accessToken))
        // Extra fields such as a foreign tenant id are ignored, never trusted.
        .send({
          businessName: 'Alpha Textiles Ltd',
          businessType: 'TEXTILE',
          tenantId: b.tenant.id,
          id: b.tenant.id,
        })
        .expect(200);
      const tenantB = await ctx.owner.tenant.findUniqueOrThrow({ where: { id: b.tenant.id } });
      expect(tenantB.name).toBe('Beta Beauty');
      expect(tenantB.onboardingStatus).toBe('PENDING');
    });

    it('never leaks audit entries across tenants, even with a foreign cursor', async () => {
      const { a, b } = await twoTenants();
      const logsA = await ctx.http.get('/api/v1/audit-logs').set(bearer(a.accessToken)).expect(200);
      const ids = logsA.body.items.map((item: { id: string }) => item.id);
      const foreignEntries = await ctx.owner.auditLog.findMany({
        where: { tenantId: b.tenant.id },
      });
      expect(foreignEntries.length).toBeGreaterThan(0);
      for (const entry of foreignEntries) expect(ids).not.toContain(entry.id);

      const withForeignCursor = await ctx.http
        .get('/api/v1/audit-logs')
        .query({ cursor: foreignEntries[0]!.id })
        .set(bearer(a.accessToken))
        .expect(200);
      expect(
        withForeignCursor.body.items.every(
          (item: { id: string }) => !foreignEntries.some((f) => f.id === item.id),
        ),
      ).toBe(true);
    });

    it('hides platform-level security events from tenants', async () => {
      const { a } = await twoTenants();
      await ctx.http
        .post('/api/v1/auth/login')
        .send({ email: a.email, password: 'wrong-password' })
        .expect(401);
      const logs = await ctx.http.get('/api/v1/audit-logs').set(bearer(a.accessToken)).expect(200);
      expect(logs.body.items.map((i: { action: string }) => i.action)).not.toContain(
        'auth.login_failed',
      );
    });

    it('paginates audit logs with a cursor', async () => {
      const { a } = await twoTenants();
      for (let i = 0; i < 3; i += 1) await login(ctx, a.email);
      const first = await ctx.http
        .get('/api/v1/audit-logs')
        .query({ limit: 2 })
        .set(bearer(a.accessToken))
        .expect(200);
      expect(first.body.items).toHaveLength(2);
      expect(first.body.nextCursor).toEqual(expect.any(String));
      const second = await ctx.http
        .get('/api/v1/audit-logs')
        .query({ limit: 2, cursor: first.body.nextCursor })
        .set(bearer(a.accessToken))
        .expect(200);
      const firstIds = first.body.items.map((i: { id: string }) => i.id);
      expect(second.body.items.some((i: { id: string }) => firstIds.includes(i.id))).toBe(false);
    });
  });

  describe('roles', () => {
    it('denies cashiers administrative actions (permission escalation attempt)', async () => {
      const { a } = await twoTenants();
      const cashier = await addMember(ctx, a.tenant.id, 'CASHIER');
      const session = await login(ctx, cashier.email);
      expect(session.permissions).toContain('tenant.read');
      for (const admin of [
        'audit.read',
        'tenant.update',
        'settings.update',
        'branches.manage',
        'products.manage',
      ]) {
        expect(session.permissions).not.toContain(admin);
      }

      await ctx.http.get('/api/v1/tenant').set(bearer(session.accessToken)).expect(200);
      const audit = await ctx.http
        .get('/api/v1/audit-logs')
        .set(bearer(session.accessToken))
        .expect(403);
      expect(audit.body.error.code).toBe('FORBIDDEN');
      await ctx.http
        .post('/api/v1/tenant/onboarding')
        .set(bearer(session.accessToken))
        .send({ businessName: 'Hijacked', businessType: 'GENERAL_RETAIL' })
        .expect(403);
    });

    it('lets managers read the audit log but not change the business profile', async () => {
      const { a } = await twoTenants();
      const manager = await addMember(ctx, a.tenant.id, 'MANAGER');
      const session = await login(ctx, manager.email);
      await ctx.http.get('/api/v1/audit-logs').set(bearer(session.accessToken)).expect(200);
      await ctx.http
        .post('/api/v1/tenant/onboarding')
        .set(bearer(session.accessToken))
        .send({ businessName: 'Renamed', businessType: 'TEXTILE' })
        .expect(403);
    });

    it('blocks suspended tenants', async () => {
      const { a, b } = await twoTenants();
      await ctx.owner.tenant.update({ where: { id: a.tenant.id }, data: { status: 'SUSPENDED' } });
      const response = await ctx.http.get('/api/v1/tenant').set(bearer(a.accessToken)).expect(403);
      expect(response.body.error.code).toBe('TENANT_SUSPENDED');
      await ctx.http
        .post('/api/v1/auth/login')
        .send({ email: a.email, password: 'blue-mango-river-42' })
        .expect(403);
      await ctx.http.get('/api/v1/tenant').set(bearer(b.accessToken)).expect(200);
    });
  });

  describe('row-level security (database layer)', () => {
    it('shows no tenant rows without a tenant context (fail closed)', async () => {
      await twoTenants();
      expect(await ctx.prisma.tenant.count()).toBe(0);
      expect(await ctx.prisma.membership.count()).toBe(0);
      expect(await ctx.prisma.auditLog.count()).toBe(0);
    });

    it('scopes reads to the transaction tenant', async () => {
      const { a, b } = await twoTenants();
      const seen = await ctx.prisma.withTenant(a.tenant.id, (tx) => tx.membership.findMany());
      expect(seen.map((m) => m.tenantId)).toEqual([a.tenant.id]);
      const lookup = await ctx.prisma.withTenant(a.tenant.id, (tx) =>
        tx.tenant.findUnique({ where: { id: b.tenant.id } }),
      );
      expect(lookup).toBeNull();
    });

    it('blocks cross-tenant writes and deletes', async () => {
      const { a, b } = await twoTenants();
      const updated = await ctx.prisma.withTenant(a.tenant.id, (tx) =>
        tx.tenant.updateMany({ where: { id: b.tenant.id }, data: { name: 'pwned' } }),
      );
      expect(updated.count).toBe(0);

      const deleted = await ctx.prisma.withTenant(a.tenant.id, (tx) =>
        tx.membership.deleteMany({ where: { tenantId: b.tenant.id } }),
      );
      expect(deleted.count).toBe(0);

      await expect(
        ctx.prisma.withTenant(a.tenant.id, (tx) =>
          tx.auditLog.create({ data: { tenantId: b.tenant.id, action: 'tenant.registered' } }),
        ),
      ).rejects.toThrow(/row-level security/);
    });

    it('does not leak tenant context between pooled transactions', async () => {
      const { a } = await twoTenants();
      await ctx.prisma.withTenant(a.tenant.id, (tx) => tx.tenant.findMany());
      // Many follow-up queries without context, likely on the same pooled connection.
      const counts = await Promise.all(Array.from({ length: 10 }, () => ctx.prisma.tenant.count()));
      expect(counts.every((count) => count === 0)).toBe(true);
    });

    it('keeps the audit log append-only for the application role', async () => {
      const { a } = await twoTenants();
      await expect(
        ctx.prisma.withTenant(a.tenant.id, (tx) =>
          tx.auditLog.deleteMany({ where: { tenantId: a.tenant.id } }),
        ),
      ).rejects.toThrow(/permission denied/);
      await expect(
        ctx.prisma.withTenant(a.tenant.id, (tx) =>
          tx.auditLog.updateMany({ data: { action: 'x' } }),
        ),
      ).rejects.toThrow(/permission denied/);
    });
  });
});
