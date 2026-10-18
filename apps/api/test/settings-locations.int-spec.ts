import {
  addMember,
  bearer,
  createTestContext,
  login,
  onboardedTenant,
  registerTenant,
  resetDatabase,
  type TestContext,
} from './helpers';

describe('Business settings, branches and registers (integration)', () => {
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

  const settingsOf = async (token: string) =>
    (await ctx.http.get('/api/v1/settings').set(bearer(token)).expect(200)).body;
  const branchesOf = async (token: string, includeArchived = false) =>
    (
      await ctx.http
        .get('/api/v1/branches')
        .query({ includeArchived })
        .set(bearer(token))
        .expect(200)
    ).body.items;

  describe('settings', () => {
    it('starts with Sri Lankan defaults and no locations before onboarding', async () => {
      const session = await registerTenant(ctx);
      const settings = await settingsOf(session.accessToken);
      expect(settings).toMatchObject({
        version: 1,
        currency: 'LKR',
        timezone: 'Asia/Colombo',
        country: 'LK',
        defaultLanguage: 'en',
        enabledLanguages: ['en', 'si', 'ta'],
        profile: { defaultUnits: ['piece'], variantAttributes: [] },
      });
      expect(await branchesOf(session.accessToken)).toEqual([]);
    });

    it('applies the industry preset and creates a default branch and register on onboarding', async () => {
      const session = await onboardedTenant(ctx, 'COSMETICS');
      const settings = await settingsOf(session.accessToken);
      expect(settings.profile).toMatchObject({ trackBatchNumbers: true, trackExpiryDates: true });
      const branches = await branchesOf(session.accessToken);
      expect(branches).toHaveLength(1);
      expect(branches[0]).toMatchObject({ code: 'MAIN', registers: [{ code: 'R1' }] });
    });

    it('does not overwrite later settings when onboarding is submitted again', async () => {
      const session = await onboardedTenant(ctx, 'COSMETICS');
      const { version } = await settingsOf(session.accessToken);
      await ctx.http
        .patch('/api/v1/settings')
        .set(bearer(session.accessToken))
        .send({
          version,
          profile: {
            trackBatchNumbers: false,
            trackExpiryDates: false,
            allowFractionalQuantities: false,
            variantAttributes: [],
            defaultUnits: ['piece'],
          },
        })
        .expect(200);
      await ctx.http
        .post('/api/v1/tenant/onboarding')
        .set(bearer(session.accessToken))
        .send({ businessName: 'Renamed', businessType: 'TEXTILE' })
        .expect(200);
      expect((await settingsOf(session.accessToken)).profile.trackBatchNumbers).toBe(false);
      expect(await branchesOf(session.accessToken)).toHaveLength(1);
    });

    it('updates fields, bumps the version and audits the change', async () => {
      const session = await onboardedTenant(ctx);
      const { version } = await settingsOf(session.accessToken);
      const updated = await ctx.http
        .patch('/api/v1/settings')
        .set(bearer(session.accessToken))
        .send({
          version,
          currency: 'USD',
          timezone: 'Asia/Kolkata',
          legalName: 'Nimal Textiles (Pvt) Ltd',
          taxRegistrationNumber: '',
        })
        .expect(200);
      expect(updated.body).toMatchObject({
        version: version + 1,
        currency: 'USD',
        timezone: 'Asia/Kolkata',
        legalName: 'Nimal Textiles (Pvt) Ltd',
        taxRegistrationNumber: null,
      });

      const audit = await ctx.owner.auditLog.findFirstOrThrow({
        where: { action: 'settings.updated' },
      });
      expect(audit.metadata).toMatchObject({
        changes: { currency: ['LKR', 'USD'], timezone: ['Asia/Colombo', 'Asia/Kolkata'] },
      });
    });

    it('rejects stale versions with VERSION_CONFLICT', async () => {
      const session = await onboardedTenant(ctx);
      const { version } = await settingsOf(session.accessToken);
      await ctx.http
        .patch('/api/v1/settings')
        .set(bearer(session.accessToken))
        .send({ version, city: 'Kandy' })
        .expect(200);
      const stale = await ctx.http
        .patch('/api/v1/settings')
        .set(bearer(session.accessToken))
        .send({ version, city: 'Galle' })
        .expect(409);
      expect(stale.body.error.code).toBe('VERSION_CONFLICT');
      expect((await settingsOf(session.accessToken)).city).toBe('Kandy');
    });

    it('lets only one of two concurrent edits with the same version win', async () => {
      const session = await onboardedTenant(ctx);
      const { version } = await settingsOf(session.accessToken);
      const results = await Promise.all(
        ['Kandy', 'Galle'].map((city) =>
          ctx.http
            .patch('/api/v1/settings')
            .set(bearer(session.accessToken))
            .send({ version, city }),
        ),
      );
      expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    });

    it('validates currency, timezone and language combinations', async () => {
      const session = await onboardedTenant(ctx);
      const { version } = await settingsOf(session.accessToken);
      const invalid = await ctx.http
        .patch('/api/v1/settings')
        .set(bearer(session.accessToken))
        .send({ version, currency: 'BTC', timezone: 'Nowhere/City' })
        .expect(400);
      expect(invalid.body.error.issues.map((i: { path: string }) => i.path).sort()).toEqual([
        'currency',
        'timezone',
      ]);

      // Merged rule: disabling the current default language is rejected even if only one field is sent.
      const merged = await ctx.http
        .patch('/api/v1/settings')
        .set(bearer(session.accessToken))
        .send({ version, enabledLanguages: ['si', 'ta'] })
        .expect(400);
      expect(merged.body.error.issues).toContainEqual({
        path: 'enabledLanguages',
        message: 'validation.languages.default_not_enabled',
      });
    });

    it('lets every role read settings but only owners change them', async () => {
      const session = await onboardedTenant(ctx);
      const manager = await login(ctx, (await addMember(ctx, session.tenant.id, 'MANAGER')).email);
      const cashier = await login(ctx, (await addMember(ctx, session.tenant.id, 'CASHIER')).email);
      const { version } = await settingsOf(cashier.accessToken);
      for (const token of [manager.accessToken, cashier.accessToken]) {
        await ctx.http
          .patch('/api/v1/settings')
          .set(bearer(token))
          .send({ version, currency: 'USD' })
          .expect(403);
      }
    });

    it('serves industry presets', async () => {
      const session = await registerTenant(ctx);
      const presets = await ctx.http
        .get('/api/v1/settings/profile-presets')
        .set(bearer(session.accessToken))
        .expect(200);
      expect(presets.body.TEXTILE.defaultUnits).toContain('metre');
    });
  });

  describe('branches and registers', () => {
    it('creates branches with normalised unique codes', async () => {
      const session = await onboardedTenant(ctx);
      const created = await ctx.http
        .post('/api/v1/branches')
        .set(bearer(session.accessToken))
        .send({ code: ' kandy 1 ', name: 'Kandy City', city: 'Kandy', phone: '+94 81 222 3344' })
        .expect(201);
      expect(created.body).toMatchObject({
        code: 'KANDY-1',
        status: 'ACTIVE',
        version: 1,
        registers: [],
      });

      const duplicate = await ctx.http
        .post('/api/v1/branches')
        .set(bearer(session.accessToken))
        .send({ code: 'KANDY-1', name: 'Other' })
        .expect(409);
      expect(duplicate.body.error.code).toBe('DUPLICATE_CODE');
    });

    it('allows the same code in different tenants', async () => {
      const a = await onboardedTenant(ctx);
      const b = await onboardedTenant(ctx);
      for (const session of [a, b]) {
        await ctx.http
          .post('/api/v1/branches')
          .set(bearer(session.accessToken))
          .send({ code: 'GALLE', name: 'Galle' })
          .expect(201);
      }
    });

    it('creates registers and enforces per-branch code uniqueness', async () => {
      const session = await onboardedTenant(ctx);
      const [main] = await branchesOf(session.accessToken);
      const r2 = await ctx.http
        .post('/api/v1/registers')
        .set(bearer(session.accessToken))
        .send({ branchId: main.id, code: 'r2', name: 'Register 2' })
        .expect(201);
      expect(r2.body).toMatchObject({ code: 'R2', branchId: main.id });
      const dup = await ctx.http
        .post('/api/v1/registers')
        .set(bearer(session.accessToken))
        .send({ branchId: main.id, code: 'R1', name: 'Again' })
        .expect(409);
      expect(dup.body.error.code).toBe('DUPLICATE_CODE');
    });

    it('archives a branch with its registers but never the last active branch', async () => {
      const session = await onboardedTenant(ctx);
      const [main] = await branchesOf(session.accessToken);
      const last = await ctx.http
        .patch(`/api/v1/branches/${main.id}`)
        .set(bearer(session.accessToken))
        .send({ version: main.version, status: 'ARCHIVED' })
        .expect(409);
      expect(last.body.error.code).toBe('LAST_ACTIVE_BRANCH');

      await ctx.http
        .post('/api/v1/branches')
        .set(bearer(session.accessToken))
        .send({ code: 'B2', name: 'Second' })
        .expect(201);
      const archived = await ctx.http
        .patch(`/api/v1/branches/${main.id}`)
        .set(bearer(session.accessToken))
        .send({ version: main.version, status: 'ARCHIVED' })
        .expect(200);
      expect(archived.body.status).toBe('ARCHIVED');
      expect(
        archived.body.registers.every((r: { status: string }) => r.status === 'ARCHIVED'),
      ).toBe(true);

      expect((await branchesOf(session.accessToken)).map((b: { code: string }) => b.code)).toEqual([
        'B2',
      ]);
      expect(await branchesOf(session.accessToken, true)).toHaveLength(2);

      // New registers cannot be added to, or restored inside, an archived branch.
      const blocked = await ctx.http
        .post('/api/v1/registers')
        .set(bearer(session.accessToken))
        .send({ branchId: main.id, code: 'R9', name: 'Nope' })
        .expect(409);
      expect(blocked.body.error.code).toBe('BRANCH_ARCHIVED');
      const register = archived.body.registers[0];
      await ctx.http
        .patch(`/api/v1/registers/${register.id}`)
        .set(bearer(session.accessToken))
        .send({ version: register.version, status: 'ACTIVE' })
        .expect(409);
    });

    it('never archives both of the last two branches when requests race', async () => {
      const session = await onboardedTenant(ctx);
      const second = (
        await ctx.http
          .post('/api/v1/branches')
          .set(bearer(session.accessToken))
          .send({ code: 'B2', name: 'Second' })
          .expect(201)
      ).body;
      const [main] = await branchesOf(session.accessToken);
      const results = await Promise.all(
        [main, second].map((branch) =>
          ctx.http
            .patch(`/api/v1/branches/${branch.id}`)
            .set(bearer(session.accessToken))
            .send({ version: branch.version, status: 'ARCHIVED' }),
        ),
      );
      expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
      expect(await branchesOf(session.accessToken)).toHaveLength(1);
    });

    it('rejects stale branch edits', async () => {
      const session = await onboardedTenant(ctx);
      const [main] = await branchesOf(session.accessToken);
      await ctx.http
        .patch(`/api/v1/branches/${main.id}`)
        .set(bearer(session.accessToken))
        .send({ version: main.version, name: 'Head office' })
        .expect(200);
      const stale = await ctx.http
        .patch(`/api/v1/branches/${main.id}`)
        .set(bearer(session.accessToken))
        .send({ version: main.version, name: 'Lost update' })
        .expect(409);
      expect(stale.body.error.code).toBe('VERSION_CONFLICT');
    });

    it('lets managers manage locations but not cashiers or inventory staff', async () => {
      const session = await onboardedTenant(ctx);
      const manager = await login(ctx, (await addMember(ctx, session.tenant.id, 'MANAGER')).email);
      await ctx.http
        .post('/api/v1/branches')
        .set(bearer(manager.accessToken))
        .send({ code: 'MGR', name: 'Manager branch' })
        .expect(201);
      for (const role of ['CASHIER', 'INVENTORY_STAFF'] as const) {
        const member = await login(ctx, (await addMember(ctx, session.tenant.id, role)).email);
        expect(await branchesOf(member.accessToken)).toHaveLength(2);
        await ctx.http
          .post('/api/v1/branches')
          .set(bearer(member.accessToken))
          .send({ code: 'X1', name: 'Nope' })
          .expect(403);
      }
    });
  });

  describe('tenant isolation', () => {
    it('hides and protects another tenant’s branches and registers', async () => {
      const a = await onboardedTenant(ctx);
      const b = await onboardedTenant(ctx);
      const [branchB] = await branchesOf(b.accessToken);
      const registerB = branchB.registers[0];

      expect((await branchesOf(a.accessToken)).map((x: { id: string }) => x.id)).not.toContain(
        branchB.id,
      );
      await ctx.http
        .patch(`/api/v1/branches/${branchB.id}`)
        .set(bearer(a.accessToken))
        .send({ version: 1, name: 'pwned' })
        .expect(404);
      await ctx.http
        .patch(`/api/v1/registers/${registerB.id}`)
        .set(bearer(a.accessToken))
        .send({ version: 1, name: 'pwned' })
        .expect(404);
      // Attaching a register to a foreign branch is refused.
      await ctx.http
        .post('/api/v1/registers')
        .set(bearer(a.accessToken))
        .send({ branchId: branchB.id, code: 'EVIL', name: 'Evil' })
        .expect(404);
      await ctx.http
        .patch('/api/v1/branches/not-a-uuid')
        .set(bearer(a.accessToken))
        .send({ version: 1 })
        .expect(404);

      const untouched = await ctx.owner.branch.findUniqueOrThrow({ where: { id: branchB.id } });
      expect(untouched.name).toBe('Main branch');
    });

    it('keeps settings separate per tenant', async () => {
      const a = await onboardedTenant(ctx);
      const b = await onboardedTenant(ctx);
      const { version } = await settingsOf(a.accessToken);
      await ctx.http
        .patch('/api/v1/settings')
        .set(bearer(a.accessToken))
        .send({ version, currency: 'USD' })
        .expect(200);
      expect((await settingsOf(b.accessToken)).currency).toBe('LKR');
    });

    it('enforces RLS and the tenant-scoped foreign key in the database', async () => {
      const a = await onboardedTenant(ctx);
      const b = await onboardedTenant(ctx);
      const [branchB] = await branchesOf(b.accessToken);

      expect(await ctx.prisma.branch.count()).toBe(0);
      expect(await ctx.prisma.tenantSettings.count()).toBe(0);
      const visible = await ctx.prisma.withTenant(a.tenant.id, (tx) => tx.register.findMany());
      expect(visible.every((r) => r.tenantId === a.tenant.id)).toBe(true);

      // Even with RLS bypassed, a register cannot point at another tenant's branch.
      await expect(
        ctx.prisma.asSystem((tx) =>
          tx.register.create({
            data: { tenantId: a.tenant.id, branchId: branchB.id, code: 'X', name: 'Cross' },
          }),
        ),
      ).rejects.toThrow(/Foreign key constraint/i);
    });
  });
});
