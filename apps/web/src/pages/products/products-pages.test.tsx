import type { Product } from '@pos/contracts';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { callsTo, mockApi, renderAt, settingsFixture, signedInAs } from '../../test/render';

const MANAGER = [
  'tenant.read',
  'audit.read',
  'settings.read',
  'branches.read',
  'branches.manage',
  'products.read',
  'products.manage',
  'products.import',
] as const;

const bodyOf = (call: unknown[] | undefined) => JSON.parse(String((call?.[1] as RequestInit).body));

function product(overrides: Partial<Product> = {}): Product {
  return {
    id: '66666666-6666-4666-8666-666666666666',
    name: 'Matte Lipstick',
    brand: 'Lotus',
    description: null,
    unit: 'piece',
    categoryId: null,
    categoryName: 'Makeup',
    taxRateId: null,
    status: 'ACTIVE',
    version: 1,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    variants: [
      {
        id: '77777777-7777-4777-8777-777777777777',
        productId: '66666666-6666-4666-8666-666666666666',
        sku: 'LIP-RUBY',
        barcode: '4006381333931',
        attributes: { shade: 'Ruby' },
        priceMinor: 125000,
        costMinor: 60000,
        packSize: null,
        reorderLevel: null,
        status: 'ACTIVE',
        version: 1,
      },
    ],
    ...overrides,
  };
}

const settings = settingsFixture({
  profile: {
    trackBatchNumbers: true,
    trackExpiryDates: true,
    allowFractionalQuantities: false,
    variantAttributes: ['shade'],
    defaultUnits: ['piece', 'pack'],
  },
});

