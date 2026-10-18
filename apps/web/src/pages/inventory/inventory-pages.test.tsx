import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { callsTo, mockApi, renderAt, settingsFixture, signedInAs } from '../../test/render';

const PERMS = [
  'tenant.read',
  'settings.read',
  'branches.read',
  'products.read',
  'products.manage',
  'inventory.read',
  'inventory.manage',
  'purchasing.manage',
] as const;

const BRANCH = '33333333-3333-4333-8333-333333333333';
const VARIANT = '77777777-7777-4777-8777-777777777777';
const PRODUCT = '66666666-6666-4666-8666-666666666666';

const branches = {
  items: [
    {
      id: BRANCH,
      code: 'MAIN',
      name: 'Main branch',
      addressLine1: null,
      city: null,
      phone: null,
      status: 'ACTIVE',
      version: 1,
      createdAt: '2026-01-01T00:00:00.000Z',
      registers: [],
    },
  ],
};

const stockRow = {
  variantId: VARIANT,
  productId: PRODUCT,
  productName: 'Cotton Fabric',
  sku: 'COT-W',
  variantLabel: 'White',
  unit: 'metre',
  barcode: null,
  quantity: '4',
  reorderLevel: '10',
  low: true,
  nextExpiry: null,
  batches: [{ batchId: null, batchNumber: null, expiryDate: null, quantity: '4' }],
};

const lookup = {
  product: {
    id: PRODUCT,
    name: 'Cotton Fabric',
    brand: null,
    description: null,
    unit: 'metre',
    categoryId: null,
    categoryName: null,
    taxRateId: null,
    status: 'ACTIVE',
    version: 1,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    variants: [],
  },
  variant: {
    id: VARIANT,
    productId: PRODUCT,
    sku: 'COT-W',
    barcode: '4006381333931',
    attributes: { colour: 'White' },
    priceMinor: 45000,
    costMinor: 30000,
    packSize: null,
    reorderLevel: null,
    status: 'ACTIVE',
    version: 1,
  },
};

const settings = settingsFixture({
  profile: {
    trackBatchNumbers: false,
    trackExpiryDates: false,
    allowFractionalQuantities: true,
    variantAttributes: ['colour'],
    defaultUnits: ['metre'],
  },
});

const bodyOf = (call: unknown[] | undefined) => JSON.parse(String((call?.[1] as RequestInit).body));

