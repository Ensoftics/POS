import { createHash, randomUUID } from 'node:crypto';
import { SubscriptionLifecycle } from '../src/billing/lifecycle.service';
import {
  addMember,
  bearer,
  createTestContext,
  login,
  onboardedTenant,
  resetDatabase,
  type TestContext,
  uniqueEmail,
} from './helpers';

const MERCHANT_ID = '1211149';
const MERCHANT_SECRET = 'test-merchant-secret-value';
const DAY = 86_400_000;

const md5U = (value: string) => createHash('md5').update(value).digest('hex').toUpperCase();

/** A PayHere notification signed the way PayHere signs them. */
function notification(
  orderId: string,
  amount: string,
  statusCode: string,
  overrides: Record<string, string> = {},
) {
  const fields: Record<string, string> = {
    merchant_id: MERCHANT_ID,
    order_id: orderId,
    payment_id: overrides.payment_id ?? String(320_000_000 + Math.floor(Math.random() * 1e6)),
    payhere_amount: amount,
    payhere_currency: 'LKR',
    status_code: statusCode,
    method: 'VISA',
    status_message: 'Successfully completed the payment.',
    card_holder_name: 'K PERERA',
    card_no: '************1292',
    ...overrides,
  };
  const signed = ['merchant_id', 'order_id', 'payhere_amount', 'payhere_currency', 'status_code']
    .map((key) => fields[key] ?? '')
    .join('');
  fields.md5sig = overrides.md5sig ?? md5U(signed + md5U(MERCHANT_SECRET));
  return fields;
}

function tokenFrom(text: string): string {
  const match = /token=([A-Za-z0-9_-]+)/.exec(text);
  if (!match?.[1]) throw new Error('No token in email');
  return match[1];
}