describe('Products list', () => {
  it('shows prices in the business currency and searches as you type', async () => {
    signedInAs({ permissions: [...MANAGER] });
    const fetch = mockApi(
      (url) =>
        url.includes('/categories')
          ? { status: 200, body: { items: [] } }
          : { status: 200, body: { items: [product()], nextCursor: null } },
      settings,
    );
    renderAt('/products');

    const row = within(await screen.findByRole('table'))
      .getByRole('link', { name: 'Matte Lipstick' })
      .closest('tr')!;
    expect(within(row).getByText(/1,250\.00/)).toBeInTheDocument();
    expect(within(row).getByText('1 variant')).toBeInTheDocument();

    await userEvent.type(screen.getByLabelText('Search products'), 'lip');
    await waitFor(() => expect(callsTo(fetch, '/products?q=lip')).not.toHaveLength(0));
  });

  it('opens the exact match when a barcode is scanned (typed + Enter)', async () => {
    signedInAs({ permissions: [...MANAGER] });
    mockApi((url) => {
      if (url.includes('/products/lookup'))
        return { status: 200, body: { product: product(), variant: product().variants[0] } };
      if (url.includes('/categories')) return { status: 200, body: { items: [] } };
      if (url.includes(`/products/${product().id}`)) return { status: 200, body: product() };
      return { status: 200, body: { items: [], nextCursor: null } };
    }, settings);
    renderAt('/products');
    await userEvent.type(await screen.findByLabelText('Search products'), '4006381333931{Enter}');
    expect(await screen.findByRole('heading', { name: 'Matte Lipstick' })).toBeInTheDocument();
  });

  it('says when a scanned code is unknown', async () => {
    signedInAs({ permissions: [...MANAGER] });
    mockApi(
      (url) =>
        url.includes('/products/lookup')
          ? { status: 404, body: { error: { code: 'NOT_FOUND', message: 'x' } } }
          : url.includes('/categories')
            ? { status: 200, body: { items: [] } }
            : { status: 200, body: { items: [], nextCursor: null } },
      settings,
    );
    renderAt('/products');
    await userEvent.type(await screen.findByLabelText('Search products'), 'NOPE-1{Enter}');
    expect(await screen.findByText('No active product has the code NOPE-1.')).toBeInTheDocument();
  });

  it('hides management actions from cashiers', async () => {
    signedInAs({
      role: 'CASHIER',
      permissions: ['tenant.read', 'settings.read', 'branches.read', 'products.read'],
    });
    mockApi(
      (url) =>
        url.includes('/categories')
          ? { status: 200, body: { items: [] } }
          : { status: 200, body: { items: [product()], nextCursor: null } },
      settings,
    );
    renderAt('/products');
    await screen.findByRole('table');
    expect(screen.queryByRole('link', { name: 'Add product' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Import CSV' })).not.toBeInTheDocument();
  });
});

describe('New product', () => {
  it('validates money locally, converts it to minor units and maps server errors to fields', async () => {
    signedInAs({ permissions: [...MANAGER] });
    let attempt = 0;
    const fetch = mockApi((url, init) => {
      if (url.includes('/categories')) return { status: 200, body: { items: [] } };
      if (init.method === 'POST' && url.endsWith('/products')) {
        attempt += 1;
        return attempt === 1
          ? {
              status: 400,
              body: {
                error: {
                  code: 'VALIDATION_FAILED',
                  message: 'x',
                  issues: [{ path: 'variants.0.sku', message: 'validation.sku.taken' }],
                },
              },
            }
          : { status: 201, body: product() };
      }
      return { status: 200, body: product() };
    }, settings);
    renderAt('/products/new');

    await userEvent.type(await screen.findByLabelText('Product name'), 'Matte Lipstick');
    await userEvent.type(screen.getByLabelText(/Shade/), 'Ruby');
    await userEvent.type(screen.getByLabelText('SKU'), 'LIP-RUBY');
    await userEvent.type(screen.getByLabelText('Selling price (LKR)'), '1250.555');
    await userEvent.click(screen.getByRole('button', { name: 'Save product' }));
    expect(
      await screen.findByText('Too many decimal places for this currency'),
    ).toBeInTheDocument();

    await userEvent.clear(screen.getByLabelText('Selling price (LKR)'));
    await userEvent.type(screen.getByLabelText('Selling price (LKR)'), '1,250.5');
    await userEvent.click(screen.getByRole('button', { name: 'Save product' }));
    expect(await screen.findByText('This SKU is already used by another item')).toBeInTheDocument();

    const posts = callsTo(fetch, '/products').filter(
      ([, init]) => (init as RequestInit).method === 'POST',
    );
    expect(bodyOf(posts[0]).variants[0]).toMatchObject({
      sku: 'LIP-RUBY',
      priceMinor: 125050,
      attributes: { shade: 'Ruby' },
    });

    await userEvent.clear(screen.getByLabelText('SKU'));
    await userEvent.type(screen.getByLabelText('SKU'), 'LIP-RUBY-2');
    await userEvent.click(screen.getByRole('button', { name: 'Save product' }));
    expect(await screen.findByText('Product created.')).toBeInTheDocument();
  });

  it('only offers units and options the business enabled', async () => {
    signedInAs({ permissions: [...MANAGER] });
    mockApi(
      (url) =>
        url.includes('/categories') ? { status: 200, body: { items: [] } } : { status: 500 },
      settings,
    );
    renderAt('/products/new');
    const unit = await screen.findByLabelText('Unit of measure');
    expect(
      within(unit)
        .getAllByRole('option')
        .map((o) => o.textContent),
    ).toEqual(['Piece', 'Pack']);
    expect(screen.queryByLabelText(/Colour/)).not.toBeInTheDocument();
  });
});

describe('Product detail', () => {
  it('hides costs from cashiers and shows a read-only view', async () => {
    signedInAs({
      role: 'CASHIER',
      permissions: ['tenant.read', 'settings.read', 'branches.read', 'products.read'],
    });
    const noCost = product({ variants: [{ ...product().variants[0]!, costMinor: null }] });
    mockApi(
      (url) =>
        url.includes('/categories')
          ? { status: 200, body: { items: [] } }
          : { status: 200, body: noCost },
      settings,
    );
    renderAt(`/products/${noCost.id}`);
    expect(await screen.findByText('LIP-RUBY')).toBeInTheDocument();
    expect(screen.getByLabelText('Product name')).toBeDisabled();
    expect(screen.queryByRole('button', { name: /Edit LIP-RUBY/ })).not.toBeInTheDocument();
    expect(screen.getByText('No photos yet.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add photos' })).not.toBeInTheDocument();
  });
});

describe('Product photos', () => {
  const photo = (id: string, n: number) => ({
    id,
    url: `https://api.example.lk/api/v1/media/t/t/i/${id}/full.webp?s=${n}`,
    thumbUrl: `https://api.example.lk/api/v1/media/t/t/i/${id}/thumb.webp?s=${n}`,
    width: 800,
    height: 600,
  });
  const first = photo('a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1', 1);
  const second = photo('b2b2b2b2-b2b2-4b2b-8b2b-b2b2b2b2b2b2', 2);

  it('uploads photos as form data and makes another photo the main one', async () => {
    signedInAs({ permissions: [...MANAGER] });
    const fetch = mockApi((url, init) => {
      if (url.includes('/categories')) return { status: 200, body: { items: [] } };
      if (url.endsWith('/images') && init.method === 'POST')
        return { status: 201, body: product({ images: [first, second] }) };
      if (url.endsWith('/images/order'))
        return { status: 200, body: product({ images: [second, first] }) };
      return { status: 200, body: product({ images: [first] }) };
    }, settings);
    renderAt(`/products/${product().id}`);
    const list = await screen.findByRole('list', { name: 'Photos' });
    expect(within(list).getByAltText('Matte Lipstick, photo 1')).toHaveAttribute(
      'src',
      first.thumbUrl,
    );

    const file = new File(['jpeg-bytes'], 'shade.jpg', { type: 'image/jpeg' });
    const input = document.querySelector<HTMLInputElement>('input[type="file"]')!;
    await userEvent.upload(input, file);
    expect(await screen.findByText('Photo added.')).toBeInTheDocument();
    const [upload] = callsTo(fetch, '/images').filter(
      ([, init]) => (init as RequestInit).method === 'POST',
    );
    const body = (upload![1] as RequestInit).body as FormData;
    expect(body).toBeInstanceOf(FormData);
    expect((body.get('file') as File).name).toBe('shade.jpg');

    await userEvent.click(screen.getByRole('button', { name: 'Make main' }));
    expect(await screen.findByText('Main photo changed.')).toBeInTheDocument();
    const [order] = callsTo(fetch, '/images/order');
    expect(bodyOf(order)).toEqual({ imageIds: [second.id, first.id] });
  });

  it('refuses other file types before uploading and shows server reasons', async () => {
    signedInAs({ permissions: [...MANAGER] });
    const fetch = mockApi((url, init) => {
      if (url.includes('/categories')) return { status: 200, body: { items: [] } };
      if (url.endsWith('/images') && init.method === 'POST')
        return {
          status: 400,
          body: {
            error: {
              code: 'VALIDATION_FAILED',
              message: 'Request validation failed',
              issues: [{ path: 'file', message: 'validation.image.too_small' }],
            },
          },
        };
      return { status: 200, body: product() };
    }, settings);
    renderAt(`/products/${product().id}`);
    await screen.findByText('No photos yet.');
    const input = document.querySelector<HTMLInputElement>('input[type="file"]')!;

    await userEvent.upload(input, new File(['gif'], 'a.gif', { type: 'image/gif' }), {
      applyAccept: false,
    });
    expect(await screen.findByText('Use a JPEG, PNG or WebP photo')).toBeInTheDocument();
    expect(callsTo(fetch, '/images')).toHaveLength(0);

    await userEvent.upload(input, new File(['png'], 'tiny.png', { type: 'image/png' }));
    expect(
      await screen.findByText('This photo is too small (at least 64 × 64 pixels)'),
    ).toBeInTheDocument();
  });
});

describe('CSV import', () => {
  it('checks the file first and only applies after confirmation', async () => {
    signedInAs({ permissions: [...MANAGER] });
    const fetch = mockApi((_url, init) => {
      const body = JSON.parse(String(init.body ?? '{}'));
      return {
        status: 200,
        body: {
          dryRun: body.dryRun,
          applied: !body.dryRun,
          rows: 2,
          productsCreated: 1,
          variantsCreated: 2,
          variantsUpdated: 0,
          errors: [],
        },
      };
    }, settings);
    renderAt('/products/import');
    const file = new File(
      ['product_name,sku,price\nTee,TEE-S,1500\nTee,TEE-M,1500\n'],
      'tees.csv',
      { type: 'text/csv' },
    );
    await userEvent.upload(await screen.findByLabelText('CSV file'), file);
    await userEvent.click(screen.getByRole('button', { name: 'Check file' }));
    expect(
      await screen.findByText('No problems found. Nothing has been changed yet.'),
    ).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Import 2 rows' }));
    expect(await screen.findByText('Import complete.')).toBeInTheDocument();
    const imports = callsTo(fetch, '/products/import');
    expect(imports.map((call) => bodyOf(call).dryRun)).toEqual([true, false]);
  });

  it('lists problems by line and column', async () => {
    signedInAs({ permissions: [...MANAGER] });
    mockApi(
      () => ({
        status: 200,
        body: {
          dryRun: true,
          applied: false,
          rows: 1,
          productsCreated: 0,
          variantsCreated: 0,
          variantsUpdated: 0,
          errors: [{ row: 3, column: 'price', message: 'validation.money.too_many_decimals' }],
        },
      }),
      settings,
    );
    renderAt('/products/import');
    await userEvent.upload(
      await screen.findByLabelText('CSV file'),
      new File(['x'], 'bad.csv', { type: 'text/csv' }),
    );
    await userEvent.click(screen.getByRole('button', { name: 'Check file' }));
    const row = (await screen.findByText('Too many decimal places for this currency')).closest(
      'tr',
    )!;
    expect(within(row).getByText('3')).toBeInTheDocument();
    expect(within(row).getByText('price')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Import \d+ rows/ })).not.toBeInTheDocument();
  });
});
