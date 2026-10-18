import sharp from 'sharp';
import { ensureBucket } from '../src/scripts/storage-init';
import {
  addMember,
  bearer,
  createTestContext,
  login,
  onboardedTenant,
  resetDatabase,
  type TestContext,
} from './helpers';

const photo = (background: string, width = 900, height = 600) =>
  sharp({ create: { width, height, channels: 3, background } });

const jpeg = (background = '#c0392b') =>
  photo(background)
    .jpeg()
    .withExif({ IFD0: { Make: 'PhoneCam' } })
    .toBuffer();

/** Follows a signed image link the way a browser would (API redirect, then storage). */
async function download(ctx: TestContext, url: string) {
  const { pathname, search } = new URL(url);
  const redirect = await ctx.http.get(`${pathname}${search}`).redirects(0);
  if (redirect.status !== 302) return { status: redirect.status, body: null };
  expect(redirect.headers['cross-origin-resource-policy']).toBe('cross-origin');
  const response = await fetch(redirect.headers.location as string);
  return { status: response.status, body: Buffer.from(await response.arrayBuffer()) };
}

describe('Product images (integration)', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await createTestContext();
    await ensureBucket(ctx.config);
  });
  beforeEach(async () => {
    await resetDatabase(ctx.owner);
  });
  afterAll(async () => {
    await ctx.close();
  });

  async function shopWithProduct() {
    const owner = await onboardedTenant(ctx, 'COSMETICS');
    const product = await ctx.http
      .post('/api/v1/products')
      .set(bearer(owner.accessToken))
      .send({
        name: 'Matte Lipstick',
        unit: 'piece',
        variants: [{ sku: 'LIP-RUBY', attributes: { shade: 'Ruby' }, priceMinor: 125000 }],
      })
      .expect(201);
    return { owner, productId: product.body.id as string };
  }

  const upload = (token: string, productId: string, file: Buffer, name = 'photo.jpg') =>
    ctx.http
      .post(`/api/v1/products/${productId}/images`)
      .set(bearer(token))
      .attach('file', file, name);

  it('stores a re-encoded photo privately and serves it through a signed link', async () => {
    const { owner, productId } = await shopWithProduct();
    const response = await upload(owner.accessToken, productId, await jpeg()).expect(201);
    expect(response.body.images).toHaveLength(1);
    const [image] = response.body.images;
    expect(image).toMatchObject({ width: 900, height: 600 });
    expect(image.thumbUrl).toContain(
      `/api/v1/media/t/${owner.tenant.id}/i/${image.id}/thumb.webp?s=`,
    );

    const full = await download(ctx, image.url);
    expect(full.status).toBe(200);
    const meta = await sharp(full.body!).metadata();
    expect(meta.format).toBe('webp');
    expect(meta.exif).toBeUndefined();
    const thumb = await sharp((await download(ctx, image.thumbUrl)).body!).metadata();
    expect(Math.max(thumb.width!, thumb.height!)).toBe(400);

    // The bucket itself is private.
    const direct = await fetch(
      `${ctx.config.S3_ENDPOINT}/${ctx.config.S3_BUCKET}/tenants/${owner.tenant.id}/images/${image.id}/full.webp`,
    );
    expect(direct.status).toBe(403);

    // Products, lookups and the till catalogue carry the links.
    const fetched = await ctx.http
      .get(`/api/v1/products/${productId}`)
      .set(bearer(owner.accessToken))
      .expect(200);
    expect(fetched.body.images).toEqual(response.body.images);
    const catalog = await ctx.http
      .get('/api/v1/sync/catalog')
      .set(bearer(owner.accessToken))
      .expect(200);
    expect(catalog.body.items[0].imageUrl).toBe(image.thumbUrl);

    const audit = await ctx.owner.auditLog.findFirstOrThrow({
      where: { action: 'product.image_added' },
    });
    expect(audit).toMatchObject({ entityId: productId, metadata: { imageId: image.id } });
  });

  it('keeps the same photo once, reorders and removes photos', async () => {
    const { owner, productId } = await shopWithProduct();
    const file = await jpeg('#c0392b');
    const first = await upload(owner.accessToken, productId, file).expect(201);
    const again = await upload(owner.accessToken, productId, file).expect(201);
    expect(again.body.images).toEqual(first.body.images);

    const second = await upload(
      owner.accessToken,
      productId,
      await photo('#2980b9').png().toBuffer(),
      'photo.png',
    ).expect(201);
    const [a, b] = second.body.images.map((image: { id: string }) => image.id);

    const reordered = await ctx.http
      .put(`/api/v1/products/${productId}/images/order`)
      .set(bearer(owner.accessToken))
      .send({ imageIds: [b, a] })
      .expect(200);
    expect(reordered.body.images.map((image: { id: string }) => image.id)).toEqual([b, a]);
    await ctx.http
      .put(`/api/v1/products/${productId}/images/order`)
      .set(bearer(owner.accessToken))
      .send({ imageIds: [b] })
      .expect(400);

    const removedUrl = reordered.body.images[0].url;
    const removed = await ctx.http
      .delete(`/api/v1/products/${productId}/images/${b}`)
      .set(bearer(owner.accessToken))
      .expect(200);
    expect(removed.body.images.map((image: { id: string }) => image.id)).toEqual([a]);
    const rows = await ctx.owner.productImage.findMany({ where: { productId } });
    expect(rows).toMatchObject([{ id: a, position: 0 }]);
    // The files went with it.
    expect((await download(ctx, removedUrl)).status).toBe(404);
  });

  it('refuses files that are not photos, too large or missing', async () => {
    const { owner, productId } = await shopWithProduct();
    const svg = Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="300" height="300"><rect width="300" height="300"/></svg>',
    );
    const bad = await upload(owner.accessToken, productId, svg, 'photo.jpg').expect(400);
    expect(bad.body.error.issues).toEqual([
      { path: 'file', message: 'validation.image.unsupported_type' },
    ]);
    const none = await ctx.http
      .post(`/api/v1/products/${productId}/images`)
      .set(bearer(owner.accessToken))
      .expect(400);
    expect(none.body.error.issues).toEqual([
      { path: 'file', message: 'validation.image.required' },
    ]);

    const small = await createTestContext({ PRODUCT_IMAGE_MAX_BYTES: 100_000 });
    try {
      const noise = await sharp(
        Buffer.from(Array.from({ length: 600 * 600 * 3 }, () => Math.floor(Math.random() * 256))),
        {
          raw: { width: 600, height: 600, channels: 3 },
        },
      )
        .png()
        .toBuffer();
      expect(noise.length).toBeGreaterThan(100_000);
      const large = await small.http
        .post(`/api/v1/products/${productId}/images`)
        .set(bearer(owner.accessToken))
        .attach('file', noise, 'photo.png')
        .expect(413);
      expect(large.body.error.issues).toEqual([
        { path: 'file', message: 'validation.image.too_large' },
      ]);
    } finally {
      await small.close();
    }
    expect(await ctx.owner.productImage.count()).toBe(0);
  });

  it('allows up to eight photos per product', async () => {
    const { owner, productId } = await shopWithProduct();
    for (let i = 0; i < 8; i += 1) {
      await upload(
        owner.accessToken,
        productId,
        await jpeg(`#${(i * 30 + 16).toString(16)}3060`),
      ).expect(201);
    }
    const ninth = await upload(owner.accessToken, productId, await jpeg('#ffffff')).expect(409);
    expect(ninth.body.error.code).toBe('IMAGE_LIMIT_REACHED');
    expect(await ctx.owner.productImage.count({ where: { productId } })).toBe(8);
  });

  it('keeps photos to people who manage products, within their own business', async () => {
    const { owner, productId } = await shopWithProduct();
    const cashier = await addMember(ctx, owner.tenant.id, 'CASHIER');
    const cashierSession = await login(ctx, cashier.email);
    await upload(cashierSession.accessToken, productId, await jpeg()).expect(403);

    const other = await onboardedTenant(ctx, 'COSMETICS');
    await upload(other.accessToken, productId, await jpeg()).expect(404);

    const added = await upload(owner.accessToken, productId, await jpeg()).expect(201);
    const [image] = added.body.images;
    await ctx.http
      .delete(`/api/v1/products/${productId}/images/${image.id}`)
      .set(bearer(other.accessToken))
      .expect(404);

    // A link cannot be re-pointed at another business or file.
    const forged = image.url.replace(owner.tenant.id, other.tenant.id);
    expect((await download(ctx, forged)).status).toBe(404);
    expect((await download(ctx, image.url.replace('/full.webp', '/thumb.webp'))).status).toBe(404);
    expect((await download(ctx, image.url.split('?')[0])).status).toBe(404);
  });

  it('reports storage as unavailable when no bucket is configured', async () => {
    const { owner, productId } = await shopWithProduct();
    const unconfigured = await createTestContext({ S3_BUCKET: undefined });
    try {
      const response = await unconfigured.http
        .post(`/api/v1/products/${productId}/images`)
        .set(bearer(owner.accessToken))
        .attach('file', await jpeg(), 'photo.jpg')
        .expect(503);
      expect(response.body.error.code).toBe('STORAGE_UNAVAILABLE');
    } finally {
      await unconfigured.close();
    }
  });
});