describe('Plans, subscriptions and billing (integration)', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await createTestContext({
      PAYHERE_MERCHANT_ID: MERCHANT_ID,
      PAYHERE_MERCHANT_SECRET: MERCHANT_SECRET,
      PAYHERE_MODE: 'sandbox',
      BILLING_TAX_RATE_BP: 1_800,
      API_PUBLIC_URL: 'https://api.example.com',
    });
  });
  beforeEach(async () => {
    await resetDatabase(ctx.owner);
    ctx.mailer.sent.length = 0;
  });
  afterAll(async () => {
    await ctx.close();
  });

  async function verifiedOwner() {
    const session = await onboardedTenant(ctx, 'GENERAL_RETAIL');
    const token = tokenFrom(ctx.mailer.lastTo(session.email)!.text);
    await ctx.http.post('/api/v1/auth/email/verify').send({ token }).expect(200);
    return { session, owner: bearer(session.accessToken), tenantId: session.tenant.id as string };
  }
  type Shop = Awaited<ReturnType<typeof verifiedOwner>>;

  async function checkout(s: Shop, planCode = 'GROWTH', interval = 'MONTH') {
    return (
      await ctx.http
        .post('/api/v1/billing/checkout')
        .set(s.owner)
        .send({ planCode, interval })
        .expect(200)
    ).body;
  }

  const notify = (fields: Record<string, string>) =>
    ctx.http.post('/api/v1/billing/webhooks/payhere').type('form').send(fields);

  const subscription = (tenantId: string) =>
    ctx.owner.subscription.findUniqueOrThrow({ where: { tenantId } });

  describe('trial and e-mail verification', () => {
    it('starts every business on a trial and asks the owner to confirm their e-mail', async () => {
      const session = await onboardedTenant(ctx);
      expect(session.subscription).toMatchObject({ status: 'TRIALING', planName: 'Growth' });
      const trialEnds = new Date(session.subscription!.trialEndsAt!).getTime();
      expect(Math.abs(trialEnds - (Date.now() + 14 * DAY))).toBeLessThan(60_000);
      expect(session.user.emailVerified).toBe(false);

      const email = ctx.mailer.lastTo(session.email)!;
      expect(email.subject).toBe('Confirm your email address');
      expect(email.text).toContain(`${ctx.config.WEB_APP_URL}/verify-email?token=`);
      const token = tokenFrom(email.text);
      await ctx.http.post('/api/v1/auth/email/verify').send({ token }).expect(200);
      const reuse = await ctx.http.post('/api/v1/auth/email/verify').send({ token }).expect(400);
      expect(reuse.body.error.code).toBe('INVALID_VERIFICATION_TOKEN');

      const me = await ctx.http.get('/api/v1/auth/me').set(bearer(session.accessToken)).expect(200);
      expect(me.body.user.emailVerified).toBe(true);
      expect(await ctx.owner.auditLog.count({ where: { action: 'auth.email_verified' } })).toBe(1);
    });

    it('resends a link only while unverified', async () => {
      const session = await onboardedTenant(ctx);
      const owner = bearer(session.accessToken);
      await ctx.http.post('/api/v1/auth/email/verification').set(owner).expect(202);
      const links = ctx.mailer.sent.filter((m) => m.subject === 'Confirm your email address');
      expect(links).toHaveLength(2);
      // Only the newest link works.
      expect(
        (
          await ctx.http
            .post('/api/v1/auth/email/verify')
            .send({ token: tokenFrom(links[0]!.text) })
            .expect(400)
        ).body.error.code,
      ).toBe('INVALID_VERIFICATION_TOKEN');
      await ctx.http
        .post('/api/v1/auth/email/verify')
        .send({ token: tokenFrom(links[1]!.text) })
        .expect(200);
      await ctx.http.post('/api/v1/auth/email/verification').set(owner).expect(202);
      expect(
        ctx.mailer.sent.filter((m) => m.subject === 'Confirm your email address'),
      ).toHaveLength(2);
    });

    it('treats an accepted invitation as a verified address', async () => {
      const { owner } = await verifiedOwner();
      const email = uniqueEmail('cashier');
      await ctx.http
        .post('/api/v1/staff/invitations')
        .set(owner)
        .send({ email, role: 'CASHIER' })
        .expect(201);
      const joined = await ctx.http
        .post('/api/v1/auth/invitations/accept')
        .send({
          token: tokenFrom(ctx.mailer.lastTo(email)!.text),
          fullName: 'Kamal Perera',
          password: 'saffron-kite-harbour-9',
        })
        .expect(200);
      expect(joined.body.user.emailVerified).toBe(true);
    });
  });

  describe('overview and checkout', () => {
    it('shows the plan, usage, plans and whether payment is possible', async () => {
      const s = await verifiedOwner();
      const body = (await ctx.http.get('/api/v1/billing').set(s.owner).expect(200)).body;
      expect(body.subscription).toMatchObject({ status: 'TRIALING', plan: { code: 'GROWTH' } });
      expect(body.usage).toEqual({ branches: 1, registers: 1, staff: 1, devices: 0 });
      expect(body.plans.map((p: { code: string }) => p.code)).toEqual([
        'STARTER',
        'GROWTH',
        'BUSINESS',
      ]);
      expect(body.paymentsAvailable).toBe(true);
      expect(body.emailVerified).toBe(true);

      const manager = bearer(
        (await login(ctx, (await addMember(ctx, s.tenantId, 'MANAGER')).email)).accessToken,
      );
      await ctx.http.get('/api/v1/billing').set(manager).expect(403);
    });

    it('requires a confirmed e-mail before paying', async () => {
      const session = await onboardedTenant(ctx);
      const res = await ctx.http
        .post('/api/v1/billing/checkout')
        .set(bearer(session.accessToken))
        .send({ planCode: 'GROWTH' })
        .expect(403);
      expect(res.body.error.code).toBe('EMAIL_NOT_VERIFIED');
    });

    it('opens an invoice with tax and a signed hosted-checkout form', async () => {
      const s = await verifiedOwner();
      const { invoice, redirect } = await checkout(s, 'GROWTH', 'MONTH');
      expect(invoice).toMatchObject({
        status: 'OPEN',
        planName: 'Growth',
        subtotalMinor: 650_000,
        taxRateBp: 1_800,
        taxMinor: 117_000,
        totalMinor: 767_000,
        currency: 'LKR',
      });
      expect(invoice.number).toMatch(/^SUB-\d{6}$/);
      expect(redirect.url).toBe('https://sandbox.payhere.lk/pay/checkout');
      expect(redirect.fields).toMatchObject({
        merchant_id: MERCHANT_ID,
        order_id: invoice.id,
        amount: '7670.00',
        currency: 'LKR',
        email: s.session.email,
        notify_url: 'https://api.example.com/api/v1/billing/webhooks/payhere',
      });
      expect(redirect.fields.hash).toBe(
        md5U(MERCHANT_ID + invoice.id + '7670.00' + 'LKR' + md5U(MERCHANT_SECRET)),
      );
      // The secret itself is never sent to the browser.
      expect(JSON.stringify(redirect)).not.toContain(MERCHANT_SECRET);

      // A second checkout replaces the first unpaid invoice.
      const second = await checkout(s, 'BUSINESS', 'YEAR');
      expect(second.invoice.totalMinor).toBe(17_700_000);
      const rows = await ctx.owner.billingInvoice.findMany({ where: { tenantId: s.tenantId } });
      expect(rows.map((r) => r.status).sort()).toEqual(['OPEN', 'VOID']);
    });

    it('refuses a plan smaller than what the business already uses', async () => {
      const s = await verifiedOwner();
      await ctx.http
        .post('/api/v1/branches')
        .set(s.owner)
        .send({ code: 'KDY', name: 'Kandy' })
        .expect(201);
      const res = await ctx.http
        .post('/api/v1/billing/checkout')
        .set(s.owner)
        .send({ planCode: 'STARTER' })
        .expect(400);
      expect(res.body.error.issues).toEqual([
        { path: 'planCode', message: 'validation.plan.too_many_branches' },
      ]);
    });

    it('reports payments as unavailable when no provider is configured', async () => {
      const plain = await createTestContext();
      try {
        await resetDatabase(plain.owner);
        const session = await onboardedTenant(plain);
        await plain.http
          .post('/api/v1/auth/email/verify')
          .send({ token: tokenFrom(plain.mailer.lastTo(session.email)!.text) })
          .expect(200);
        const res = await plain.http
          .post('/api/v1/billing/checkout')
          .set(bearer(session.accessToken))
          .send({ planCode: 'GROWTH' })
          .expect(503);
        expect(res.body.error.code).toBe('PAYMENTS_UNAVAILABLE');
        expect(
          (await plain.http.get('/api/v1/billing').set(bearer(session.accessToken)).expect(200))
            .body.paymentsAvailable,
        ).toBe(false);
      } finally {
        await plain.close();
      }
    });
  });

  describe('payment notifications', () => {
    it('activates the plan once from a verified notification, keeping trial days', async () => {
      const s = await verifiedOwner();
      const before = await subscription(s.tenantId);
      const { invoice } = await checkout(s);

      // Wrong signature: rejected, nothing changes.
      await notify(notification(invoice.id, '7670.00', '2', { md5sig: 'A'.repeat(32) })).expect(
        400,
      );
      expect((await subscription(s.tenantId)).status).toBe('TRIALING');

      const paid = notification(invoice.id, '7670.00', '2', { payment_id: '320025071278' });
      await notify(paid).expect(200);
      const after = await subscription(s.tenantId);
      expect(after.status).toBe('ACTIVE');
      // Paying during the trial starts the period when the trial ends.
      expect(after.currentPeriodStart).toEqual(before.trialEndsAt);
      expect(after.currentPeriodEnd!.getTime()).toBeGreaterThan(
        before.trialEndsAt!.getTime() + 27 * DAY,
      );

      // The provider retries: applied once.
      await notify(paid).expect(200);
      expect((await subscription(s.tenantId)).currentPeriodEnd).toEqual(after.currentPeriodEnd);
      expect(await ctx.owner.paymentEvent.count({ where: { tenantId: s.tenantId } })).toBe(1);

      const row = await ctx.owner.billingInvoice.findUniqueOrThrow({ where: { id: invoice.id } });
      expect(row).toMatchObject({ status: 'PAID', providerPaymentId: '320025071278' });
      const receipt = ctx.mailer.lastTo(s.session.email)!;
      expect(receipt.subject).toBe(`Payment received – invoice ${invoice.number}`);
      // Card details from the notification are not stored anywhere.
      const event = await ctx.owner.paymentEvent.findFirstOrThrow({
        where: { tenantId: s.tenantId },
      });
      expect(JSON.stringify(event)).not.toContain('1292');
      expect(JSON.stringify(event)).not.toContain('PERERA');
      expect(event.method).toBe('VISA');
    });

    it('ignores pending, failed and wrong-amount notifications', async () => {
      const s = await verifiedOwner();
      const { invoice } = await checkout(s);
      await notify(notification(invoice.id, '7670.00', '0')).expect(200);
      await notify(notification(invoice.id, '7670.00', '-2')).expect(200);
      await notify(notification(invoice.id, '1.00', '2')).expect(200);
      expect((await subscription(s.tenantId)).status).toBe('TRIALING');
      const outcomes = (
        await ctx.owner.paymentEvent.findMany({ where: { tenantId: s.tenantId } })
      ).map((e) => e.outcome);
      expect(outcomes.sort()).toEqual(['FAILED', 'PENDING', 'REJECTED']);
      expect(
        await ctx.owner.auditLog.count({
          where: { tenantId: s.tenantId, action: 'billing.payment_failed' },
        }),
      ).toBe(2);
    });

    it('rejects notifications for unknown orders or another merchant', async () => {
      const s = await verifiedOwner();
      const { invoice } = await checkout(s);
      await notify(notification(randomUUID(), '7670.00', '2')).expect(400);
      const foreign = notification(invoice.id, '7670.00', '2', { merchant_id: '9999999' });
      await notify(foreign).expect(400);
      expect((await subscription(s.tenantId)).status).toBe('TRIALING');
    });

    it('suspends at once on a chargeback', async () => {
      const s = await verifiedOwner();
      const { invoice } = await checkout(s);
      await notify(notification(invoice.id, '7670.00', '2', { payment_id: '1' })).expect(200);
      await notify(notification(invoice.id, '7670.00', '-3', { payment_id: '1' })).expect(200);
      expect((await subscription(s.tenantId)).status).toBe('SUSPENDED');
    });
  });

  describe('plan limits', () => {
    async function onPlan(s: Shop, code: string) {
      const plan = await ctx.owner.plan.findUniqueOrThrow({ where: { code } });
      await ctx.owner.subscription.update({
        where: { tenantId: s.tenantId },
        data: { planId: plan.id },
      });
    }

    it('limits branches and registers, counting restores too', async () => {
      const s = await verifiedOwner();
      await onPlan(s, 'STARTER'); // 1 branch, 2 registers
      const branch = await ctx.http
        .post('/api/v1/branches')
        .set(s.owner)
        .send({ code: 'KDY', name: 'Kandy' })
        .expect(409);
      expect(branch.body.error.code).toBe('PLAN_LIMIT_REACHED');

      const main = (await ctx.http.get('/api/v1/branches').set(s.owner).expect(200)).body.items[0];
      const second = (
        await ctx.http
          .post('/api/v1/registers')
          .set(s.owner)
          .send({ branchId: main.id, code: 'R2', name: 'Register 2' })
          .expect(201)
      ).body;
      await ctx.http
        .post('/api/v1/registers')
        .set(s.owner)
        .send({ branchId: main.id, code: 'R3', name: 'Register 3' })
        .expect(409);
      // Archiving frees a place; restoring takes it back only if it is still free.
      await ctx.http
        .patch(`/api/v1/registers/${second.id}`)
        .set(s.owner)
        .send({ version: second.version, status: 'ARCHIVED' })
        .expect(200);
      const third = (
        await ctx.http
          .post('/api/v1/registers')
          .set(s.owner)
          .send({ branchId: main.id, code: 'R3', name: 'Register 3' })
          .expect(201)
      ).body;
      expect(third.code).toBe('R3');
      await ctx.http
        .patch(`/api/v1/registers/${second.id}`)
        .set(s.owner)
        .send({ version: second.version + 1, status: 'ACTIVE' })
        .expect(409);
    });

    it('lets only as many concurrent additions through as the plan allows', async () => {
      const s = await verifiedOwner(); // Growth: 3 branches, 1 used
      const results = await Promise.all(
        ['A1', 'A2', 'A3', 'A4'].map((code) =>
          ctx.http
            .post('/api/v1/branches')
            .set(s.owner)
            .send({ code, name: `Branch ${code}` }),
        ),
      );
      expect(results.filter((r) => r.status === 201)).toHaveLength(2);
      expect(results.filter((r) => r.status === 409)).toHaveLength(2);
      expect(await ctx.owner.branch.count({ where: { tenantId: s.tenantId } })).toBe(3);
    });

    it('counts pending invitations towards staff, and limits devices', async () => {
      const s = await verifiedOwner();
      await onPlan(s, 'STARTER'); // 5 staff, 2 devices
      for (let i = 0; i < 4; i += 1)
        await ctx.http
          .post('/api/v1/staff/invitations')
          .set(s.owner)
          .send({ email: uniqueEmail(`s${i}`), role: 'CASHIER' })
          .expect(201);
      const full = await ctx.http
        .post('/api/v1/staff/invitations')
        .set(s.owner)
        .send({ email: uniqueEmail('extra'), role: 'CASHIER' })
        .expect(409);
      expect(full.body.error.code).toBe('PLAN_LIMIT_REACHED');

      const register = (await ctx.http.get('/api/v1/branches').set(s.owner).expect(200)).body
        .items[0].registers[0].id;
      for (let i = 0; i < 2; i += 1)
        await ctx.http
          .put(`/api/v1/devices/${randomUUID()}`)
          .set(s.owner)
          .send({ name: `Till ${i}`, registerId: register })
          .expect(200);
      await ctx.http
        .put(`/api/v1/devices/${randomUUID()}`)
        .set(s.owner)
        .send({ name: 'Till 3', registerId: register })
        .expect(409);
    });
  });

  describe('lifecycle', () => {
    const lifecycle = () => ctx.app.get(SubscriptionLifecycle);

    it('reminds once, then past due, then read-only until paid', async () => {
      const s = await verifiedOwner();
      const { trialEndsAt } = await subscription(s.tenantId);
      const trialEnd = trialEndsAt!.getTime();

      // Too early for a reminder.
      expect(await lifecycle().run(new Date(trialEnd - 5 * DAY))).toEqual({
        transitioned: 0,
        reminded: 0,
      });
      expect(await lifecycle().run(new Date(trialEnd - 2 * DAY))).toEqual({
        transitioned: 0,
        reminded: 1,
      });
      expect(await lifecycle().run(new Date(trialEnd - DAY))).toEqual({
        transitioned: 0,
        reminded: 0,
      });
      expect(ctx.mailer.lastTo(s.session.email)!.subject).toBe('Your free trial ends in 2 days');

      await lifecycle().run(new Date(trialEnd + 3_600_000));
      const pastDue = await subscription(s.tenantId);
      expect(pastDue.status).toBe('PAST_DUE');
      expect(pastDue.graceEndsAt).toEqual(new Date(trialEnd + 7 * DAY));
      // Still fully usable during the grace period.
      await ctx.http
        .post('/api/v1/branches')
        .set(s.owner)
        .send({ code: 'KDY', name: 'Kandy' })
        .expect(201);

      await lifecycle().run(new Date(trialEnd + 7 * DAY + 3_600_000));
      expect((await subscription(s.tenantId)).status).toBe('SUSPENDED');
      expect(ctx.mailer.lastTo(s.session.email)!.subject).toContain('is now read-only');

      // Read-only: reading works, changes are refused, billing still works.
      await ctx.http.get('/api/v1/branches').set(s.owner).expect(200);
      await ctx.http.get('/api/v1/reports/sales').set(s.owner).expect(200);
      const refused = await ctx.http
        .post('/api/v1/branches')
        .set(s.owner)
        .send({ code: 'GLE', name: 'Galle' })
        .expect(402);
      expect(refused.body.error.code).toBe('SUBSCRIPTION_INACTIVE');
      const me = await ctx.http.get('/api/v1/auth/me').set(s.owner).expect(200);
      expect(me.body.subscription.status).toBe('SUSPENDED');

      const { invoice } = await checkout(s);
      await notify(notification(invoice.id, '7670.00', '2')).expect(200);
      const active = await subscription(s.tenantId);
      expect(active.status).toBe('ACTIVE');
      // Paid after the trial ended: the period starts now.
      expect(Math.abs(active.currentPeriodStart!.getTime() - Date.now())).toBeLessThan(60_000);
      await ctx.http
        .post('/api/v1/branches')
        .set(s.owner)
        .send({ code: 'GLE', name: 'Galle' })
        .expect(201);
      expect(
        (
          await ctx.owner.auditLog.findMany({
            where: { tenantId: s.tenantId, action: { startsWith: 'subscription.' } },
          })
        ).map((a) => a.action),
      ).toEqual(expect.arrayContaining(['subscription.past_due', 'subscription.suspended']));
    });

    it('ends at the period end when the owner cancels, without renewal reminders', async () => {
      const s = await verifiedOwner();
      const { invoice } = await checkout(s);
      await notify(notification(invoice.id, '7670.00', '2')).expect(200);
      const sub = await subscription(s.tenantId);

      const cancelled = await ctx.http
        .post('/api/v1/billing/cancel')
        .set(s.owner)
        .send({ version: sub.version })
        .expect(200);
      expect(cancelled.body.cancelAtPeriodEnd).toBe(true);
      await ctx.http
        .post('/api/v1/billing/resume')
        .set(s.owner)
        .send({ version: sub.version })
        .expect(409);

      ctx.mailer.sent.length = 0;
      const end = sub.currentPeriodEnd!.getTime();
      expect((await lifecycle().run(new Date(end - 2 * DAY))).reminded).toBe(0);
      await lifecycle().run(new Date(end + 1000));
      expect((await subscription(s.tenantId)).status).toBe('CANCELLED');
      expect(ctx.mailer.lastTo(s.session.email)!.subject).toContain('subscription has ended');
      await ctx.http
        .post('/api/v1/branches')
        .set(s.owner)
        .send({ code: 'KDY', name: 'Kandy' })
        .expect(402);
    });

    it('lets offline tills retry later instead of losing sales while read-only', async () => {
      const s = await verifiedOwner();
      await ctx.owner.subscription.update({
        where: { tenantId: s.tenantId },
        data: { status: 'SUSPENDED' },
      });
      const res = await ctx.http
        .post('/api/v1/sales')
        .set(s.owner)
        .send({ id: randomUUID() })
        .expect(402);
      expect(res.body.error.code).toBe('SUBSCRIPTION_INACTIVE');
    });
  });

  describe('isolation', () => {
    it('keeps invoices and subscriptions to their business', async () => {
      const a = await verifiedOwner();
      const b = await verifiedOwner();
      await checkout(a);
      const overview = (await ctx.http.get('/api/v1/billing').set(b.owner).expect(200)).body;
      expect(overview.invoices).toHaveLength(0);
      // Row-level security hides other businesses' rows from the application role.
      const visible = await ctx.prisma.withTenant(b.tenantId, (tx) =>
        tx.billingInvoice.findMany({}),
      );
      expect(visible).toHaveLength(0);
      const subs = await ctx.prisma.withTenant(b.tenantId, (tx) => tx.subscription.findMany({}));
      expect(subs.map((x) => x.tenantId)).toEqual([b.tenantId]);
    });
  });
});
