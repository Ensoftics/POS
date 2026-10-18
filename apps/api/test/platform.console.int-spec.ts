import { randomUUID } from 'node:crypto';
import {
  base32Decode,
  encryptSecret,
  generateTotpSecret,
  hotp,
  timeStep,
} from '../src/platform/totp';
import {
  bearer,
  createTestContext,
  login,
  onboardedTenant,
  registerTenant,
  resetDatabase,
  STRONG_PASSWORD,
  type TestContext,
} from './helpers';

describe('Platform console (integration)', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await createTestContext();
  });
  beforeEach(async () => {
    await resetDatabase(ctx.owner);
    await ctx.owner.$executeRawUnsafe('TRUNCATE TABLE platform_audit_logs, platform_sessions');
    // Plans created by tests are removed; the seeded launch plans stay.
    await ctx.owner.plan.deleteMany({
      where: { code: { notIn: ['STARTER', 'GROWTH', 'BUSINESS'] } },
    });
    ctx.mailer.sent.length = 0;
  });
  afterAll(async () => {
    await ctx.close();
  });

  /** An existing account made a platform admin, as the CLI does. */
  async function makeAdmin() {
    const account = await registerTenant(ctx, { businessName: 'Ensoftic Ops' });
    const secret = generateTotpSecret();
    await ctx.owner.user.update({
      where: { email: account.email },
      data: {
        isPlatformAdmin: true,
        totpSecretEnc: encryptSecret(secret, ctx.config.JWT_ACCESS_SECRET),
      },
    });
    return { email: account.email, secret };
  }
  const codeFor = (secret: string, offset = 0) =>
    hotp(base32Decode(secret), timeStep(new Date()) + offset);

  async function platformLogin(admin: { email: string; secret: string }) {
    // Each code works once; start from a fresh step for every sign-in in these tests.
    await ctx.owner.user.update({ where: { email: admin.email }, data: { totpLastStep: null } });
    const res = await ctx.http
      .post('/api/v1/platform/auth/login')
      .send({ email: admin.email, password: STRONG_PASSWORD, code: codeFor(admin.secret) })
      .expect(200);
    return bearer(res.body.accessToken as string);
  }

  describe('sign-in', () => {
    it('needs password and a single-use authenticator code', async () => {
      const admin = await makeAdmin();
      const attempt = (code: string, password = STRONG_PASSWORD) =>
        ctx.http.post('/api/v1/platform/auth/login').send({ email: admin.email, password, code });

      const wrongCode = await attempt(codeFor(admin.secret, 5)).expect(401);
      expect(wrongCode.body.error.code).toBe('INVALID_CREDENTIALS');
      await attempt(codeFor(admin.secret), 'wrong-password-123').expect(401);

      const code = codeFor(admin.secret);
      const ok = await attempt(code).expect(200);
      expect(ok.body.user.email).toBe(admin.email);
      // The same code cannot be replayed.
      await attempt(code).expect(401);

      const me = await ctx.http
        .get('/api/v1/platform/auth/me')
        .set(bearer(ok.body.accessToken))
        .expect(200);
      expect(me.body.email).toBe(admin.email);
    });

    it('gives ordinary accounts the same answer as a wrong password', async () => {
      const shop = await registerTenant(ctx);
      const res = await ctx.http
        .post('/api/v1/platform/auth/login')
        .send({ email: shop.email, password: STRONG_PASSWORD, code: '123456' })
        .expect(401);
      expect(res.body.error.message).toBe('Email, password or authenticator code is incorrect.');
    });

    it('keeps tenant and platform tokens apart', async () => {
      const admin = await makeAdmin();
      const platform = await platformLogin(admin);
      const shop = await onboardedTenant(ctx);
      await ctx.http.get('/api/v1/platform/overview').set(bearer(shop.accessToken)).expect(401);
      await ctx.http.get('/api/v1/platform/overview').expect(401);
      await ctx.http.get('/api/v1/tenant').set(platform).expect(401);
      await ctx.http.get('/api/v1/platform/overview').set(platform).expect(200);
    });

    it('ends sessions on logout, inactivity and when access is revoked', async () => {
      const admin = await makeAdmin();
      const first = await platformLogin(admin);
      await ctx.http.post('/api/v1/platform/auth/logout').set(first).expect(204);
      await ctx.http.get('/api/v1/platform/overview').set(first).expect(401);

      const second = await platformLogin(admin);
      await ctx.owner.platformSession.updateMany({
        where: { revokedAt: null },
        data: { lastSeenAt: new Date(Date.now() - 31 * 60_000) },
      });
      await ctx.http.get('/api/v1/platform/overview').set(second).expect(401);

      const third = await platformLogin(admin);
      await ctx.owner.user.update({
        where: { email: admin.email },
        data: { isPlatformAdmin: false },
      });
      await ctx.http.get('/api/v1/platform/overview').set(third).expect(401);

      const actions = (await ctx.owner.platformAuditLog.findMany()).map((a) => a.action);
      expect(actions.filter((a) => a === 'platform.login')).toHaveLength(3);
      expect(actions).toContain('platform.logout');
    });
  });

  describe('businesses', () => {
    it('summarises the platform and finds businesses', async () => {
      const admin = await makeAdmin();
      const platform = await platformLogin(admin);
      const lotus = await onboardedTenant(ctx, 'COSMETICS', { businessName: 'Lotus Beauty' });
      await onboardedTenant(ctx, 'TEXTILE', { businessName: 'Kandy Fabrics' });

      const overview = (await ctx.http.get('/api/v1/platform/overview').set(platform).expect(200))
        .body;
      // The admin's own registration counts as a business too.
      expect(overview.tenants.total).toBe(3);
      expect(overview.subscriptions.TRIALING).toBe(3);
      expect(overview.revenue.monthlyRecurringMinor).toBe(0);
      expect(overview.paymentsConfigured).toBe(false);

      const byName = (
        await ctx.http.get('/api/v1/platform/tenants?q=lotus').set(platform).expect(200)
      ).body.items;
      expect(byName.map((t: { name: string }) => t.name)).toEqual(['Lotus Beauty']);
      expect(byName[0]).toMatchObject({
        ownerEmail: lotus.email,
        subscription: { status: 'TRIALING', planCode: 'GROWTH' },
      });
      const byOwner = (
        await ctx.http
          .get(`/api/v1/platform/tenants?q=${encodeURIComponent(lotus.email)}`)
          .set(platform)
          .expect(200)
      ).body.items;
      expect(byOwner).toHaveLength(1);
    });

    it('shows a business’s account details but none of its trading data, and logs the view', async () => {
      const admin = await makeAdmin();
      const platform = await platformLogin(admin);
      const shop = await onboardedTenant(ctx);
      const detail = (
        await ctx.http.get(`/api/v1/platform/tenants/${shop.tenant.id}`).set(platform).expect(200)
      ).body;
      expect(detail.owners).toEqual([
        expect.objectContaining({ email: shop.email, emailVerified: false }),
      ]);
      expect(detail.usage).toEqual({ branches: 1, registers: 1, staff: 1, devices: 0 });
      expect(detail.limits).toEqual({ branches: 3, registers: 8, staff: 20, devices: 10 });
      expect(Object.keys(detail)).not.toEqual(
        expect.arrayContaining(['sales', 'products', 'customers']),
      );
      await ctx.http.get(`/api/v1/platform/tenants/${randomUUID()}`).set(platform).expect(404);
      expect(
        await ctx.owner.platformAuditLog.count({
          where: { action: 'platform.tenant_viewed', tenantId: shop.tenant.id },
        }),
      ).toBe(1);
    });

    it('suspends a business at once and reinstates it, visible in its activity log', async () => {
      const admin = await makeAdmin();
      const platform = await platformLogin(admin);
      const shop = await onboardedTenant(ctx);
      const owner = bearer(shop.accessToken);
      const id = shop.tenant.id as string;

      await ctx.http
        .post(`/api/v1/platform/tenants/${id}/suspend`)
        .set(platform)
        .send({ reason: 'Fraud report under review' })
        .expect(200);
      await ctx.http.get('/api/v1/tenant').set(owner).expect(401);
      // Signing in again is refused too.
      const blocked = await ctx.http
        .post('/api/v1/auth/login')
        .send({ email: shop.email, password: STRONG_PASSWORD, clientType: 'WEB' })
        .expect(403);
      expect(blocked.body.error.code).toBe('TENANT_SUSPENDED');
      await ctx.http
        .post(`/api/v1/platform/tenants/${id}/suspend`)
        .set(platform)
        .send({ reason: 'again' })
        .expect(409);

      await ctx.http
        .post(`/api/v1/platform/tenants/${id}/reinstate`)
        .set(platform)
        .send({ reason: 'Cleared' })
        .expect(200);
      const back = bearer((await login(ctx, shop.email)).accessToken);
      await ctx.http.get('/api/v1/tenant').set(back).expect(200);
      const log = (await ctx.http.get('/api/v1/audit-logs').set(back).expect(200)).body.items;
      const support = log.filter((e: { action: string }) => e.action.startsWith('support.'));
      expect(support.map((e: { action: string }) => e.action).sort()).toEqual([
        'support.tenant_reinstated',
        'support.tenant_suspended',
      ]);
    });

    it('closes a business only when its slug is typed, and for good', async () => {
      const admin = await makeAdmin();
      const platform = await platformLogin(admin);
      const shop = await onboardedTenant(ctx);
      const id = shop.tenant.id as string;
      const wrong = await ctx.http
        .post(`/api/v1/platform/tenants/${id}/close`)
        .set(platform)
        .send({ reason: 'Owner request', confirmSlug: 'something-else' })
        .expect(400);
      expect(wrong.body.error.issues).toEqual([
        { path: 'confirmSlug', message: 'validation.confirm.mismatch' },
      ]);
      await ctx.http
        .post(`/api/v1/platform/tenants/${id}/close`)
        .set(platform)
        .send({ reason: 'Owner request', confirmSlug: shop.tenant.slug })
        .expect(200);
      await ctx.http.get('/api/v1/tenant').set(bearer(shop.accessToken)).expect(401);
      await ctx.http
        .post(`/api/v1/platform/tenants/${id}/reinstate`)
        .set(platform)
        .send({ reason: 'Undo' })
        .expect(409);
    });
  });

  describe('subscriptions and plans', () => {
    it('extends a trial, and revives a lapsed subscription', async () => {
      const admin = await makeAdmin();
      const platform = await platformLogin(admin);
      const shop = await onboardedTenant(ctx);
      const id = shop.tenant.id as string;
      const before = await ctx.owner.subscription.findUniqueOrThrow({ where: { tenantId: id } });
      await ctx.http
        .post(`/api/v1/platform/tenants/${id}/subscription/extend`)
        .set(platform)
        .send({ days: 10, reason: 'Onboarding took longer' })
        .expect(200);
      const after = await ctx.owner.subscription.findUniqueOrThrow({ where: { tenantId: id } });
      expect(after.trialEndsAt!.getTime() - before.trialEndsAt!.getTime()).toBe(10 * 86_400_000);

      await ctx.owner.subscription.update({
        where: { tenantId: id },
        data: { status: 'SUSPENDED' },
      });
      const revived = await ctx.http
        .post(`/api/v1/platform/tenants/${id}/subscription/extend`)
        .set(platform)
        .send({ days: 7, reason: 'Goodwill' })
        .expect(200);
      expect(revived.body.subscription.status).toBe('ACTIVE');
      await ctx.http
        .post('/api/v1/branches')
        .set(bearer(shop.accessToken))
        .send({ code: 'KDY', name: 'Kandy' })
        .expect(201);
    });

    it('records a bank transfer as a paid invoice, once per reference', async () => {
      const admin = await makeAdmin();
      const platform = await platformLogin(admin);
      const shop = await onboardedTenant(ctx);
      const id = shop.tenant.id as string;
      const payment = {
        planCode: 'BUSINESS',
        interval: 'YEAR',
        amountMinor: 15_000_000,
        reference: 'BOC-TT-20261017-0042',
        reason: 'Paid by bank transfer',
      };
      const detail = (
        await ctx.http
          .post(`/api/v1/platform/tenants/${id}/payments`)
          .set(platform)
          .send(payment)
          .expect(200)
      ).body;
      expect(detail.subscription).toMatchObject({
        status: 'ACTIVE',
        planCode: 'BUSINESS',
        interval: 'YEAR',
      });
      expect(detail.invoices[0]).toMatchObject({ status: 'PAID', totalMinor: 15_000_000 });
      expect(ctx.mailer.lastTo(shop.email)!.subject).toMatch(/^Payment received/);

      const again = await ctx.http
        .post(`/api/v1/platform/tenants/${id}/payments`)
        .set(platform)
        .send(payment)
        .expect(400);
      expect(again.body.error.issues).toEqual([
        { path: 'reference', message: 'validation.payment.duplicate_reference' },
      ]);
    });

    it('moves a business between plans only if it fits', async () => {
      const admin = await makeAdmin();
      const platform = await platformLogin(admin);
      const shop = await onboardedTenant(ctx);
      const id = shop.tenant.id as string;
      await ctx.http
        .post('/api/v1/branches')
        .set(bearer(shop.accessToken))
        .send({ code: 'KDY', name: 'Kandy' })
        .expect(201);
      await ctx.http
        .post(`/api/v1/platform/tenants/${id}/subscription/plan`)
        .set(platform)
        .send({ planCode: 'STARTER', reason: 'Downgrade request' })
        .expect(400);
      const moved = await ctx.http
        .post(`/api/v1/platform/tenants/${id}/subscription/plan`)
        .set(platform)
        .send({ planCode: 'business', reason: 'Enterprise deal' })
        .expect(200);
      expect(moved.body.subscription.planCode).toBe('BUSINESS');
    });

    it('creates and edits plans with versions; hidden plans are not offered', async () => {
      const admin = await makeAdmin();
      const platform = await platformLogin(admin);
      const created = (
        await ctx.http
          .post('/api/v1/platform/plans')
          .set(platform)
          .send({
            code: 'chain_xl',
            name: 'Chain XL',
            priceMonthlyMinor: 4_500_000,
            priceYearlyMinor: 45_000_000,
            limits: { branches: 50, registers: 200, staff: 500, devices: 250 },
          })
          .expect(201)
      ).body;
      expect(created).toMatchObject({
        code: 'CHAIN_XL',
        isPublic: false,
        version: 1,
        subscribers: 0,
      });
      await ctx.http
        .post('/api/v1/platform/plans')
        .set(platform)
        .send({
          code: 'CHAIN_XL',
          name: 'Duplicate',
          priceMonthlyMinor: 1,
          priceYearlyMinor: 1,
          limits: { branches: 1, registers: 1, staff: 1, devices: 1 },
        })
        .expect(409);

      const shop = await onboardedTenant(ctx);
      const offered = async () =>
        (
          await ctx.http.get('/api/v1/billing').set(bearer(shop.accessToken)).expect(200)
        ).body.plans.map((p: { code: string }) => p.code);
      expect(await offered()).not.toContain('CHAIN_XL');

      await ctx.http
        .patch('/api/v1/platform/plans/CHAIN_XL')
        .set(platform)
        .send({ version: 1, isPublic: true, priceMonthlyMinor: 4_000_000 })
        .expect(200);
      await ctx.http
        .patch('/api/v1/platform/plans/CHAIN_XL')
        .set(platform)
        .send({ version: 1, name: 'Stale' })
        .expect(409);
      expect(await offered()).toContain('CHAIN_XL');
      await ctx.http
        .patch('/api/v1/platform/plans/NOPE')
        .set(platform)
        .send({ version: 1, name: 'Nope' })
        .expect(404);

      const growth = (
        await ctx.http.get('/api/v1/platform/plans').set(platform).expect(200)
      ).body.items.find((p: { code: string }) => p.code === 'GROWTH');
      expect(growth.subscribers).toBe(2);
    });

    it('changes flag defaults and per-business settings, which reach the business at once', async () => {
      const admin = await makeAdmin();
      const platform = await platformLogin(admin);
      await ctx.owner.featureFlag.updateMany({ data: { defaultEnabled: true } });
      const shop = await onboardedTenant(ctx);
      const id = shop.tenant.id as string;
      const features = async () =>
        (await ctx.http.get('/api/v1/auth/me').set(bearer(shop.accessToken)).expect(200)).body
          .features as string[];

      const flags = (await ctx.http.get('/api/v1/platform/flags').set(platform).expect(200)).body
        .items;
      const summary = flags.find((f: { key: string }) => f.key === 'notifications.daily_summary');
      expect(summary).toMatchObject({ defaultEnabled: true, overrides: 0 });

      await ctx.http
        .patch('/api/v1/platform/flags/notifications.daily_summary')
        .set(platform)
        .send({ defaultEnabled: false, version: summary.version })
        .expect(200);
      await ctx.http
        .patch('/api/v1/platform/flags/notifications.daily_summary')
        .set(platform)
        .send({ defaultEnabled: true, version: summary.version })
        .expect(409);
      expect((await features()).sort()).toEqual(['loyalty', 'messaging', 'notifications.email']);

      const set = await ctx.http
        .put(`/api/v1/platform/tenants/${id}/flags/notifications.daily_summary`)
        .set(platform)
        .send({ enabled: true, reason: 'Pilot customer' })
        .expect(200);
      expect(set.body).toContainEqual({
        key: 'notifications.daily_summary',
        enabled: true,
        overridden: true,
      });
      expect((await features()).sort()).toEqual([
        'loyalty',
        'messaging',
        'notifications.daily_summary',
        'notifications.email',
      ]);
      await ctx.http
        .put(`/api/v1/platform/tenants/${id}/flags/notifications.daily_summary`)
        .set(platform)
        .send({ enabled: null, reason: 'Pilot over' })
        .expect(200);
      expect((await features()).sort()).toEqual(['loyalty', 'messaging', 'notifications.email']);
      await ctx.http
        .put(`/api/v1/platform/tenants/${id}/flags/unknown.flag`)
        .set(platform)
        .send({ enabled: true, reason: 'Nope' })
        .expect(404);

      const detail = (
        await ctx.http.get(`/api/v1/platform/tenants/${id}`).set(platform).expect(200)
      ).body;
      expect(detail.features).toContainEqual({
        key: 'notifications.daily_summary',
        enabled: false,
        overridden: false,
      });
      const actions = (await ctx.owner.platformAuditLog.findMany()).map((a) => a.action);
      expect(actions.filter((a) => a === 'platform.tenant_flag_set')).toHaveLength(2);
      expect(actions).toContain('platform.flag_updated');
      await ctx.owner.featureFlag.updateMany({ data: { defaultEnabled: true } });
    });

    it('keeps a complete platform audit trail with the acting admin', async () => {
      const admin = await makeAdmin();
      const platform = await platformLogin(admin);
      const shop = await onboardedTenant(ctx);
      await ctx.http
        .post(`/api/v1/platform/tenants/${shop.tenant.id}/subscription/extend`)
        .set(platform)
        .send({ days: 3, reason: 'Support ticket 812' })
        .expect(200);
      const page = (
        await ctx.http
          .get(`/api/v1/platform/audit?tenantId=${shop.tenant.id}`)
          .set(platform)
          .expect(200)
      ).body;
      expect(page.items[0]).toMatchObject({
        action: 'platform.subscription_extended',
        actorEmail: admin.email,
        tenantName: shop.tenant.name,
        metadata: expect.objectContaining({ reason: 'Support ticket 812', days: 3 }),
      });
      // The application cannot rewrite the platform audit trail.
      await expect(
        ctx.prisma.asSystem((tx) => tx.platformAuditLog.deleteMany({})),
      ).rejects.toThrow();
    });
  });
});
