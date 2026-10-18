import { randomUUID } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { NotifyLkSms } from '../src/messaging/sms-sender';
import { MessagingSweep } from '../src/messaging/messaging-sweep.service';
import { loadConfig } from '../src/config/app-config';
import {
  addMember,
  bearer,
  createTestContext,
  login,
  onboardedTenant,
  resetDatabase,
  type TestContext,
} from './helpers';

describe('Customer messaging with recorded consent (integration)', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await createTestContext();
  });
  beforeEach(async () => {
    await resetDatabase(ctx.owner);
    await ctx.owner.featureFlag.updateMany({ data: { defaultEnabled: true } });
    ctx.mailer.sent.length = 0;
    ctx.sms.sent.length = 0;
    ctx.sms.results = [];
    ctx.sms.enabled = true;
  });
  afterAll(async () => {
    await ctx.close();
  });

  const sweep = () => ctx.app.get(MessagingSweep).run();
  // Sign-up also sends a verification e-mail; campaign e-mails carry List-Unsubscribe.
  const campaignMails = () => ctx.mailer.sent.filter((m) => m.headers?.['List-Unsubscribe']);

  async function shop() {
    const session = await onboardedTenant(ctx, 'TEXTILE');
    const auth = bearer(session.accessToken);
    const customer = (body: Record<string, unknown>) =>
      ctx.http
        .post('/api/v1/customers')
        .set(auth)
        .send(body)
        .expect(201)
        .then((r) => r.body as { id: string; version: number });
    return { session, auth, tenantId: session.tenant.id as string, customer };
  }

  const campaign = (auth: ReturnType<typeof bearer>, body: Record<string, unknown>) =>
    ctx.http
      .post('/api/v1/messaging/campaigns')
      .set(auth)
      .send({ id: randomUUID(), ...body });

  describe('consent history', () => {
    it('records who recorded consent, how, and every change, and cannot be rewritten', async () => {
      const s = await shop();
      const nimali = await s.customer({
        name: 'Nimali Perera',
        email: 'nimali@example.com',
        marketingConsent: true,
        consentNote: 'Asked at the till',
      });
      await ctx.http
        .patch(`/api/v1/customers/${nimali.id}`)
        .set(s.auth)
        .send({ version: 1, notes: 'Prefers silk' })
        .expect(200);
      await ctx.http
        .patch(`/api/v1/customers/${nimali.id}`)
        .set(s.auth)
        .send({ version: 2, marketingConsent: false, consentNote: 'Asked by phone to stop' })
        .expect(200);

      const history = await ctx.http
        .get(`/api/v1/customers/${nimali.id}/consents`)
        .set(s.auth)
        .expect(200);
      expect(history.body.items).toMatchObject([
        {
          granted: false,
          source: 'STAFF',
          note: 'Asked by phone to stop',
          actorName: expect.any(String),
        },
        {
          granted: true,
          source: 'STAFF',
          note: 'Asked at the till',
          actorName: expect.any(String),
        },
      ]);

      // Append-only for the application role.
      await expect(
        ctx.prisma.withTenant(
          s.tenantId,
          (tx) => tx.$executeRaw`UPDATE consent_events SET granted = true`,
        ),
      ).rejects.toThrow(/permission denied/);
    });
  });

  describe('e-mail campaigns', () => {
    it('sends only to customers who agreed, personalised, with an opt-out link', async () => {
      const s = await shop();
      await s.customer({
        name: 'Nimali Perera',
        email: 'nimali@example.com',
        marketingConsent: true,
      });
      await s.customer({ name: 'No Email', phone: '0771234567', marketingConsent: true });
      await s.customer({ name: 'Not Agreed', email: 'no@example.com' });

      const status = await ctx.http.get('/api/v1/messaging/status').set(s.auth).expect(200);
      expect(status.body).toMatchObject({
        channels: { EMAIL: true, SMS: true },
        audience: { EMAIL: 1, SMS: 1 },
        smsAllowance: 1000,
        smsUsedThisMonth: 0,
      });

      const id = randomUUID();
      const body = {
        id,
        channel: 'EMAIL',
        subject: 'New sarees',
        body: 'Hi {name},\n\nNew sarees are in!',
      };
      const created = await ctx.http
        .post('/api/v1/messaging/campaigns')
        .set(s.auth)
        .send(body)
        .expect(201);
      expect(created.body).toMatchObject({ status: 'SENDING', recipients: 1, queued: 1 });
      // A retry with the same id does not queue it twice.
      await ctx.http.post('/api/v1/messaging/campaigns').set(s.auth).send(body).expect(201);
      expect(await ctx.owner.messageDelivery.count()).toBe(1);

      expect(await sweep()).toBe(1);
      expect(campaignMails()).toHaveLength(1);
      const mail = campaignMails()[0]!;
      expect(mail).toMatchObject({ to: 'nimali@example.com', subject: 'New sarees' });
      expect(mail.text).toContain('Hi Nimali,\n\nNew sarees are in!');
      const code = (await ctx.owner.customer.findFirstOrThrow({ where: { name: 'Nimali Perera' } }))
        .unsubscribeCode;
      expect(mail.text).toContain(`${ctx.config.WEB_APP_URL}/u/${code}`);
      expect(mail.headers).toEqual({ 'List-Unsubscribe': `<${ctx.config.WEB_APP_URL}/u/${code}>` });

      const list = await ctx.http.get('/api/v1/messaging/campaigns').set(s.auth).expect(200);
      expect(list.body.items).toMatchObject([
        { id, status: 'DONE', sent: 1, queued: 0, createdByName: expect.any(String) },
      ]);
      const audit = await ctx.owner.auditLog.findFirstOrThrow({
        where: { action: 'customer.campaign_created' },
      });
      expect(audit.metadata).toEqual({ channel: 'EMAIL', recipients: 1 });
    });

    it('skips customers who withdrew consent after the message was queued', async () => {
      const s = await shop();
      const nimali = await s.customer({
        name: 'Nimali Perera',
        email: 'nimali@example.com',
        marketingConsent: true,
      });
      await campaign(s.auth, { channel: 'EMAIL', subject: 'Sale', body: 'Sale today' }).expect(201);
      await ctx.http
        .patch(`/api/v1/customers/${nimali.id}`)
        .set(s.auth)
        .send({ version: nimali.version, marketingConsent: false })
        .expect(200);
      await sweep();
      expect(campaignMails()).toHaveLength(0);
      expect(await ctx.owner.messageDelivery.findFirstOrThrow()).toMatchObject({
        status: 'SKIPPED',
        error: 'consent_withdrawn',
      });
    });

    it('refuses with nobody to send to, without permission, or when switched off', async () => {
      const s = await shop();
      const empty = await campaign(s.auth, { channel: 'EMAIL', subject: 'Hi', body: 'Hi' }).expect(
        400,
      );
      expect(empty.body.error.issues).toEqual([
        { path: 'channel', message: 'validation.message.no_recipients' },
      ]);
      const noSubject = await campaign(s.auth, { channel: 'EMAIL', body: 'Hi' }).expect(400);
      expect(noSubject.body.error.issues).toEqual([
        { path: 'subject', message: 'validation.required' },
      ]);

      const cashier = await addMember(ctx, s.tenantId, 'CASHIER');
      const cashierAuth = bearer((await login(ctx, cashier.email)).accessToken);
      await campaign(cashierAuth, { channel: 'EMAIL', subject: 'Hi', body: 'Hi' }).expect(403);
      await ctx.http.get('/api/v1/messaging/status').set(cashierAuth).expect(403);

      await s.customer({ name: 'Nimali', email: 'n@example.com', marketingConsent: true });
      await ctx.owner.tenantFeatureFlag.create({
        data: { tenantId: s.tenantId, flagKey: 'messaging', enabled: false },
      });
      const off = await campaign(s.auth, { channel: 'EMAIL', subject: 'Hi', body: 'Hi' }).expect(
        503,
      );
      expect(off.body.error.code).toBe('MESSAGING_UNAVAILABLE');
    });
  });

  describe('SMS campaigns', () => {
    it('sends Sinhala as Unicode with the opt-out link, and counts against the monthly allowance', async () => {
      const s = await shop();
      await s.customer({ name: 'Nimali Perera', phone: '077 123 4567', marketingConsent: true });
      await s.customer({ name: 'Kamal Silva', phone: '0712345678', marketingConsent: true });
      await s.customer({ name: 'Landline', phone: '0112345678', marketingConsent: true });

      await campaign(s.auth, { channel: 'SMS', body: '{name}, අලුත් සාරි ආවා!' }).expect(201);
      await sweep();
      expect(ctx.sms.sent).toHaveLength(2);
      const first = ctx.sms.sent.find((m) => m.to === '+94771234567')!;
      expect(first.unicode).toBe(true);
      expect(first.text).toMatch(
        new RegExp(`^Nimali, අලුත් සාරි ආවා!\\nStop: ${ctx.config.WEB_APP_URL}/u/\\w{12}$`),
      );

      const status = await ctx.http.get('/api/v1/messaging/status').set(s.auth).expect(200);
      expect(status.body.smsUsedThisMonth).toBe(2);

      const plan = await ctx.owner.plan.findUniqueOrThrow({ where: { code: 'GROWTH' } });
      await ctx.owner.plan.update({ where: { id: plan.id }, data: { smsPerMonth: 3 } });
      try {
        const over = await campaign(s.auth, {
          channel: 'SMS',
          body: 'Last day of the sale',
        }).expect(409);
        expect(over.body.error.code).toBe('PLAN_LIMIT_REACHED');
        expect(over.body.error.message).toContain('needs 2 SMS; 1 are left');
      } finally {
        await ctx.owner.plan.update({
          where: { id: plan.id },
          data: { smsPerMonth: plan.smsPerMonth },
        });
      }
    });

    it('retries temporary gateway failures, then gives up after three attempts', async () => {
      const s = await shop();
      await s.customer({ name: 'Nimali', phone: '0771234567', marketingConsent: true });
      await campaign(s.auth, { channel: 'SMS', body: 'Hello' }).expect(201);
      const down = { ok: false as const, retry: true, reason: 'gateway_unreachable' };
      ctx.sms.results = [down, down, down];
      await sweep();
      await sweep();
      expect(await ctx.owner.messageDelivery.findFirstOrThrow()).toMatchObject({
        status: 'QUEUED',
        attempts: 2,
      });
      await sweep();
      expect(await ctx.owner.messageDelivery.findFirstOrThrow()).toMatchObject({
        status: 'FAILED',
        attempts: 3,
        error: 'gateway_unreachable',
      });
      const list = await ctx.http.get('/api/v1/messaging/campaigns').set(s.auth).expect(200);
      expect(list.body.items[0]).toMatchObject({ status: 'DONE', failed: 1 });
    });

    it('is unavailable until the gateway is set up, and refuses messages that would not fit', async () => {
      const s = await shop();
      await s.customer({ name: 'Nimali', phone: '0771234567', marketingConsent: true });
      const long = await campaign(s.auth, { channel: 'SMS', body: 'x'.repeat(600) }).expect(400);
      expect(long.body.error.issues).toEqual([
        { path: 'body', message: 'validation.message.sms_too_long' },
      ]);
      ctx.sms.enabled = false;
      const status = await ctx.http.get('/api/v1/messaging/status').set(s.auth).expect(200);
      expect(status.body.channels).toEqual({ EMAIL: true, SMS: false });
      const off = await campaign(s.auth, { channel: 'SMS', body: 'Hello' }).expect(503);
      expect(off.body.error.code).toBe('MESSAGING_UNAVAILABLE');
    });
  });

  describe('opt-out link', () => {
    it('lets the customer stop messages without signing in, recorded in the history', async () => {
      const s = await shop();
      const nimali = await s.customer({
        name: 'Nimali',
        email: 'nimali@example.com',
        marketingConsent: true,
      });
      await campaign(s.auth, { channel: 'EMAIL', subject: 'Sale', body: 'Sale' }).expect(201);
      const { unsubscribeCode: code } = await ctx.owner.customer.findUniqueOrThrow({
        where: { id: nimali.id },
      });

      const info = await ctx.http.get(`/api/v1/public/unsubscribe/${code}`).expect(200);
      expect(info.body).toEqual({ businessName: s.session.tenant.name, subscribed: true });
      const done = await ctx.http.post('/api/v1/public/unsubscribe').send({ code }).expect(200);
      expect(done.body.subscribed).toBe(false);
      // Opening the link again changes nothing.
      await ctx.http.post('/api/v1/public/unsubscribe').send({ code }).expect(200);

      const history = await ctx.http
        .get(`/api/v1/customers/${nimali.id}/consents`)
        .set(s.auth)
        .expect(200);
      expect(history.body.items).toHaveLength(2);
      expect(history.body.items[0]).toMatchObject({
        granted: false,
        source: 'UNSUBSCRIBE_LINK',
        actorName: null,
      });
      expect(await ctx.owner.messageDelivery.findFirstOrThrow()).toMatchObject({
        status: 'SKIPPED',
      });
      const customer = await ctx.http.get(`/api/v1/customers/${nimali.id}`).set(s.auth).expect(200);
      expect(customer.body.marketingConsent).toBe(false);

      await ctx.http.get('/api/v1/public/unsubscribe/NotARealCode1').expect(404);
      await ctx.http.get('/api/v1/public/unsubscribe/bad!').expect(404);
    });
  });

  describe('Notify.lk adapter', () => {
    let server: Server;
    let received: Array<Record<string, string>>;
    let reply: { status: number; body: unknown };

    beforeAll(async () => {
      server = createServer((req, res) => {
        let raw = '';
        req.on('data', (chunk) => (raw += chunk));
        req.on('end', () => {
          received.push(Object.fromEntries(new URLSearchParams(raw)));
          res.writeHead(reply.status, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(reply.body));
        });
      });
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    });
    afterAll(async () => {
      await new Promise((resolve) => server.close(resolve));
    });
    beforeEach(() => {
      received = [];
    });

    const adapter = (configured = true) => {
      const { port } = server.address() as AddressInfo;
      return new NotifyLkSms({
        ...loadConfig(),
        NOTIFYLK_URL: `http://127.0.0.1:${port}/api/v1/send`,
        ...(configured
          ? {
              NOTIFYLK_USER_ID: '123',
              NOTIFYLK_API_KEY: 'secret-key',
              NOTIFYLK_SENDER_ID: 'ShopLK',
            }
          : {}),
      });
    };

    it('posts the documented form fields and reads the reply', async () => {
      reply = { status: 200, body: { status: 'success', data: 'Sent' } };
      expect(await adapter().send('+94771234567', 'ආයුබෝවන්', true)).toEqual({ ok: true });
      expect(received).toEqual([
        {
          user_id: '123',
          api_key: 'secret-key',
          sender_id: 'ShopLK',
          to: '94771234567',
          message: 'ආයුබෝවන්',
          type: 'unicode',
        },
      ]);

      reply = { status: 400, body: { status: 'error', message: 'Invalid number' } };
      expect(await adapter().send('+94771234567', 'Hi', false)).toEqual({
        ok: false,
        retry: false,
        reason: 'gateway_400: Invalid number',
      });
      reply = { status: 503, body: {} };
      expect(await adapter().send('+94771234567', 'Hi', false)).toMatchObject({ retry: true });
      expect(await adapter(false).send('+94771234567', 'Hi', false)).toMatchObject({
        ok: false,
        reason: 'sms_not_configured',
      });
    });
  });
});
