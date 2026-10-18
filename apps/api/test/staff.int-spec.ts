import { randomUUID } from 'node:crypto';
import {
  addMember,
  bearer,
  createTestContext,
  login,
  onboardedTenant,
  registerTenant,
  resetDatabase,
  STRONG_PASSWORD,
  type TestContext,
  uniqueEmail,
} from './helpers';

const NEW_PASSWORD = 'saffron-kite-harbour-9';

function tokenFrom(text: string): string {
  const match = /token=([A-Za-z0-9_-]+)/.exec(text);
  if (!match?.[1]) throw new Error('No invitation token in email');
  return match[1];
}

describe('Staff, branch restrictions and devices (integration)', () => {
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

  /** A business with two branches (A: default, B: added), each with a register. */
  async function business() {
    const session = await onboardedTenant(ctx, 'GENERAL_RETAIL');
    const owner = bearer(session.accessToken);
    const tenantId = session.tenant.id as string;
    const branchA = (await ctx.http.get('/api/v1/branches').set(owner).expect(200)).body.items[0];
    const branchB = (
      await ctx.http
        .post('/api/v1/branches')
        .set(owner)
        .send({ code: 'KDY', name: 'Kandy' })
        .expect(201)
    ).body;
    const registerB = (
      await ctx.http
        .post('/api/v1/registers')
        .set(owner)
        .send({ branchId: branchB.id, code: 'T1', name: 'Till 1' })
        .expect(201)
    ).body;
    return {
      session,
      owner,
      tenantId,
      branchA: { id: branchA.id as string, registerId: branchA.registers[0].id as string },
      branchB: { id: branchB.id as string, registerId: registerB.id as string },
    };
  }
  type Business = Awaited<ReturnType<typeof business>>;

  async function invite(b: Business, body: Record<string, unknown>, as = b.owner) {
    const email = (body.email as string | undefined) ?? uniqueEmail('staff');
    const res = await ctx.http
      .post('/api/v1/staff/invitations')
      .set(as)
      .send({ email, ...body })
      .expect(201);
    const token = tokenFrom(ctx.mailer.lastTo(email)!.text);
    return { email, token, invitation: res.body };
  }

  function accept(token: string, body: Record<string, unknown> = {}) {
    return ctx.http.post('/api/v1/auth/invitations/accept').send({
      token,
      fullName: 'Kamal Fernando',
      password: NEW_PASSWORD,
      clientType: 'MOBILE',
      ...body,
    });
  }

  async function staffRow(b: Business, email: string) {
    const list = (await ctx.http.get('/api/v1/staff').set(b.owner).expect(200)).body;
    return list.members.find((m: { email: string }) => m.email === email);
  }

  describe('invitations', () => {
    it('invites a new person who joins with a branch restriction and signs in', async () => {
      const b = await business();
      const { email, token, invitation } = await invite(b, {
        role: 'CASHIER',
        branchIds: [b.branchB.id],
      });
      expect(invitation).toMatchObject({
        email,
        role: 'CASHIER',
        branchIds: [b.branchB.id],
        expired: false,
      });
      const mail = ctx.mailer.lastTo(email)!;
      expect(mail.text).toContain(`${ctx.config.WEB_APP_URL}/accept-invite?token=`);
      expect(mail.subject).toContain(b.session.tenant.name);

      const preview = await ctx.http
        .post('/api/v1/auth/invitations/preview')
        .send({ token })
        .expect(200);
      expect(preview.body).toEqual({
        businessName: b.session.tenant.name,
        email,
        role: 'CASHIER',
        existingAccount: false,
      });

      const joined = await accept(token).expect(200);
      expect(joined.body.role).toBe('CASHIER');
      expect(joined.body.accessToken).toEqual(expect.any(String));
      // The invitation is now used up.
      expect((await accept(token).expect(400)).body.error.code).toBe('INVITATION_INVALID');
      expect(
        (await ctx.http.post('/api/v1/auth/invitations/preview').send({ token }).expect(400)).body
          .error.code,
      ).toBe('INVITATION_INVALID');

      // The new member signs in normally afterwards.
      await ctx.http
        .post('/api/v1/auth/login')
        .send({ email, password: NEW_PASSWORD, clientType: 'WEB' })
        .expect(200);

      const row = await staffRow(b, email);
      expect(row).toMatchObject({
        role: 'CASHIER',
        status: 'ACTIVE',
        branchIds: [b.branchB.id],
        manageable: true,
      });
      const list = (await ctx.http.get('/api/v1/staff').set(b.owner).expect(200)).body;
      expect(list.invitations).toHaveLength(0);

      // Audit trail records the invitation and the join, never the e-mail address.
      const audit = await ctx.owner.auditLog.findMany({
        where: { tenantId: b.tenantId, action: { in: ['staff.invited', 'staff.joined'] } },
      });
      expect(audit.map((a) => a.action).sort()).toEqual(['staff.invited', 'staff.joined']);
      expect(JSON.stringify(audit)).not.toContain(email);
    });

    it('lets an existing account join with its own password', async () => {
      const b = await business();
      const other = await registerTenant(ctx, { businessName: 'Other Shop' });
      const { token } = await invite(b, { email: other.email, role: 'MANAGER' });
      const preview = await ctx.http
        .post('/api/v1/auth/invitations/preview')
        .send({ token })
        .expect(200);
      expect(preview.body.existingAccount).toBe(true);

      expect(
        (await accept(token, { password: 'wrong-password-123' }).expect(401)).body.error.code,
      ).toBe('INVALID_CREDENTIALS');
      const joined = await accept(token, { password: STRONG_PASSWORD, fullName: undefined }).expect(
        200,
      );
      expect(joined.body.tenant.id).toBe(b.tenantId);
      expect(joined.body.role).toBe('MANAGER');
      // The person now chooses between two businesses at sign-in.
      const choice = await ctx.http
        .post('/api/v1/auth/login')
        .send({ email: other.email, password: STRONG_PASSWORD, clientType: 'WEB' })
        .expect(200);
      expect(choice.body.tenants).toHaveLength(2);
    });

    it('checks a new account’s name and password against the policy', async () => {
      const b = await business();
      const { token } = await invite(b, { role: 'CASHIER' });
      const weak = (await accept(token, { password: 'short', fullName: undefined }).expect(400))
        .body.error;
      expect(weak.issues).toEqual(
        expect.arrayContaining([
          { path: 'fullName', message: 'validation.required' },
          { path: 'password', message: 'validation.password.too_short' },
        ]),
      );
      // A failed attempt does not use up the link.
      await accept(token).expect(200);
    });

    it('rejects unknown, revoked and expired links the same way', async () => {
      const b = await business();
      expect((await accept('x'.repeat(43)).expect(400)).body.error.code).toBe('INVITATION_INVALID');

      const first = await invite(b, { role: 'CASHIER' });
      // Inviting the same address again replaces the earlier link.
      const second = await invite(b, { email: first.email, role: 'INVENTORY_STAFF' });
      expect((await accept(first.token).expect(400)).body.error.code).toBe('INVITATION_INVALID');

      await ctx.http
        .post(`/api/v1/staff/invitations/${second.invitation.id}/revoke`)
        .set(b.owner)
        .expect(204);
      expect((await accept(second.token).expect(400)).body.error.code).toBe('INVITATION_INVALID');

      const third = await invite(b, { role: 'CASHIER' });
      await ctx.owner.invitation.update({
        where: { id: third.invitation.id },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });
      expect((await accept(third.token).expect(400)).body.error.code).toBe('INVITATION_INVALID');
    });

    it('refuses to invite someone who is already a member', async () => {
      const b = await business();
      const res = await ctx.http
        .post('/api/v1/staff/invitations')
        .set(b.owner)
        .send({ email: b.session.email, role: 'CASHIER' })
        .expect(409);
      expect(res.body.error.code).toBe('ALREADY_MEMBER');
    });

    it('lets managers invite only cashiers and inventory staff', async () => {
      const b = await business();
      const manager = bearer(
        (await login(ctx, (await addMember(ctx, b.tenantId, 'MANAGER')).email)).accessToken,
      );
      for (const role of ['OWNER', 'MANAGER']) {
        const res = await ctx.http
          .post('/api/v1/staff/invitations')
          .set(manager)
          .send({ email: uniqueEmail(), role })
          .expect(403);
        expect(res.body.error.code).toBe('ROLE_NOT_ALLOWED');
      }
      await invite(b, { role: 'CASHIER' }, manager);
      await invite(b, { role: 'INVENTORY_STAFF' }, manager);

      const cashier = bearer(
        (await login(ctx, (await addMember(ctx, b.tenantId, 'CASHIER')).email)).accessToken,
      );
      await ctx.http.get('/api/v1/staff').set(cashier).expect(403);
    });

    it('rejects branches of another business', async () => {
      const b = await business();
      const other = await business();
      const res = await ctx.http
        .post('/api/v1/staff/invitations')
        .set(b.owner)
        .send({ email: uniqueEmail(), role: 'CASHIER', branchIds: [other.branchA.id] })
        .expect(400);
      expect(res.body.error.issues).toEqual([
        { path: 'branchIds', message: 'validation.branch.not_found' },
      ]);
    });
  });

  describe('changing access', () => {
    it('changes a role and signs the member out everywhere', async () => {
      const b = await business();
      const { email } = await addMember(ctx, b.tenantId, 'CASHIER');
      const cashier = bearer((await login(ctx, email)).accessToken);
      await ctx.http.get('/api/v1/tenant').set(cashier).expect(200);

      const row = await staffRow(b, email);
      const updated = await ctx.http
        .patch(`/api/v1/staff/${row.membershipId}`)
        .set(b.owner)
        .send({ version: row.version, role: 'INVENTORY_STAFF' })
        .expect(200);
      expect(updated.body).toMatchObject({ role: 'INVENTORY_STAFF', version: row.version + 1 });
      await ctx.http.get('/api/v1/tenant').set(cashier).expect(401);

      // A stale version is refused.
      const stale = await ctx.http
        .patch(`/api/v1/staff/${row.membershipId}`)
        .set(b.owner)
        .send({ version: row.version, role: 'CASHIER' })
        .expect(409);
      expect(stale.body.error.code).toBe('VERSION_CONFLICT');
      expect(
        await ctx.owner.auditLog.count({
          where: { tenantId: b.tenantId, action: 'staff.role_changed' },
        }),
      ).toBe(1);
    });

    it('disables a member at once and can enable them again', async () => {
      const b = await business();
      const { email } = await addMember(ctx, b.tenantId, 'CASHIER');
      const cashier = bearer((await login(ctx, email)).accessToken);
      const row = await staffRow(b, email);
      await ctx.http
        .patch(`/api/v1/staff/${row.membershipId}`)
        .set(b.owner)
        .send({ version: row.version, status: 'DISABLED' })
        .expect(200);
      await ctx.http.get('/api/v1/tenant').set(cashier).expect(401);
      await ctx.http
        .post('/api/v1/auth/login')
        .send({ email, password: STRONG_PASSWORD, clientType: 'WEB' })
        .expect((res) => expect(res.status).not.toBe(200));

      await ctx.http
        .patch(`/api/v1/staff/${row.membershipId}`)
        .set(b.owner)
        .send({ version: row.version + 1, status: 'ACTIVE' })
        .expect(200);
      await login(ctx, email);
    });

    it('stops people changing themselves or anyone at or above their level', async () => {
      const b = await business();
      const self = await staffRow(b, b.session.email);
      expect(self).toMatchObject({ isSelf: true, manageable: false });
      const own = await ctx.http
        .patch(`/api/v1/staff/${self.membershipId}`)
        .set(b.owner)
        .send({ version: self.version, role: 'MANAGER' })
        .expect(403);
      expect(own.body.error.code).toBe('ROLE_NOT_ALLOWED');

      const { email: managerEmail } = await addMember(ctx, b.tenantId, 'MANAGER');
      const manager = bearer((await login(ctx, managerEmail)).accessToken);
      const { email: otherManager } = await addMember(ctx, b.tenantId, 'MANAGER');
      const { email: cashierEmail } = await addMember(ctx, b.tenantId, 'CASHIER');
      for (const target of [b.session.email, otherManager]) {
        const row = await staffRow(b, target);
        const res = await ctx.http
          .patch(`/api/v1/staff/${row.membershipId}`)
          .set(manager)
          .send({ version: row.version, status: 'DISABLED' })
          .expect(403);
        expect(res.body.error.code).toBe('ROLE_NOT_ALLOWED');
      }
      // Nor can a manager promote a cashier to manager.
      const cashierRow = await staffRow(b, cashierEmail);
      await ctx.http
        .patch(`/api/v1/staff/${cashierRow.membershipId}`)
        .set(manager)
        .send({ version: cashierRow.version, role: 'MANAGER' })
        .expect(403);
      await ctx.http
        .patch(`/api/v1/staff/${cashierRow.membershipId}`)
        .set(manager)
        .send({ version: cashierRow.version, role: 'INVENTORY_STAFF' })
        .expect(200);
    });

    it('lets one owner remove another but keeps an owner', async () => {
      const b = await business();
      const { email } = await addMember(ctx, b.tenantId, 'OWNER');
      const row = await staffRow(b, email);
      await ctx.http
        .patch(`/api/v1/staff/${row.membershipId}`)
        .set(b.owner)
        .send({ version: row.version, role: 'MANAGER' })
        .expect(200);
      const owners = await ctx.owner.membership.count({
        where: { tenantId: b.tenantId, role: 'OWNER', status: 'ACTIVE' },
      });
      expect(owners).toBe(1);
    });

    it('cannot see or change another business’s staff', async () => {
      const a = await business();
      const b = await business();
      const row = await staffRow(a, a.session.email);
      await ctx.http
        .patch(`/api/v1/staff/${row.membershipId}`)
        .set(b.owner)
        .send({ version: row.version, status: 'DISABLED' })
        .expect(404);
      const list = (await ctx.http.get('/api/v1/staff').set(b.owner).expect(200)).body;
      expect(list.members.map((m: { email: string }) => m.email)).toEqual([b.session.email]);
    });
  });

  describe('branch restrictions', () => {
    async function restricted(
      b: Business,
      role: 'CASHIER' | 'MANAGER' | 'INVENTORY_STAFF',
      branchIds: string[],
    ) {
      const { email } = await addMember(ctx, b.tenantId, role);
      const row = await staffRow(b, email);
      await ctx.http
        .patch(`/api/v1/staff/${row.membershipId}`)
        .set(b.owner)
        .send({ version: row.version, branchIds })
        .expect(200);
      return bearer((await login(ctx, email)).accessToken);
    }

    it('limits a cashier to their branch for shifts, stock and the branch list', async () => {
      const b = await business();
      const cashier = await restricted(b, 'CASHIER', [b.branchB.id]);

      const branches = (await ctx.http.get('/api/v1/branches').set(cashier).expect(200)).body.items;
      expect(branches.map((x: { id: string }) => x.id)).toEqual([b.branchB.id]);

      const denied = await ctx.http
        .post('/api/v1/shifts')
        .set(cashier)
        .send({ registerId: b.branchA.registerId, openingFloatMinor: 0 })
        .expect(403);
      expect(denied.body.error.code).toBe('BRANCH_NOT_ALLOWED');
      await ctx.http
        .post('/api/v1/shifts')
        .set(cashier)
        .send({ registerId: b.branchB.registerId, openingFloatMinor: 0 })
        .expect(201);

      await ctx.http.get(`/api/v1/stock?branchId=${b.branchA.id}`).set(cashier).expect(403);
      await ctx.http.get(`/api/v1/stock?branchId=${b.branchB.id}`).set(cashier).expect(200);
    });

    it('limits inventory staff to their branch but lets them send stock elsewhere', async () => {
      const b = await business();
      const product = (
        await ctx.http
          .post('/api/v1/products')
          .set(b.owner)
          .send({ name: 'Soap', unit: 'piece', variants: [{ sku: 'SOAP', priceMinor: 20_000 }] })
          .expect(201)
      ).body;
      const variantId = product.variants[0].id as string;
      const staff = await restricted(b, 'INVENTORY_STAFF', [b.branchA.id]);

      const receive = (branchId: string) =>
        ctx.http
          .post('/api/v1/goods-receipts')
          .set(staff)
          .send({
            id: randomUUID(),
            branchId,
            lines: [{ variantId, quantity: '5', unitCostMinor: 100 }],
          });
      expect((await receive(b.branchB.id).expect(403)).body.error.code).toBe('BRANCH_NOT_ALLOWED');
      await receive(b.branchA.id).expect(201);

      const transfer = (
        await ctx.http
          .post('/api/v1/stock-transfers')
          .set(staff)
          .send({
            id: randomUUID(),
            fromBranchId: b.branchA.id,
            toBranchId: b.branchB.id,
            lines: [{ variantId, quantity: '2' }],
          })
          .expect(201)
      ).body;
      // Receiving happens at the destination, which this person cannot work at.
      await ctx.http
        .post(`/api/v1/stock-transfers/${transfer.id}/receive`)
        .set(staff)
        .send({ version: transfer.version })
        .expect(403);
      await ctx.http
        .post(`/api/v1/stock-transfers/${transfer.id}/receive`)
        .set(b.owner)
        .send({ version: transfer.version })
        .expect(200);

      const movements = (await ctx.http.get('/api/v1/stock/movements').set(staff).expect(200)).body
        .items;
      expect(movements.length).toBeGreaterThan(0);
      expect(movements.every((m: { branchId: string }) => m.branchId === b.branchA.id)).toBe(true);
    });

    it('shows managers only their branches’ shifts and sales', async () => {
      const b = await business();
      const manager = await restricted(b, 'MANAGER', [b.branchB.id]);
      const shiftA = (
        await ctx.http
          .post('/api/v1/shifts')
          .set(b.owner)
          .send({ registerId: b.branchA.registerId, openingFloatMinor: 0 })
          .expect(201)
      ).body;
      await ctx.http
        .post('/api/v1/shifts')
        .set(manager)
        .send({ registerId: b.branchB.registerId, openingFloatMinor: 0 })
        .expect(201);

      const shifts = (await ctx.http.get('/api/v1/shifts').set(manager).expect(200)).body.items;
      expect(shifts.map((s: { branchId: string }) => s.branchId)).toEqual([b.branchB.id]);
      await ctx.http.get(`/api/v1/shifts?branchId=${b.branchA.id}`).set(manager).expect(403);
      // Another branch's shift is not found, and cannot be closed.
      await ctx.http.get(`/api/v1/shifts/${shiftA.id}`).set(manager).expect(404);
      await ctx.http.get(`/api/v1/sales?branchId=${b.branchA.id}`).set(manager).expect(403);
      await ctx.http.get('/api/v1/sales').set(manager).expect(200);
      // The owner still sees both.
      expect(
        (await ctx.http.get('/api/v1/shifts').set(b.owner).expect(200)).body.items,
      ).toHaveLength(2);
    });

    it('scopes reports to the member’s branches', async () => {
      const b = await business();
      const single = await restricted(b, 'MANAGER', [b.branchB.id]);
      const dashboard = await ctx.http.get('/api/v1/reports/dashboard').set(single).expect(200);
      expect(dashboard.body).toBeDefined();
      await ctx.http.get(`/api/v1/reports/sales?branchId=${b.branchA.id}`).set(single).expect(403);
      await ctx.http.get('/api/v1/reports/sales').set(single).expect(200);

      const both = await restricted(b, 'MANAGER', [b.branchA.id, b.branchB.id]);
      const pick = await ctx.http.get('/api/v1/reports/profit').set(both).expect(400);
      expect(pick.body.error.issues).toEqual([
        { path: 'branchId', message: 'validation.branch.required' },
      ]);
      await ctx.http.get(`/api/v1/reports/profit?branchId=${b.branchA.id}`).set(both).expect(200);

      // Unrestricted members still see the whole business.
      await ctx.http.get('/api/v1/reports/profit').set(b.owner).expect(200);
    });
  });

  describe('devices', () => {
    it('registers a till, and revoking it signs it out and blocks sign-in', async () => {
      const b = await business();
      const { email } = await addMember(ctx, b.tenantId, 'CASHIER');
      const deviceId = randomUUID();
      const cashier = bearer((await login(ctx, email, { deviceId })).accessToken);

      const device = (
        await ctx.http
          .put(`/api/v1/devices/${deviceId}`)
          .set(cashier)
          .send({ name: 'Front counter', registerId: b.branchA.registerId })
          .expect(200)
      ).body;
      expect(device).toMatchObject({
        id: deviceId,
        name: 'Front counter',
        branchId: b.branchA.id,
        revoked: false,
      });
      // Re-registering updates it in place.
      await ctx.http
        .put(`/api/v1/devices/${deviceId}`)
        .set(cashier)
        .send({ name: 'Kandy till', registerId: b.branchB.registerId })
        .expect(200);
      const list = (await ctx.http.get('/api/v1/devices').set(b.owner).expect(200)).body.items;
      expect(list).toHaveLength(1);
      expect(list[0]).toMatchObject({
        name: 'Kandy till',
        branchId: b.branchB.id,
        registerName: 'Till 1',
      });
      await ctx.http.get('/api/v1/devices').set(cashier).expect(403);

      const revoked = await ctx.http
        .post(`/api/v1/devices/${deviceId}/revoke`)
        .set(b.owner)
        .expect(200);
      expect(revoked.body.revoked).toBe(true);
      await ctx.http.get('/api/v1/tenant').set(cashier).expect(401);
      const blocked = await ctx.http
        .post('/api/v1/auth/login')
        .send({ email, password: STRONG_PASSWORD, clientType: 'MOBILE', deviceId })
        .expect(403);
      expect(blocked.body.error.code).toBe('DEVICE_REVOKED');
      // The person can still sign in on another device.
      const elsewhere = bearer((await login(ctx, email)).accessToken);
      const reuse = await ctx.http
        .put(`/api/v1/devices/${deviceId}`)
        .set(elsewhere)
        .send({ name: 'Again', registerId: b.branchA.registerId })
        .expect(403);
      expect(reuse.body.error.code).toBe('DEVICE_REVOKED');

      await ctx.http.post(`/api/v1/devices/${deviceId}/restore`).set(b.owner).expect(200);
      await login(ctx, email, { deviceId });
      const actions = (
        await ctx.owner.auditLog.findMany({
          where: { tenantId: b.tenantId, action: { startsWith: 'device.' } },
        })
      ).map((a) => a.action);
      expect(actions.sort()).toEqual(['device.registered', 'device.restored', 'device.revoked']);
    });

    it('keeps devices to their business and staff to their branches', async () => {
      const a = await business();
      const b = await business();
      const deviceId = randomUUID();
      await ctx.http
        .put(`/api/v1/devices/${deviceId}`)
        .set(a.owner)
        .send({ name: 'Till', registerId: a.branchA.registerId })
        .expect(200);
      await ctx.http.post(`/api/v1/devices/${deviceId}/revoke`).set(b.owner).expect(404);
      expect(
        (await ctx.http.get('/api/v1/devices').set(b.owner).expect(200)).body.items,
      ).toHaveLength(0);
      // Another business's register is not found.
      await ctx.http
        .put(`/api/v1/devices/${randomUUID()}`)
        .set(b.owner)
        .send({ name: 'Till', registerId: a.branchA.registerId })
        .expect(400);

      const { email } = await addMember(ctx, a.tenantId, 'CASHIER');
      const row = await staffRow(a, email);
      await ctx.http
        .patch(`/api/v1/staff/${row.membershipId}`)
        .set(a.owner)
        .send({ version: row.version, branchIds: [a.branchB.id] })
        .expect(200);
      const cashier = bearer((await login(ctx, email)).accessToken);
      const res = await ctx.http
        .put(`/api/v1/devices/${randomUUID()}`)
        .set(cashier)
        .send({ name: 'Till', registerId: a.branchA.registerId })
        .expect(403);
      expect(res.body.error.code).toBe('BRANCH_NOT_ALLOWED');
    });
  });
});
