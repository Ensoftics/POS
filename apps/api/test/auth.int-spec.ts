import { JwtService } from '@nestjs/jwt';
import {
  addMember,
  bearer,
  createTestContext,
  login,
  registerTenant,
  registration,
  resetDatabase,
  STRONG_PASSWORD,
  type TestContext,
} from './helpers';

describe('Auth (integration)', () => {
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

  describe('registration', () => {
    it('creates tenant, owner membership and a mobile session', async () => {
      const session = await registerTenant(ctx);
      expect(session.role).toBe('OWNER');
      expect(session.tenant.onboardingStatus).toBe('PENDING');
      expect(session.permissions).toContain('audit.read');
      expect(session.refreshToken).toEqual(expect.any(String));

      const audit = await ctx.owner.auditLog.findMany({ where: { tenantId: session.tenant.id } });
      expect(audit.map((entry) => entry.action)).toEqual(['tenant.registered']);
    });

    it('delivers the web refresh token only as a strict httpOnly cookie', async () => {
      const response = await ctx.http
        .post('/api/v1/auth/register')
        .send(registration({ clientType: 'WEB' }))
        .expect(201);
      expect(response.body.refreshToken).toBeUndefined();
      const cookie = ([] as string[]).concat(response.headers['set-cookie'] ?? []).join(';');
      expect(cookie).toMatch(/pos_rt=/);
      expect(cookie).toMatch(/HttpOnly/i);
      expect(cookie).toMatch(/SameSite=Strict/i);
      expect(cookie).toMatch(/Path=\/api\/v1\/auth/);
    });

    it('rejects a duplicate email regardless of case', async () => {
      const first = await registerTenant(ctx);
      const response = await ctx.http
        .post('/api/v1/auth/register')
        .send(registration({ email: first.email.toUpperCase() }))
        .expect(409);
      expect(response.body.error.code).toBe('EMAIL_IN_USE');
    });

    it('lets exactly one of two concurrent duplicate registrations succeed', async () => {
      const body = registration();
      const results = await Promise.all([
        ctx.http.post('/api/v1/auth/register').send(body),
        ctx.http.post('/api/v1/auth/register').send(body),
      ]);
      expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
      expect(await ctx.owner.tenant.count()).toBe(1);
    });

    it('returns localisable validation issues', async () => {
      const response = await ctx.http
        .post('/api/v1/auth/register')
        .send({ ...registration(), password: 'short', email: 'nope' })
        .expect(400);
      expect(response.body.error.code).toBe('VALIDATION_FAILED');
      expect(response.body.error.issues).toEqual(
        expect.arrayContaining([
          { path: 'email', message: 'validation.email.invalid' },
          { path: 'password', message: 'validation.password.too_short' },
        ]),
      );
      expect(await ctx.owner.tenant.count()).toBe(0);
    });

    it('rejects malformed JSON without echoing it', async () => {
      const response = await ctx.http
        .post('/api/v1/auth/register')
        .set('Content-Type', 'application/json')
        .send('{"email": "secret-value"')
        .expect(400);
      expect(JSON.stringify(response.body)).not.toContain('secret-value');
    });
  });

  describe('login', () => {
    it('signs in with correct credentials', async () => {
      const { email } = await registerTenant(ctx);
      const session = await login(ctx, email);
      expect(session.user.email).toBe(email);
    });

    it('gives the same error for unknown email and wrong password', async () => {
      const { email } = await registerTenant(ctx);
      const wrong = await ctx.http
        .post('/api/v1/auth/login')
        .send({ email, password: 'wrong-password' })
        .expect(401);
      const unknown = await ctx.http
        .post('/api/v1/auth/login')
        .send({ email: 'nobody@example.com', password: 'wrong-password' })
        .expect(401);
      expect(wrong.body.error.code).toBe('INVALID_CREDENTIALS');
      expect(unknown.body.error).toMatchObject({
        code: wrong.body.error.code,
        message: wrong.body.error.message,
      });
    });

    it('locks the account after repeated failures', async () => {
      const { email } = await registerTenant(ctx);
      for (let i = 0; i < 5; i += 1) {
        await ctx.http
          .post('/api/v1/auth/login')
          .send({ email, password: 'wrong-password' })
          .expect(401);
      }
      const locked = await ctx.http
        .post('/api/v1/auth/login')
        .send({ email, password: STRONG_PASSWORD })
        .expect(423);
      expect(locked.body.error.code).toBe('ACCOUNT_LOCKED');

      const actions = (await ctx.owner.auditLog.findMany({ where: { tenantId: null } })).map(
        (a) => a.action,
      );
      expect(actions.filter((a) => a === 'auth.login_failed')).toHaveLength(5);
      expect(actions).toContain('auth.account_locked');
    });

    it('asks users with several businesses to choose, and rejects businesses they do not belong to', async () => {
      const a = await registerTenant(ctx, { businessName: 'Shop A' });
      const b = await registerTenant(ctx, { businessName: 'Shop B' });
      const c = await registerTenant(ctx, { businessName: 'Shop C' });
      await addMember(ctx, b.tenant.id, 'CASHIER', a.email);

      const choice = await ctx.http
        .post('/api/v1/auth/login')
        .send({ email: a.email, password: STRONG_PASSWORD })
        .expect(200);
      expect(choice.body.requiresTenantSelection).toBe(true);
      expect(choice.body.tenants.map((t: { tenantName: string }) => t.tenantName).sort()).toEqual([
        'Shop A',
        'Shop B',
      ]);

      const inB = await login(ctx, a.email, { tenantId: b.tenant.id });
      expect(inB.tenant.id).toBe(b.tenant.id);
      expect(inB.role).toBe('CASHIER');

      const denied = await ctx.http
        .post('/api/v1/auth/login')
        .send({ email: a.email, password: STRONG_PASSWORD, tenantId: c.tenant.id })
        .expect(403);
      expect(denied.body.error.code).toBe('NO_ACTIVE_MEMBERSHIP');
    });
  });

  describe('access tokens', () => {
    it('requires a token for protected routes', async () => {
      const response = await ctx.http.get('/api/v1/auth/me').expect(401);
      expect(response.body.error.code).toBe('UNAUTHENTICATED');
    });

    it('rejects tampered, foreign-signed and unsigned tokens', async () => {
      const { accessToken, tenant, user } = await registerTenant(ctx);
      const [header, payload, signature] = accessToken.split('.') as [string, string, string];
      const forged = JSON.parse(Buffer.from(payload, 'base64url').toString());
      forged.role = 'OWNER';
      forged.tid = '00000000-0000-4000-8000-000000000000';
      const tampered = `${header}.${Buffer.from(JSON.stringify(forged)).toString('base64url')}.${signature}`;

      const foreign = await new JwtService().signAsync(
        { sub: user.id, tid: tenant.id, sid: forged.sid, role: 'OWNER' },
        {
          secret: 'another-secret-that-is-long-enough-for-hs256',
          issuer: 'pos-api',
          audience: 'pos-clients',
        },
      );
      const unsigned = `${Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url')}.${payload}.`;

      for (const token of [tampered, foreign, unsigned]) {
        const response = await ctx.http.get('/api/v1/auth/me').set(bearer(token)).expect(401);
        expect(response.body.error.code).toBe('UNAUTHENTICATED');
      }
    });

    it('returns the live auth context', async () => {
      const session = await registerTenant(ctx);
      const me = await ctx.http.get('/api/v1/auth/me').set(bearer(session.accessToken)).expect(200);
      expect(me.body).toMatchObject({ role: 'OWNER', tenant: { id: session.tenant.id } });
      expect(me.body.accessToken).toBeUndefined();
    });

    it('stops working immediately when the membership is disabled', async () => {
      const session = await registerTenant(ctx);
      await ctx.owner.membership.updateMany({
        where: { tenantId: session.tenant.id },
        data: { status: 'DISABLED' },
      });
      const response = await ctx.http
        .get('/api/v1/auth/me')
        .set(bearer(session.accessToken))
        .expect(401);
      expect(response.body.error.code).toBe('SESSION_EXPIRED');
    });

    it('picks up role changes without re-login', async () => {
      const session = await registerTenant(ctx);
      await ctx.http.get('/api/v1/audit-logs').set(bearer(session.accessToken)).expect(200);
      await ctx.owner.membership.updateMany({
        where: { tenantId: session.tenant.id },
        data: { role: 'CASHIER' },
      });
      await ctx.http.get('/api/v1/audit-logs').set(bearer(session.accessToken)).expect(403);
    });
  });

  describe('refresh token rotation', () => {
    it('rotates the refresh token and keeps the session usable', async () => {
      const session = await registerTenant(ctx);
      const refreshed = await ctx.http
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: session.refreshToken })
        .expect(200);
      expect(refreshed.body.refreshToken).not.toBe(session.refreshToken);
      await ctx.http.get('/api/v1/auth/me').set(bearer(refreshed.body.accessToken)).expect(200);
      // Access tokens issued before rotation stay valid until expiry (same family).
      await ctx.http.get('/api/v1/auth/me').set(bearer(session.accessToken)).expect(200);
    });

    it('quietly rejects a just-rotated token (concurrent tabs) without revoking the family', async () => {
      const session = await registerTenant(ctx);
      const refreshed = await ctx.http
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: session.refreshToken })
        .expect(200);
      await ctx.http
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: session.refreshToken })
        .expect(401);
      await ctx.http
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: refreshed.body.refreshToken })
        .expect(200);
    });

    it('revokes the whole family when a rotated token is replayed later', async () => {
      const session = await registerTenant(ctx);
      const refreshed = await ctx.http
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: session.refreshToken })
        .expect(200);
      // Simulate the replay arriving after the grace window.
      await ctx.owner.session.updateMany({
        where: { revokedReason: 'ROTATED' },
        data: { revokedAt: new Date(Date.now() - 5 * 60_000) },
      });

      await ctx.http
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: session.refreshToken })
        .expect(401);
      await ctx.http
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: refreshed.body.refreshToken })
        .expect(401);
      await ctx.http.get('/api/v1/auth/me').set(bearer(refreshed.body.accessToken)).expect(401);

      const reuse = await ctx.owner.auditLog.findFirst({
        where: { action: 'auth.refresh_token_reuse_detected' },
      });
      expect(reuse?.tenantId).toBe(session.tenant.id);
    });

    it('lets only one of two simultaneous refreshes rotate', async () => {
      const session = await registerTenant(ctx);
      const results = await Promise.all([
        ctx.http.post('/api/v1/auth/refresh').send({ refreshToken: session.refreshToken }),
        ctx.http.post('/api/v1/auth/refresh').send({ refreshToken: session.refreshToken }),
      ]);
      expect(results.map((r) => r.status).sort()).toEqual([200, 401]);
      expect(await ctx.owner.session.count({ where: { revokedAt: null } })).toBe(1);
    });

    it('requires the client header when refreshing from the cookie', async () => {
      const response = await ctx.http
        .post('/api/v1/auth/register')
        .send(registration({ clientType: 'WEB' }))
        .expect(201);
      const cookies = ([] as string[]).concat(response.headers['set-cookie'] ?? []);
      const cookie = cookies.map((c) => c.split(';')[0]).join('; ');

      await ctx.http.post('/api/v1/auth/refresh').set('Cookie', cookie).send({}).expect(403);
      const ok = await ctx.http
        .post('/api/v1/auth/refresh')
        .set('Cookie', cookie)
        .set('x-pos-client', 'web')
        .send({})
        .expect(200);
      expect(ok.body.refreshToken).toBeUndefined();
    });

    it('rejects expired sessions', async () => {
      const session = await registerTenant(ctx);
      await ctx.owner.session.updateMany({ data: { expiresAt: new Date(Date.now() - 1000) } });
      const response = await ctx.http
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: session.refreshToken })
        .expect(401);
      expect(response.body.error.code).toBe('SESSION_EXPIRED');
    });
  });

  describe('logout', () => {
    it('revokes the session and its access tokens immediately', async () => {
      const session = await registerTenant(ctx);
      await ctx.http
        .post('/api/v1/auth/logout')
        .send({ refreshToken: session.refreshToken })
        .expect(200);
      await ctx.http.get('/api/v1/auth/me').set(bearer(session.accessToken)).expect(401);
      await ctx.http
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: session.refreshToken })
        .expect(401);
      // Idempotent
      await ctx.http
        .post('/api/v1/auth/logout')
        .send({ refreshToken: session.refreshToken })
        .expect(200);
    });

    it('logout-all signs the user out on every device', async () => {
      const first = await registerTenant(ctx);
      const second = await login(ctx, first.email);
      await ctx.http.post('/api/v1/auth/logout-all').set(bearer(second.accessToken)).expect(200);
      await ctx.http.get('/api/v1/auth/me').set(bearer(first.accessToken)).expect(401);
      await ctx.http
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: second.refreshToken })
        .expect(401);
    });
  });
});