describe('Stock page', () => {
  it('shows quantities with units, flags low stock and filters', async () => {
    signedInAs({ permissions: [...PERMS] });
    const fetch = mockApi((url) => {
      if (url.includes('/branches')) return { status: 200, body: branches };
      if (url.includes('/stock/movements')) {
        return {
          status: 200,
          body: {
            items: [
              {
                id: '88888888-8888-4888-8888-888888888888',
                type: 'RECEIPT',
                quantity: '4',
                balanceAfter: '4',
                branchId: BRANCH,
                branchName: 'Main branch',
                variantId: VARIANT,
                productName: 'Cotton Fabric',
                sku: 'COT-W',
                variantLabel: 'White',
                unit: 'metre',
                batchNumber: null,
                referenceType: 'goods_receipt',
                referenceId: '99999999-9999-4999-8999-999999999999',
                referenceNumber: 'GRN-000001',
                unitCostMinor: 30000,
                reason: null,
                actorName: 'Ama',
                createdAt: '2026-10-16T10:00:00.000Z',
              },
            ],
            nextCursor: null,
          },
        };
      }
      return { status: 200, body: { items: [stockRow], nextCursor: null } };
    }, settings);
    renderAt('/inventory');

    expect(await screen.findByText('Cotton Fabric')).toBeInTheDocument();
    expect(screen.getByText('Low')).toBeInTheDocument();
    expect(screen.getByText('Metre')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Low stock' }));
    await waitFor(() => expect(callsTo(fetch, 'filter=LOW')).not.toHaveLength(0));

    await userEvent.click(screen.getByRole('button', { name: 'History' }));
    expect(await screen.findByText(/GRN-000001/)).toBeInTheDocument();
    expect(screen.getByText('+4')).toBeInTheDocument();
  });
});

describe('Receive stock', () => {
  it('adds scanned items with their cost and reuses the document id when retrying', async () => {
    signedInAs({ permissions: [...PERMS] });
    let attempts = 0;
    const fetch = mockApi((url, init) => {
      if (url.includes('/branches')) return { status: 200, body: branches };
      if (url.includes('/suppliers')) return { status: 200, body: { items: [], nextCursor: null } };
      if (url.includes('/purchase-orders'))
        return { status: 200, body: { items: [], nextCursor: null } };
      if (url.includes('/products/lookup')) return { status: 200, body: lookup };
      if (init.method === 'POST' && url.endsWith('/goods-receipts')) {
        attempts += 1;
        if (attempts === 1)
          return { status: 503, body: { error: { code: 'INTERNAL_ERROR', message: 'x' } } };
        const body = JSON.parse(String(init.body));
        return {
          status: 201,
          body: {
            id: body.id,
            number: 'GRN-000007',
            branchId: BRANCH,
            branchName: 'Main branch',
            supplierId: null,
            supplierName: null,
            purchaseOrderId: null,
            purchaseOrderNumber: null,
            supplierReference: null,
            notes: null,
            totalMinor: 75000,
            createdAt: '2026-10-16T10:00:00.000Z',
            createdByName: 'Ama',
            lines: [],
          },
        };
      }
      return { status: 404, body: { error: { code: 'NOT_FOUND', message: 'x' } } };
    }, settings);
    renderAt('/inventory/receive');

    await userEvent.type(await screen.findByLabelText('Add an item'), '4006381333931{Enter}');
    const quantity = await screen.findByLabelText(/^Quantity \(Metre\): Cotton Fabric COT-W/);
    await userEvent.clear(quantity);
    await userEvent.type(quantity, '2.5');
    expect(screen.getByLabelText(/^Unit cost \(LKR\): Cotton Fabric/)).toHaveValue('300.00');

    await userEvent.click(screen.getByRole('button', { name: 'Post receipt' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Something went wrong on our side');
    await userEvent.click(screen.getByRole('button', { name: 'Post receipt' }));
    expect(
      await screen.findByText('Receipt GRN-000007 posted. Stock updated.'),
    ).toBeInTheDocument();

    const posts = callsTo(fetch, '/goods-receipts').filter(
      ([, init]) => (init as RequestInit).method === 'POST',
    );
    expect(posts).toHaveLength(2);
    expect(bodyOf(posts[0]).id).toBe(bodyOf(posts[1]).id);
    expect(bodyOf(posts[1]).lines[0]).toMatchObject({
      variantId: VARIANT,
      quantity: '2.5',
      unitCostMinor: 30000,
    });
  });

  it('shows server errors on the exact line field', async () => {
    signedInAs({ permissions: [...PERMS] });
    mockApi((url, init) => {
      if (url.includes('/branches')) return { status: 200, body: branches };
      if (url.includes('/suppliers') || url.includes('/purchase-orders'))
        return { status: 200, body: { items: [], nextCursor: null } };
      if (url.includes('/products/lookup')) return { status: 200, body: lookup };
      if (init.method === 'POST') {
        return {
          status: 400,
          body: {
            error: {
              code: 'VALIDATION_FAILED',
              message: 'x',
              issues: [{ path: 'lines.0.quantity', message: 'validation.quantity.positive' }],
            },
          },
        };
      }
      return { status: 404 };
    }, settings);
    renderAt('/inventory/receive');
    await userEvent.type(await screen.findByLabelText('Add an item'), 'COT-W{Enter}');
    await userEvent.click(await screen.findByRole('button', { name: 'Post receipt' }));
    const quantity = await screen.findByLabelText(/^Quantity \(Metre\)/);
    await waitFor(() => expect(quantity).toHaveAttribute('aria-invalid', 'true'));
    expect(screen.getByText('Enter a quantity greater than zero')).toBeInTheDocument();
  });
});

describe('Adjust stock', () => {
  it('explains insufficient stock', async () => {
    signedInAs({ permissions: [...PERMS] });
    const fetch = mockApi((url, init) => {
      if (url.includes('/branches')) return { status: 200, body: branches };
      if (url.includes('/products/lookup')) return { status: 200, body: lookup };
      if (init.method === 'POST')
        return { status: 409, body: { error: { code: 'INSUFFICIENT_STOCK', message: 'x' } } };
      return { status: 404 };
    }, settings);
    renderAt('/inventory/adjust');
    await userEvent.type(await screen.findByLabelText('Add an item'), 'COT-W{Enter}');
    expect(await screen.findByLabelText(/^Quantity/)).toHaveValue('-1');
    await userEvent.click(screen.getByRole('button', { name: 'Post adjustment' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Not enough stock for this.');
    const body = bodyOf(callsTo(fetch, '/stock-adjustments')[0]);
    expect(body).toMatchObject({
      branchId: BRANCH,
      reason: 'DAMAGED',
      lines: [{ variantId: VARIANT, quantity: '-1' }],
    });
  });

  it('is not offered to cashiers', async () => {
    signedInAs({
      role: 'CASHIER',
      permissions: [
        'tenant.read',
        'settings.read',
        'branches.read',
        'products.read',
        'inventory.read',
      ],
    });
    mockApi(
      (url) =>
        url.includes('/branches')
          ? { status: 200, body: branches }
          : { status: 200, body: { items: [], nextCursor: null } },
      settings,
    );
    renderAt('/inventory');
    const actions = await screen.findByRole('navigation', { name: 'Inventory' });
    expect(within(actions).queryByRole('link', { name: 'Adjust stock' })).not.toBeInTheDocument();
    expect(within(actions).queryByRole('link', { name: 'Receive stock' })).not.toBeInTheDocument();
  });
});
