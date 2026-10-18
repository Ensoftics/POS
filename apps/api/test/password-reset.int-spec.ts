import {
  bearer,
  createTestContext,
  registerTenant,
  resetDatabase,
  STRONG_PASSWORD,
  type TestContext,
} from './helpers';

const NEW_PASSWORD = 'violet-harbour-lantern-7';

function tokenFrom(text: string): string {
  const match = /token=([A-Za-z0-9_-]+)/.exec(text);
  if (!match?.[1]) throw new Error('No reset token in email');
  return match[1];
}

describe('Password reset (integration)', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await createTestContext();
  });
  beforeEach(async () => {
    await resetDatabase(ctx.owner);
    ctx.mailer.sent.length = 0;
  });
  afterAll(async () => {
    await ctx.close();
  });

  it('accepts unknown emails without sending anything', async () => {
    const response = await ctx.http
      .post('/api/v1/auth/password/forgot')
      .send({ email: 'ghost@example.com' })
      .expect(202);
    expect(response.body).toEqual({ accepted: true });
    expect(ctx.mailer.sent).toHaveLength(0);
  });

  it('resets the password, revokes sessions and consumes the token', async () => {
    const session = await registerTenant(ctx);
    await ctx.http.post('/api/v1/auth/password/forgot').send({ email: session.email }).expect(202);

    const email = ctx.mailer.lastTo(session.email);
    expect(email?.text).toContain(`${ctx.config.WEB_APP_URL}/reset-password?token=`);
    const token = tokenFrom(email!.text);
    // Only the hash is stored.
    expect(await ctx.owner.passwordResetToken.count({ where: { tokenHash: token } })).toBe(0);

    await ctx.http
      .post('/api/v1/auth/password/reset')
      .send({ token, password: NEW_PASSWORD })
      .expect(200);

    await ctx.http.get('/api/v1/auth/me').set(bearer(session.accessToken)).expect(401);
    await ctx.http
      .post('/api/v1/auth/login')
      .send({ email: session.email, password: STRONG_PASSWORD })
      .expect(401);
    await ctx.http
      .post('/api/v1/auth/login')
      .send({ email: session.email, password: NEW_PASSWORD })
      .expect(200);
    expect(ctx.mailer.lastTo(session.email)?.subject).toBe('Your password was changed');

    const reused = await ctx.http
      .post('/api/v1/auth/password/reset')
      .send({ token, password: 'another-long-passphrase' })
      .expect(400);
    expect(reused.body.error.code).toBe('INVALID_RESET_TOKEN');
  });

  it('invalidates older links when a new one is requested', async () => {
    const { email } = await registerTenant(ctx);
    await ctx.http.post('/api/v1/auth/password/forgot').send({ email }).expect(202);
    const first = tokenFrom(ctx.mailer.lastTo(email)!.text);
    await ctx.http.post('/api/v1/auth/password/forgot').send({ email }).expect(202);
    const second = tokenFrom(ctx.mailer.lastTo(email)!.text);

    await ctx.http
      .post('/api/v1/auth/password/reset')
      .send({ token: first, password: NEW_PASSWORD })
      .expect(400);
    await ctx.http
      .post('/api/v1/auth/password/reset')
      .send({ token: second, password: NEW_PASSWORD })
      .expect(200);
  });

  it('rejects expired tokens', async () => {
    const { email } = await registerTenant(ctx);
    await ctx.http.post('/api/v1/auth/password/forgot').send({ email }).expect(202);
    const token = tokenFrom(ctx.mailer.lastTo(email)!.text);
    await ctx.owner.passwordResetToken.updateMany({
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    await ctx.http
      .post('/api/v1/auth/password/reset')
      .send({ token, password: NEW_PASSWORD })
      .expect(400);
  });

  it('caps reset emails per account', async () => {
    const { email } = await registerTenant(ctx);
    for (let i = 0; i < 7; i += 1) {
      await ctx.http.post('/api/v1/auth/password/forgot').send({ email }).expect(202);
    }
    const resets = ctx.mailer.sent.filter(
      (m) => m.to === email && m.subject === 'Reset your password',
    );
    expect(resets).toHaveLength(5);
  });

  it('enforces the password policy including identity checks', async () => {
    const { email } = await registerTenant(ctx, { ownerFullName: 'Kamal Perera' });
    await ctx.http.post('/api/v1/auth/password/forgot').send({ email }).expect(202);
    const token = tokenFrom(ctx.mailer.lastTo(email)!.text);

    const weak = await ctx.http
      .post('/api/v1/auth/password/reset')
      .send({ token, password: 'password123' })
      .expect(400);
    expect(weak.body.error.issues).toContainEqual({
      path: 'password',
      message: 'validation.password.too_common',
    });

    const personal = await ctx.http
      .post('/api/v1/auth/password/reset')
      .send({ token, password: 'perera-family-shop' })
      .expect(400);
    expect(personal.body.error.issues).toContainEqual({
      path: 'password',
      message: 'validation.password.contains_identity',
    });

    // The token survives validation failures.
    await ctx.http
      .post('/api/v1/auth/password/reset')
      .send({ token, password: NEW_PASSWORD })
      .expect(200);
  });

  it('unlocks a locked account', async () => {
    const { email } = await registerTenant(ctx);
    await ctx.owner.user.updateMany({ data: { lockedUntil: new Date(Date.now() + 60 * 60_000) } });
    await ctx.http.post('/api/v1/auth/password/forgot').send({ email }).expect(202);
    const token = tokenFrom(ctx.mailer.lastTo(email)!.text);
    await ctx.http
      .post('/api/v1/auth/password/reset')
      .send({ token, password: NEW_PASSWORD })
      .expect(200);
    await ctx.http.post('/api/v1/auth/login').send({ email, password: NEW_PASSWORD }).expect(200);
  });
});
