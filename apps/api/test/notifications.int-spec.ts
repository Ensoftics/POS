import { randomUUID } from 'node:crypto';
import { DailySweep } from '../src/notifications/daily-sweep.service';
import { SubscriptionLifecycle } from '../src/billing/lifecycle.service';
import {
  addMember,
  bearer,
  createTestContext,
  login,
  onboardedTenant,
  resetDatabase,
  type TestContext,
} from './helpers';

const DAY = 86_400_000;
/** The business date in Colombo (the default time zone) for an instant. */
const colomboDate = (at: Date) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Colombo' }).format(at);
const addDays = (isoDate: string, days: number) =>
  new Date(Date.parse(`${isoDate}T00:00:00Z`) + days * DAY).toISOString().slice(0, 10);
/** 08:30 in Colombo on a business date (after the 07:00 digest hour). */
const morningOf = (isoDate: string) => new Date(`${isoDate}T03:00:00Z`);

describe('Notifications and feature flags (integration)', () => {
  let ctx: TestContext;
  const sweep = () => ctx.app.get(DailySweep);

  beforeAll(async () => {
    ctx = await createTestContext();
  });
  beforeEach(async () => {
    await resetDatabase(ctx.owner);
    await ctx.owner.featureFlag.updateMany({ data: { defaultEnabled: true } });
    ctx.mailer.sent.length = 0;
  });
  afterAll(async () => {
    await ctx.close();
  });

  /** A cosmetics shop: one cream, reorder level 5, 2 in stock in a batch expiring in 10 days. */
  async function cosmeticsShop() {
    const session = await onboardedTenant(ctx, 'COSMETICS');
    const owner = bearer(session.accessToken);
    const tenantId = session.tenant.id as string;
    const branch = (await ctx.http.get('/api/v1/branches').set(owner).expect(200)).body.items[0];
    const product = (
      await ctx.http
        .post('/api/v1/products')
        .set(owner)
        .send({
          name: 'Face Cream',
          unit: 'piece',
          variants: [{ sku: 'CREAM', priceMinor: 150_000, reorderLevel: '5' }],
        })
        .expect(201)
    ).body;
    const today = colomboDate(new Date());
    await ctx.http
      .post('/api/v1/goods-receipts')
      .set(owner)
      .send({
        id: randomUUID(),
        branchId: branch.id,
        lines: [
          {
            variantId: product.variants[0].id,
            quantity: '2',
            unitCostMinor: 50_000,
            batchNumber: 'B1',
            expiryDate: addDays(today, 10),
          },
        ],
      })
      .expect(201);
    return { session, owner, tenantId, branchId: branch.id as string, today };
  }

  const inbox = async (auth: { Authorization: string }) =>
    (await ctx.http.get('/api/v1/notifications').set(auth).expect(200)).body.items as Array<{
      id: string;
      kind: string;
      data: Record<string, unknown>;
      link: string | null;
      readAt: string | null;
    }>;

  describe('daily stock alerts and digest', () => {
    it('alerts the people who handle stock once a day, after 07:00 local time', async () => {
      const s = await cosmeticsShop();
      const cashier = bearer(
        (await login(ctx, (await addMember(ctx, s.tenantId, 'CASHIER')).email)).accessToken,
      );
      const tomorrow = addDays(s.today, 1);

      // 06:00 in Colombo: too early.
      expect(await sweep().run(new Date(`${tomorrow}T00:30:00Z`))).toEqual({
        businesses: 0,
        notifications: 0,
      });
      const first = await sweep().run(morningOf(tomorrow));
      expect(first.businesses).toBe(1);

      const [alert] = await inbox(s.owner);
      expect(alert).toMatchObject({
        kind: 'INVENTORY_ALERT',
        link: `/inventory?branch=${s.branchId}&filter=LOW`,
        readAt: null,
        data: expect.objectContaining({
          branchName: 'Main branch',
          low: 1,
          expiring: 1,
          lowExamples: ['Face Cream'],
          date: tomorrow,
        }),
      });
      // Cashiers see stock too; no sales yesterday, so no summary for anyone.
      expect((await inbox(cashier)).map((n) => n.kind)).toEqual(['INVENTORY_ALERT']);

      const digest = ctx.mailer.lastTo(s.session.email)!;
      expect(digest.subject).toBe(`${s.session.tenant.name}: your morning summary`);
      expect(digest.text).toContain(
        'Main branch: 1 item(s) low on stock, 1 expiring within 30 days.',
      );

      // Running again the same day changes nothing.
      ctx.mailer.sent.length = 0;
      expect(await sweep().run(new Date(morningOf(tomorrow).getTime() + 3_600_000))).toEqual({
        businesses: 0,
        notifications: 0,
      });
      expect(ctx.mailer.sent).toHaveLength(0);
      expect(await inbox(s.owner)).toHaveLength(1);
    });

    it('sends yesterday’s sales to managers, respecting flags and e-mail choices', async () => {
      const session = await onboardedTenant(ctx, 'GENERAL_RETAIL');
      const owner = bearer(session.accessToken);
      const tenantId = session.tenant.id as string;
      const branch = (await ctx.http.get('/api/v1/branches').set(owner).expect(200)).body.items[0];
      const product = (
        await ctx.http
          .post('/api/v1/products')
          .set(owner)
          .send({
            name: 'Rice 5kg',
            unit: 'piece',
            variants: [{ sku: 'RICE', priceMinor: 60_000 }],
          })
          .expect(201)
      ).body;
      await ctx.http
        .post('/api/v1/goods-receipts')
        .set(owner)
        .send({
          id: randomUUID(),
          branchId: branch.id,
          lines: [{ variantId: product.variants[0].id, quantity: '10', unitCostMinor: 1 }],
        })
        .expect(201);
      const shift = (
        await ctx.http
          .post('/api/v1/shifts')
          .set(owner)
          .send({ registerId: branch.registers[0].id, openingFloatMinor: 0 })
          .expect(201)
      ).body;
      await ctx.http
        .post('/api/v1/sales')
        .set(owner)
        .send({
          id: randomUUID(),
          shiftId: shift.id,
          lines: [{ variantId: product.variants[0].id, quantity: '2' }],
          payments: [{ method: 'CASH', amountMinor: 120_000 }],
          expectedTotalMinor: 120_000,
        })
        .expect(201);
      const managerEmail = (await addMember(ctx, tenantId, 'MANAGER')).email;
      const manager = bearer((await login(ctx, managerEmail)).accessToken);
      // The manager does not want e-mails.
      await ctx.http
        .put('/api/v1/me/notification-preferences')
        .set(manager)
        .send({ emailDigest: false })
        .expect(200);

      const today = colomboDate(new Date());
      await sweep().run(morningOf(addDays(today, 1)));
      for (const auth of [owner, manager]) {
        const [summary] = await inbox(auth);
        expect(summary).toMatchObject({
          kind: 'DAILY_SUMMARY',
          link: '/reports',
          data: {
            date: today,
            salesMinor: 120_000,
            saleCount: 1,
            refundsMinor: 0,
            currency: 'LKR',
          },
        });
      }
      expect(ctx.mailer.lastTo(session.email)!.text).toContain(
        `Yesterday (${today}): LKR 1,200.00 from 1 sale(s).`,
      );
      expect(ctx.mailer.lastTo(managerEmail)).toBeUndefined();

      // Switching the summary off for this business stops it the next day.
      await ctx.owner.tenantFeatureFlag.create({
        data: { tenantId, flagKey: 'notifications.daily_summary', enabled: false },
      });
      await sweep().run(morningOf(addDays(today, 2)));
      expect((await inbox(owner)).filter((n) => n.kind === 'DAILY_SUMMARY')).toHaveLength(1);
    });

    it('keeps alerts to the branches a person works at and stops e-mail by flag', async () => {
      const s = await cosmeticsShop();
      const other = (
        await ctx.http
          .post('/api/v1/branches')
          .set(s.owner)
          .send({ code: 'KDY', name: 'Kandy' })
          .expect(201)
      ).body;
      const { email } = await addMember(ctx, s.tenantId, 'INVENTORY_STAFF');
      const membership = await ctx.owner.membership.findFirstOrThrow({
        where: { tenantId: s.tenantId, user: { email } },
      });
      await ctx.owner.membershipBranch.create({
        data: { tenantId: s.tenantId, membershipId: membership.id, branchId: other.id },
      });
      const staff = bearer((await login(ctx, email)).accessToken);
      await ctx.owner.featureFlag.update({
        where: { key: 'notifications.email' },
        data: { defaultEnabled: false },
      });

      await sweep().run(morningOf(addDays(s.today, 1)));
      // The cream is low in both branches (none at Kandy); staff only hear about Kandy.
      expect((await inbox(staff)).map((n) => n.data.branchName)).toEqual(['Kandy']);
      expect((await inbox(s.owner)).map((n) => n.data.branchName).sort()).toEqual([
        'Kandy',
        'Main branch',
      ]);
      expect(
        ctx.mailer.sent.filter((m) => m.subject.endsWith('your morning summary')),
      ).toHaveLength(0);
    });

    it('removes notifications older than 90 days', async () => {
      const s = await cosmeticsShop();
      const user = await ctx.owner.user.findUniqueOrThrow({ where: { email: s.session.email } });
      await ctx.owner.notification.create({
        data: {
          tenantId: s.tenantId,
          userId: user.id,
          kind: 'INVENTORY_ALERT',
          dedupeKey: 'old',
          data: {},
          createdAt: new Date(Date.now() - 91 * DAY),
        },
      });
      await sweep().run(new Date());
      expect(await ctx.owner.notification.count({ where: { dedupeKey: 'old' } })).toBe(0);
    });
  });

  describe('inbox', () => {
    it('lists, counts and marks a person’s own notifications only', async () => {
      const s = await cosmeticsShop();
      await sweep().run(morningOf(addDays(s.today, 1)));
      const managerEmail = (await addMember(ctx, s.tenantId, 'MANAGER')).email;
      const manager = bearer((await login(ctx, managerEmail)).accessToken);
      const [mine] = await inbox(s.owner);

      const count = (auth: { Authorization: string }) =>
        ctx.http.get('/api/v1/notifications/unread-count').set(auth).expect(200);
      expect((await count(s.owner)).body).toEqual({ unread: 1 });
      // Someone else's notification is not found.
      await ctx.http.post(`/api/v1/notifications/${mine!.id}/read`).set(manager).expect(404);
      const read = await ctx.http
        .post(`/api/v1/notifications/${mine!.id}/read`)
        .set(s.owner)
        .expect(200);
      expect(read.body.readAt).not.toBeNull();
      expect((await count(s.owner)).body).toEqual({ unread: 0 });
      expect(
        (await ctx.http.get('/api/v1/notifications?unreadOnly=true').set(s.owner).expect(200)).body
          .items,
      ).toHaveLength(0);
      await ctx.http.post('/api/v1/notifications/read-all').set(manager).expect(200);
      expect(
        (await ctx.http.get('/api/v1/me/notification-preferences').set(s.owner).expect(200)).body,
      ).toEqual({ emailDigest: true });
    });

    it('tells owners when the subscription becomes due', async () => {
      const s = await cosmeticsShop();
      const sub = await ctx.owner.subscription.findUniqueOrThrow({
        where: { tenantId: s.tenantId },
      });
      await ctx.app.get(SubscriptionLifecycle).run(new Date(sub.trialEndsAt!.getTime() + 60_000));
      const notes = await inbox(s.owner);
      expect(notes.find((n) => n.kind === 'SUBSCRIPTION')).toMatchObject({
        link: '/settings/billing',
        data: expect.objectContaining({ status: 'PAST_DUE' }),
      });
    });

    it('asks reviewers to look at offline sales that need attention', async () => {
      const session = await onboardedTenant(ctx, 'GENERAL_RETAIL');
      const owner = bearer(session.accessToken);
      const tenantId = session.tenant.id as string;
      const branch = (await ctx.http.get('/api/v1/branches').set(owner).expect(200)).body.items[0];
      const product = (
        await ctx.http
          .post('/api/v1/products')
          .set(owner)
          .send({ name: 'Blue Pen', unit: 'piece', variants: [{ sku: 'PEN', priceMinor: 10_000 }] })
          .expect(201)
      ).body;
      const variant = product.variants[0];
      const cashier = bearer(
        (await login(ctx, (await addMember(ctx, tenantId, 'CASHIER')).email)).accessToken,
      );
      const shift = (
        await ctx.http
          .post('/api/v1/shifts')
          .set(cashier)
          .send({ registerId: branch.registers[0].id, openingFloatMinor: 0 })
          .expect(201)
      ).body;
      // No stock was received, so the offline sale is short of stock.
      const sale = (
        await ctx.http
          .post('/api/v1/sales')
          .set(cashier)
          .send({
            id: randomUUID(),
            shiftId: shift.id,
            lines: [{ variantId: variant.id, quantity: '1' }],
            payments: [{ method: 'CASH', amountMinor: 10_000 }],
            expectedTotalMinor: 10_000,
            offline: {
              capturedAt: new Date(Date.now() - 3_600_000).toISOString(),
              pricesIncludeTax: true,
              lines: [{ unitPriceMinor: 10_000, taxRateBp: 0 }],
            },
          })
          .expect(201)
      ).body;
      expect(sale.conflicts.length).toBeGreaterThan(0);
      const [note] = await inbox(owner);
      expect(note).toMatchObject({
        kind: 'SALE_CONFLICT',
        link: '/sales/review',
        data: expect.objectContaining({ saleNumber: sale.number }),
      });
      // Cashiers do not review conflicts.
      expect(await inbox(cashier)).toHaveLength(0);
    });
  });

  describe('feature flags', () => {
    it('reports a business’s flags in its session', async () => {
      const session = await onboardedTenant(ctx);
      const me = async () =>
        (await ctx.http.get('/api/v1/auth/me').set(bearer(session.accessToken)).expect(200)).body
          .features;
      expect((await me()).sort()).toEqual([
        'loyalty',
        'messaging',
        'notifications.daily_summary',
        'notifications.email',
      ]);
      await ctx.owner.tenantFeatureFlag.create({
        data: { tenantId: session.tenant.id, flagKey: 'notifications.email', enabled: false },
      });
      expect((await me()).sort()).toEqual(['loyalty', 'messaging', 'notifications.daily_summary']);
    });
  });
});
