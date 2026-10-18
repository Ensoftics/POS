import { parseCsv } from '@pos/domain';
import {
  addMember,
  bearer,
  createTestContext,
  login,
  onboardedTenant,
  resetDatabase,
  type TestContext,
} from './helpers';

const EAN = '4006381333931'; // valid EAN-13

describe('Catalog: categories, products, variants, CSV (integration)', () => {
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

  const lipstick = (overrides: Record<string, unknown> = {}) => ({
    name: 'Matte Lipstick',
    brand: 'Lotus',
    unit: 'piece',
    variants: [
      {
        sku: 'lip-ruby',
        barcode: EAN,
        attributes: { shade: 'Ruby' },
        priceMinor: 125000,
        costMinor: 60000,
      },
      { sku: 'LIP-NUDE', attributes: { shade: 'Nude' }, priceMinor: 125000 },
    ],
    ...overrides,
  });

  async function cosmeticsOwner() {
    return onboardedTenant(ctx, 'COSMETICS');
  }

  function createProduct(token: string, body: Record<string, unknown> = lipstick()) {
    return ctx.http.post('/api/v1/products').set(bearer(token)).send(body);
  }

  describe('products and variants', () => {
    it('creates a product with variants, normalised SKUs and money in minor units', async () => {
      const owner = await cosmeticsOwner();
      const response = await createProduct(owner.accessToken).expect(201);
      expect(response.body).toMatchObject({
        name: 'Matte Lipstick',
        unit: 'piece',
        status: 'ACTIVE',
        version: 1,
      });
      // Variants are listed in SKU order.
      expect(response.body.variants).toMatchObject([
        { sku: 'LIP-NUDE', barcode: null, priceMinor: 125000, costMinor: null },
        {
          sku: 'LIP-RUBY',
          barcode: EAN,
          attributes: { shade: 'Ruby' },
          priceMinor: 125000,
          costMinor: 60000,
        },
      ]);
      const row = await ctx.owner.productVariant.findFirstOrThrow({ where: { sku: 'LIP-RUBY' } });
      expect(row.priceMinor).toBe(125000n);
      expect(row.attributesKey).toBe('shade=ruby');
    });

    it('rejects attributes and units the business has not enabled', async () => {
      const owner = await cosmeticsOwner(); // cosmetics: brand/shade/size; no metres
      const response = await createProduct(
        owner.accessToken,
        lipstick({
          unit: 'metre',
          variants: [{ sku: 'X1', attributes: { colour: 'Red' }, priceMinor: 1 }],
        }),
      ).expect(400);
      expect(response.body.error.issues).toEqual(
        expect.arrayContaining([
          { path: 'unit', message: 'validation.unit.not_enabled' },
          { path: 'variants.0.attributes.colour', message: 'validation.attribute.not_enabled' },
        ]),
      );
    });

    it('rejects fractional reorder levels unless part quantities are allowed', async () => {
      const cosmetics = await cosmeticsOwner();
      const denied = await createProduct(
        cosmetics.accessToken,
        lipstick({ variants: [{ sku: 'R1', priceMinor: 1, reorderLevel: '2.5' }] }),
      ).expect(400);
      expect(denied.body.error.issues).toContainEqual({
        path: 'variants.0.reorderLevel',
        message: 'validation.quantity.fraction_not_allowed',
      });

      const textile = await onboardedTenant(ctx, 'TEXTILE');
      const fabric = await createProduct(textile.accessToken, {
        name: 'Cotton Fabric',
        unit: 'metre',
        variants: [
          {
            sku: 'COT-WHT',
            attributes: { colour: 'White' },
            priceMinor: 45000,
            reorderLevel: '12.5',
          },
        ],
      }).expect(201);
      expect(fabric.body.variants[0].reorderLevel).toBe('12.5');
    });

    it('keeps SKUs and barcodes unique per tenant with field-level errors', async () => {
      const owner = await cosmeticsOwner();
      await createProduct(owner.accessToken).expect(201);
      const clash = await createProduct(
        owner.accessToken,
        lipstick({
          name: 'Other',
          variants: [
            { sku: 'lip-ruby', attributes: { shade: 'A' }, priceMinor: 1 },
            { sku: 'NEW-1', barcode: EAN, attributes: { shade: 'B' }, priceMinor: 1 },
          ],
        }),
      ).expect(400);
      expect(clash.body.error.issues).toEqual(
        expect.arrayContaining([
          { path: 'variants.0.sku', message: 'validation.sku.taken' },
          { path: 'variants.1.barcode', message: 'validation.barcode.taken' },
        ]),
      );

      // Another tenant may reuse both.
      const other = await cosmeticsOwner();
      await createProduct(other.accessToken).expect(201);
    });

    it('lets only one of two concurrent creates claim a SKU', async () => {
      const owner = await cosmeticsOwner();
      const body = lipstick({ variants: [{ sku: 'RACE-1', priceMinor: 1 }] });
      const results = await Promise.all([
        createProduct(owner.accessToken, body),
        createProduct(owner.accessToken, body),
      ]);
      const statuses = results.map((r) => r.status).sort();
      expect(statuses[0]).toBe(201);
      expect([400, 409]).toContain(statuses[1]);
      expect(await ctx.owner.productVariant.count({ where: { sku: 'RACE-1' } })).toBe(1);
    });

    it('adds and edits variants with version checks and duplicate-option protection', async () => {
      const owner = await cosmeticsOwner();
      const product = (await createProduct(owner.accessToken).expect(201)).body;

      const dup = await ctx.http
        .post('/api/v1/variants')
        .set(bearer(owner.accessToken))
        .send({
          productId: product.id,
          sku: 'LIP-RUBY2',
          attributes: { shade: ' ruby ' },
          priceMinor: 1,
        })
        .expect(400);
      expect(dup.body.error.issues).toContainEqual({
        path: 'attributes',
        message: 'validation.attribute.duplicate_combination',
      });

      const added = await ctx.http
        .post('/api/v1/variants')
        .set(bearer(owner.accessToken))
        .send({
          productId: product.id,
          sku: 'LIP-CORAL',
          attributes: { shade: 'Coral' },
          priceMinor: 130000,
        })
        .expect(201);
      expect(added.body.variants).toHaveLength(3);

      const ruby = product.variants.find((v: { sku: string }) => v.sku === 'LIP-RUBY');
      const updated = await ctx.http
        .patch(`/api/v1/variants/${ruby.id}`)
        .set(bearer(owner.accessToken))
        .send({ version: ruby.version, priceMinor: 135000, barcode: '' })
        .expect(200);
      const after = updated.body.variants.find((v: { id: string }) => v.id === ruby.id);
      expect(after).toMatchObject({
        priceMinor: 135000,
        barcode: null,
        version: 2,
        sku: 'LIP-RUBY',
      });

      const stale = await ctx.http
        .patch(`/api/v1/variants/${ruby.id}`)
        .set(bearer(owner.accessToken))
        .send({ version: ruby.version, priceMinor: 1 })
        .expect(409);
      expect(stale.body.error.code).toBe('VERSION_CONFLICT');

      const audit = await ctx.owner.auditLog.findFirstOrThrow({
        where: { action: 'variant.updated' },
      });
      expect(audit.metadata).toMatchObject({ changes: { priceMinor: [125000, 135000] } });
    });

    it('hides costs from cashiers but shows prices', async () => {
      const owner = await cosmeticsOwner();
      const product = (await createProduct(owner.accessToken).expect(201)).body;
      const cashier = await login(ctx, (await addMember(ctx, owner.tenant.id, 'CASHIER')).email);
      const seen = await ctx.http
        .get(`/api/v1/products/${product.id}`)
        .set(bearer(cashier.accessToken))
        .expect(200);
      expect(seen.body.variants[0]).toMatchObject({ priceMinor: 125000, costMinor: null });
      await createProduct(cashier.accessToken).expect(403);
      await ctx.http.get('/api/v1/products/export').set(bearer(cashier.accessToken)).expect(403);
    });

    it('lets inventory staff manage products but not import or export', async () => {
      const owner = await cosmeticsOwner();
      const staff = await login(
        ctx,
        (await addMember(ctx, owner.tenant.id, 'INVENTORY_STAFF')).email,
      );
      await createProduct(staff.accessToken).expect(201);
      await ctx.http
        .post('/api/v1/products/import')
        .set(bearer(staff.accessToken))
        .send({ csv: 'x' })
        .expect(403);
    });
  });

  describe('search and lookup', () => {
    it('searches by name, brand, SKU prefix and exact barcode, and paginates', async () => {
      const owner = await cosmeticsOwner();
      await createProduct(owner.accessToken).expect(201);
      for (let i = 0; i < 3; i += 1) {
        await createProduct(owner.accessToken, {
          name: `Face Cream ${i}`,
          unit: 'piece',
          variants: [{ sku: `CREAM-${i}`, priceMinor: 1000 }],
        }).expect(201);
      }
      const search = async (q: string) =>
        (
          await ctx.http
            .get('/api/v1/products')
            .query({ q })
            .set(bearer(owner.accessToken))
            .expect(200)
        ).body.items.map((p: { name: string }) => p.name);
      expect(await search('matte')).toEqual(['Matte Lipstick']);
      expect(await search('LOTUS')).toEqual(['Matte Lipstick']);
      expect(await search('lip-n')).toEqual(['Matte Lipstick']);
      expect(await search(EAN)).toEqual(['Matte Lipstick']);
      expect(await search('cream')).toHaveLength(3);

      const first = await ctx.http
        .get('/api/v1/products')
        .query({ limit: 2 })
        .set(bearer(owner.accessToken))
        .expect(200);
      const second = await ctx.http
        .get('/api/v1/products')
        .query({ limit: 2, cursor: first.body.nextCursor })
        .set(bearer(owner.accessToken))
        .expect(200);
      expect(
        [...first.body.items, ...second.body.items].map((p: { name: string }) => p.name),
      ).toEqual(['Face Cream 0', 'Face Cream 1', 'Face Cream 2', 'Matte Lipstick']);
    });

    it('looks up sellable items by barcode or SKU, ignoring archived ones', async () => {
      const owner = await cosmeticsOwner();
      const product = (await createProduct(owner.accessToken).expect(201)).body;
      const byBarcode = await ctx.http
        .get('/api/v1/products/lookup')
        .query({ code: EAN })
        .set(bearer(owner.accessToken))
        .expect(200);
      expect(byBarcode.body.variant.sku).toBe('LIP-RUBY');
      const bySku = await ctx.http
        .get('/api/v1/products/lookup')
        .query({ code: 'lip-nude' })
        .set(bearer(owner.accessToken))
        .expect(200);
      expect(bySku.body.product.id).toBe(product.id);

      await ctx.http
        .patch(`/api/v1/products/${product.id}`)
        .set(bearer(owner.accessToken))
        .send({ version: product.version, status: 'ARCHIVED' })
        .expect(200);
      await ctx.http
        .get('/api/v1/products/lookup')
        .query({ code: EAN })
        .set(bearer(owner.accessToken))
        .expect(404);
    });

    it('never finds another tenant’s items', async () => {
      const a = await cosmeticsOwner();
      const b = await cosmeticsOwner();
      const productB = (await createProduct(b.accessToken).expect(201)).body;
      await ctx.http
        .get('/api/v1/products/lookup')
        .query({ code: EAN })
        .set(bearer(a.accessToken))
        .expect(404);
      await ctx.http.get(`/api/v1/products/${productB.id}`).set(bearer(a.accessToken)).expect(404);
      await ctx.http
        .patch(`/api/v1/variants/${productB.variants[0].id}`)
        .set(bearer(a.accessToken))
        .send({ version: 1, priceMinor: 1 })
        .expect(404);
      await ctx.http
        .post('/api/v1/variants')
        .set(bearer(a.accessToken))
        .send({ productId: productB.id, sku: 'HIJACK', priceMinor: 1 })
        .expect(404);
      expect(
        (await ctx.http.get('/api/v1/products').set(bearer(a.accessToken)).expect(200)).body.items,
      ).toEqual([]);
    });
  });

  describe('categories', () => {
    it('supports two levels, unique names per parent and parent filtering', async () => {
      const owner = await cosmeticsOwner();
      const post = (body: object) =>
        ctx.http.post('/api/v1/categories').set(bearer(owner.accessToken)).send(body);
      const makeup = (await post({ name: 'Makeup' }).expect(201)).body;
      const lips = (await post({ name: 'Lips', parentId: makeup.id }).expect(201)).body;
      expect((await post({ name: 'makeup' }).expect(409)).body.error.code).toBe('DUPLICATE_NAME');
      expect(
        (await post({ name: 'Too deep', parentId: lips.id }).expect(409)).body.error.code,
      ).toBe('CATEGORY_DEPTH');

      await createProduct(owner.accessToken, lipstick({ categoryId: lips.id })).expect(201);
      const underMakeup = await ctx.http
        .get('/api/v1/products')
        .query({ categoryId: makeup.id })
        .set(bearer(owner.accessToken))
        .expect(200);
      expect(underMakeup.body.items[0]).toMatchObject({
        name: 'Matte Lipstick',
        categoryName: 'Lips',
      });
    });

    it('rejects another tenant’s category on products', async () => {
      const a = await cosmeticsOwner();
      const b = await cosmeticsOwner();
      const foreign = (
        await ctx.http
          .post('/api/v1/categories')
          .set(bearer(b.accessToken))
          .send({ name: 'Theirs' })
          .expect(201)
      ).body;
      const response = await createProduct(
        a.accessToken,
        lipstick({ categoryId: foreign.id }),
      ).expect(400);
      expect(response.body.error.issues).toContainEqual({
        path: 'categoryId',
        message: 'validation.category.not_found',
      });
    });
  });

  describe('CSV import and export', () => {
    const header =
      'product_name,category,brand,unit,sku,barcode,price,cost,reorder_level,attr:shade';

    function importCsv(token: string, csv: string, dryRun: boolean) {
      return ctx.http.post('/api/v1/products/import').set(bearer(token)).send({ csv, dryRun });
    }

    it('dry-runs without writing, then applies atomically', async () => {
      const owner = await cosmeticsOwner();
      const csv = [
        header,
        'Matte Lipstick,Makeup,Lotus,piece,LIP-RUBY,4006381333931,"1,250.00",600,5,Ruby',
        'Matte Lipstick,Makeup,Lotus,piece,LIP-NUDE,,1250,,,Nude',
        'Night Cream,Skin,,piece,CRM-1,,2400.5,,,',
      ].join('\n');

      const dry = await importCsv(owner.accessToken, csv, true).expect(200);
      expect(dry.body).toMatchObject({
        dryRun: true,
        applied: false,
        rows: 3,
        productsCreated: 2,
        variantsCreated: 3,
        errors: [],
      });
      expect(await ctx.owner.product.count()).toBe(0);

      const applied = await importCsv(owner.accessToken, csv, false).expect(200);
      expect(applied.body).toMatchObject({ applied: true, productsCreated: 2, variantsCreated: 3 });
      const cream = await ctx.owner.productVariant.findFirstOrThrow({ where: { sku: 'CRM-1' } });
      expect(cream.priceMinor).toBe(240050n);
      expect(await ctx.owner.category.count()).toBe(2);

      // Re-importing updates prices by SKU instead of duplicating.
      const reprice = await importCsv(
        owner.accessToken,
        [header, 'Matte Lipstick,Makeup,Lotus,piece,LIP-RUBY,4006381333931,1300,600,5,Ruby'].join(
          '\n',
        ),
        false,
      ).expect(200);
      expect(reprice.body).toMatchObject({ variantsUpdated: 1, variantsCreated: 0 });
      expect(
        (await ctx.owner.productVariant.findFirstOrThrow({ where: { sku: 'LIP-RUBY' } }))
          .priceMinor,
      ).toBe(130000n);
      expect(await ctx.owner.auditLog.count({ where: { action: 'products.imported' } })).toBe(2);
    });

    it('reports every problem with line and column, and writes nothing', async () => {
      const owner = await cosmeticsOwner();
      await createProduct(owner.accessToken).expect(201);
      const csv = [
        header,
        'Good Item,,,piece,GOOD-1,,100,,,',
        ',,,piece,NONAME,,100,,,', // line 3: missing name
        'Bad Price,,,piece,BAD-1,,12.345,,,', // line 4: too many decimals
        'Bad Code,,,piece,BAD-2,4006381333932,100,,,', // line 5: checksum
        'Metres,,,metre,BAD-3,,100,,,', // line 6: unit not enabled for cosmetics
        'Dup,,,piece,GOOD-1,,100,,,', // line 7: duplicate SKU in file
        'Taken,,,piece,NEW-9,4006381333931,100,,,', // line 8: barcode owned by LIP-RUBY
      ].join('\r\n');
      const result = await importCsv(owner.accessToken, csv, false).expect(200);
      expect(result.body.applied).toBe(false);
      expect(result.body.errors).toEqual([
        { row: 3, column: 'product_name', message: 'validation.required' },
        { row: 4, column: 'price', message: 'validation.money.too_many_decimals' },
        { row: 5, column: 'barcode', message: 'validation.barcode.checksum' },
        { row: 6, column: 'unit', message: 'validation.unit.not_enabled' },
      ]);
      // Cross-row checks run once each row is individually valid.
      const fixed = csv
        .split('\r\n')
        .filter((_, i) => ![2, 3, 4, 5].includes(i))
        .join('\r\n');
      const second = await importCsv(owner.accessToken, fixed, false).expect(200);
      expect(second.body.errors).toEqual([
        { row: 3, column: 'sku', message: 'validation.import.duplicate_sku_in_file' },
        { row: 4, column: 'barcode', message: 'validation.barcode.taken' },
      ]);
      expect(await ctx.owner.productVariant.count({ where: { sku: 'GOOD-1' } })).toBe(0);
    });

    it('validates the header', async () => {
      const owner = await cosmeticsOwner();
      const result = await importCsv(
        owner.accessToken,
        'name,price,attr:wingspan\nx,1,2',
        true,
      ).expect(200);
      expect(result.body.errors).toEqual(
        expect.arrayContaining([
          { row: 1, column: 'product_name', message: 'validation.import.missing_column' },
          { row: 1, column: 'sku', message: 'validation.import.missing_column' },
          { row: 1, column: 'name', message: 'validation.import.unknown_column' },
          { row: 1, column: 'attr:wingspan', message: 'validation.attribute.unknown' },
        ]),
      );
    });

    it('exports a re-importable CSV with formula injection neutralised', async () => {
      const owner = await cosmeticsOwner();
      await createProduct(
        owner.accessToken,
        lipstick({ name: '=HYPERLINK("http://evil")' }),
      ).expect(201);
      const response = await ctx.http
        .get('/api/v1/products/export')
        .set(bearer(owner.accessToken))
        .expect(200);
      expect(response.headers['content-type']).toMatch(/text\/csv/);
      expect(response.headers['content-disposition']).toMatch(
        /attachment; filename="products-\d{8}\.csv"/,
      );
      const rows = parseCsv(response.text);
      expect(rows[0]).toEqual([
        'product_name',
        'category',
        'brand',
        'unit',
        'sku',
        'barcode',
        'price',
        'cost',
        'pack_size',
        'reorder_level',
        'status',
        'attr:brand',
        'attr:shade',
        'attr:size',
      ]);
      expect(rows[1]?.[0]).toBe(`'=HYPERLINK("http://evil")`);
      expect(rows[1]?.slice(4, 8)).toEqual(['LIP-NUDE', '', '1250.00', '']);
    });
  });

  describe('row-level security', () => {
    it('hides catalogue rows without tenant context and blocks cross-tenant references', async () => {
      const a = await cosmeticsOwner();
      const b = await cosmeticsOwner();
      const productB = (await createProduct(b.accessToken).expect(201)).body;
      expect(await ctx.prisma.product.count()).toBe(0);
      expect(await ctx.prisma.productVariant.count()).toBe(0);
      await expect(
        ctx.prisma.asSystem((tx) =>
          tx.productVariant.create({
            data: {
              tenantId: a.tenant.id,
              productId: productB.id,
              sku: 'X',
              attributesKey: 'x',
              priceMinor: 1n,
            },
          }),
        ),
      ).rejects.toThrow(/Foreign key constraint/i);
    });
  });
});
