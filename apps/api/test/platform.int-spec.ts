import {
  bearer,
  createTestContext,
  registerTenant,
  registration,
  resetDatabase,
  type TestContext,
} from './helpers';

describe('Platform concerns (integration)', () => {
  describe('health and request ids', () => {
    let ctx: TestContext;
    beforeAll(async () => {
      ctx = await createTestContext();
    });
    afterAll(async () => {
      await ctx.close();
    });

    it('reports liveness and readiness outside the API prefix', async () => {
      await ctx.http.get('/health/live').expect(200);
      const ready = await ctx.http.get('/health/ready').expect(200);
      expect(ready.body).toMatchObject({ status: 'ok', checks: { database: 'up' } });
    });

    it('echoes a well-formed request id and replaces a malformed one', async () => {
      const echoed = await ctx.http
        .get('/health/live')
        .set('X-Request-Id', 'trace-12345678')
        .expect(200);
      expect(echoed.headers['x-request-id']).toBe('trace-12345678');
      const replaced = await ctx.http
        .get('/health/live')
        .set('X-Request-Id', 'bad id <script>')
        .expect(200);
      expect(replaced.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
    });

    it('includes the request id in error envelopes and audit entries', async () => {
      await resetDatabase(ctx.owner);
      const response = await ctx.http
        .get('/api/v1/auth/me')
        .set('X-Request-Id', 'trace-abcdefgh')
        .expect(401);
      expect(response.body.error.requestId).toBe('trace-abcdefgh');

      const reg = await ctx.http
        .post('/api/v1/auth/register')
        .set('X-Request-Id', 'trace-register-1')
        .send(registration())
        .expect(201);
      const entry = await ctx.owner.auditLog.findFirstOrThrow({
        where: { tenantId: reg.body.tenant.id },
      });
      expect(entry.requestId).toBe('trace-register-1');
    });

    it('returns 404 envelopes for unknown routes', async () => {
      const session = await registerTenant(ctx);
      const response = await ctx.http
        .get('/api/v1/does-not-exist')
        .set(bearer(session.accessToken))
        .expect(404);
      expect(response.body.error.code).toBe('NOT_FOUND');
    });

    it('serves the OpenAPI document', async () => {
      const response = await ctx.http.get('/api/v1/docs-json').expect(200);
      expect(Object.keys(response.body.paths)).toEqual(
        expect.arrayContaining(['/api/v1/auth/login', '/api/v1/tenant']),
      );
    });

    it('sends CORS headers only to allowed origins', async () => {
      const allowed = await ctx.http
        .options('/api/v1/auth/login')
        .set('Origin', ctx.config.CORS_ORIGINS[0]!)
        .set('Access-Control-Request-Method', 'POST');
      expect(allowed.headers['access-control-allow-origin']).toBe(ctx.config.CORS_ORIGINS[0]);
      const denied = await ctx.http
        .options('/api/v1/auth/login')
        .set('Origin', 'https://evil.example')
        .set('Access-Control-Request-Method', 'POST');
      expect(denied.headers['access-control-allow-origin']).toBeUndefined();
    });
  });

  describe('rate limiting', () => {
    let ctx: TestContext;
    beforeAll(async () => {
      ctx = await createTestContext({ RATE_LIMIT_AUTH_PER_MINUTE: 3 });
    });
    afterAll(async () => {
      await ctx.close();
    });

    it('throttles sensitive auth endpoints per client', async () => {
      const attempt = () =>
        ctx.http
          .post('/api/v1/auth/login')
          .send({ email: 'x@example.com', password: 'whatever-pass' });
      for (let i = 0; i < 3; i += 1) expect((await attempt()).status).toBe(401);
      const limited = await attempt();
      expect(limited.status).toBe(429);
      expect(limited.body.error.code).toBe('RATE_LIMITED');
      // Non-sensitive routes keep working.
      await ctx.http.get('/health/live').expect(200);
      await ctx.http.get('/api/v1/auth/me').expect(401);
    });
  });
});
