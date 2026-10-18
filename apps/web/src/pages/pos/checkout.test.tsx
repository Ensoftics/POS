import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { callsTo, mockApi, renderAt, settingsFixture, signedInAs } from '../../test/render';

const PERMS = [
  'tenant.read',
  'settings.read',
  'settings.update',
  'branches.read',
  'products.read',
  'inventory.read',
  'sales.create',
  'sales.read',
  'sales.discount',
] as const;

const USER = '6f1b2c4e-1c1a-4b7a-9a43-0f1e2d3c4b5a';
const BRANCH = '33333333-3333-4333-8333-333333333333';
const REGISTER = '44444444-4444-4444-8444-444444444444';
const SHIFT = '55555555-5555-4555-8555-555555555555';
const PRODUCT = '66666666-6666-4666-8666-666666666666';
const VARIANT = '77777777-7777-4777-8777-777777777777';
const VAT = '88888888-8888-4888-8888-888888888888';

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
      registers: [
        {
          id: REGISTER,
          branchId: BRANCH,
          code: 'R1',
          name: 'Till 1',
          status: 'ACTIVE',
          version: 1,
          createdAt: '2026-01-01T00:00:00.000Z',
        },
      ],
    },
  ],
};

const summary = {
  saleCount: 0,
  salesTotalMinor: 0,
  discountMinor: 0,
  taxMinor: 0,
  payments: [],
  cashReceivedMinor: 0,
  changeGivenMinor: 0,
  returnCount: 0,
  refundsTotalMinor: 0,
  refunds: [],
  cashRefundedMinor: 0,
  payInMinor: 0,
  payOutMinor: 0,
  collectionsMinor: 0,
  collectionsCashMinor: 0,
  expectedCashMinor: 500_000,
};

const shift = (overrides: Record<string, unknown> = {}) => ({
  id: SHIFT,
  number: 'SHF-000001',
  status: 'OPEN',
  branchId: BRANCH,
  branchName: 'Main branch',
  registerId: REGISTER,
  registerName: 'Till 1',
  openingFloatMinor: 500_000,
  openedAt: '2026-10-16T08:00:00.000Z',
  openedById: USER,
  openedByName: 'Ama Silva',
  closedAt: null,
  closedByName: null,
  expectedCashMinor: null,
  countedCashMinor: null,
  differenceMinor: null,
  closingNotes: null,
  version: 1,
  summary,
  cashMovements: [],
  ...overrides,
});

const lookup = (priceMinor = 118_000) => ({
  product: {
    id: PRODUCT,
    name: 'Herbal Soap',
    brand: null,
    description: null,
    unit: 'piece',
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
    sku: 'SOAP-1',
    barcode: '4006381333931',
    attributes: {},
    priceMinor,
    costMinor: null,
    packSize: null,
    reorderLevel: null,
    status: 'ACTIVE',
    version: 1,
  },
});

const taxRates = {
  items: [{ id: VAT, name: 'VAT', rateBp: 1800, isDefault: true, status: 'ACTIVE', version: 1 }],
};

const sale = {
  id: '99999999-9999-4999-8999-999999999999',
  number: 'INV-000001',
  status: 'COMPLETED',
  branchId: BRANCH,
  branchName: 'Main branch',
  registerId: REGISTER,
  registerName: 'Till 1',
  shiftId: SHIFT,
  shiftNumber: 'SHF-000001',
  cashierName: 'Ama Silva',
  customerId: null,
  customerName: null,
  currency: 'LKR',
  pricesIncludeTax: true,
  discount: null,
  subtotalMinor: 236_000,
  discountMinor: 0,
  taxMinor: 36_000,
  totalMinor: 236_000,
  paidMinor: 250_000,
  changeMinor: 14_000,
  notes: null,
  createdAt: '2026-10-16T09:00:00.000Z',
  lines: [
    {
      id: '12121212-1212-4121-8121-121212121212',
      variantId: VARIANT,
      productName: 'Herbal Soap',
      sku: 'SOAP-1',
      variantLabel: '',
      unit: 'piece',
      quantity: '2',
      unitPriceMinor: 118_000,
      grossMinor: 236_000,
      discount: null,
      lineDiscountMinor: 0,
      cartDiscountMinor: 0,
      taxName: 'VAT',
      taxRateBp: 1800,
      taxMinor: 36_000,
      totalMinor: 236_000,
      returnedQuantity: '0',
      refundedMinor: 0,
      refundedTaxMinor: 0,
    },
  ],
  payments: [{ method: 'CASH', amountMinor: 250_000, reference: null }],
  taxSummary: [{ name: 'VAT', rateBp: 1800, taxableMinor: 200_000, taxMinor: 36_000 }],
  approvedByName: null,
  returnStatus: 'NONE',
  capturedOffline: false,
  syncedAt: null,
  conflicts: [],
  voided: false,
  refundedMinor: 0,
  refundable: [],
  returns: [],
};

const receipt = {
  business: {
    name: 'Lotus Cosmetics',
    legalName: null,
    taxRegistrationNumber: '123456789-7000',
    addressLines: ['12 Galle Road', 'Colombo'],
    branchName: 'Main branch',
    branchAddress: null,
    branchPhone: null,
    footer: 'Thank you!',
    timezone: 'Asia/Colombo',
  },
  sale,
};

const bodyOf = (call: unknown[] | undefined) => JSON.parse(String((call?.[1] as RequestInit).body));
const posts = (fetch: ReturnType<typeof mockApi>, path: string) =>
  callsTo(fetch, path).filter(([, init]) => (init as RequestInit).method === 'POST');

/** Routes shared by the checkout tests; `onSale` decides each POST /sales answer. */
function routes(options: {
  current?: () => unknown;
  onSale?: (attempt: number) => { status: number; body?: unknown };
  price?: () => number;
}) {
  let saleAttempts = 0;
  return (url: string, init: RequestInit) => {
    const method = init.method ?? 'GET';
    if (url.includes('/branches')) return { status: 200, body: branches };
    if (url.includes('/tax-rates')) return { status: 200, body: taxRates };
    if (url.includes('/shifts/current'))
      return { status: 200, body: { shift: options.current ? options.current() : shift() } };
    if (url.endsWith('/shifts') && method === 'POST') return { status: 201, body: shift() };
    if (url.includes('/products/lookup'))
      return { status: 200, body: lookup(options.price ? options.price() : 118_000) };
    if (url.includes('/receipt')) return { status: 200, body: receipt };
    if (url.endsWith('/sales') && method === 'POST') {
      saleAttempts += 1;
      return options.onSale ? options.onSale(saleAttempts) : { status: 201, body: sale };
    }
    return { status: 404, body: { error: { code: 'NOT_FOUND', message: url } } };
  };
}

async function scanSoapTwice() {
  const scan = await screen.findByLabelText('Scan or search items');
  await userEvent.type(scan, '4006381333931{Enter}');
  await screen.findByText('Herbal Soap');
  await userEvent.type(scan, '4006381333931{Enter}');
  await waitFor(() => expect(screen.getByLabelText('Quantity for Herbal Soap')).toHaveValue('2'));
}

describe('Checkout', () => {
  beforeEach(() => {
    sessionStorage.clear();
    localStorage.clear();
  });

  it('opens a shift with a float when none is open', async () => {
    signedInAs({ permissions: [...PERMS] });
    let open = false;
    const fetch = mockApi(routes({ current: () => (open ? shift() : null) }));
    renderAt('/pos');

    await userEvent.type(await screen.findByLabelText(/Opening cash in drawer/), '5000');
    open = true;
    await userEvent.click(screen.getByRole('button', { name: 'Open shift' }));
    expect(bodyOf(posts(fetch, '/shifts')[0])).toEqual({
      registerId: REGISTER,
      openingFloatMinor: 500_000,
    });
    expect(await screen.findByLabelText('Scan or search items')).toBeInTheDocument();
  });

  it('scans items, takes cash with change and shows the receipt', async () => {
    signedInAs({ permissions: [...PERMS] });
    const fetch = mockApi(routes({}));
    renderAt('/pos');

    await scanSoapTwice();
    // 2 × 1,180.00 with 18 % VAT included.
    expect(screen.getByTestId('cart-total')).toHaveTextContent('2,360.00');
    expect(screen.getByText('Tax included').nextSibling).toHaveTextContent('360.00');

    const complete = screen.getByRole('button', { name: /Complete sale/ });
    expect(complete).toBeDisabled();
    await userEvent.type(screen.getByLabelText(/^Amount/), '2500');
    expect(screen.getByTestId('change-due')).toHaveTextContent('140.00');
    await userEvent.click(complete);

    expect(await screen.findByText('Sale INV-000001 completed')).toBeInTheDocument();
    expect(screen.getByTestId('sale-change')).toHaveTextContent('140.00');
    expect(screen.getByText('Thank you!')).toBeInTheDocument();
    expect(screen.getByText('Tax reg. no. 123456789-7000')).toBeInTheDocument();
    const body = bodyOf(posts(fetch, '/sales')[0]);
    expect(body).toMatchObject({
      shiftId: SHIFT,
      lines: [{ variantId: VARIANT, quantity: '2', discount: null }],
      payments: [{ method: 'CASH', amountMinor: 250_000, reference: null }],
      expectedTotalMinor: 236_000,
    });
    expect(body.id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('counts every scan when a scanner sends codes faster than lookups return', async () => {
    signedInAs({ permissions: [...PERMS] });
    mockApi(routes({}));
    renderAt('/pos');
    const scan = await screen.findByLabelText('Scan or search items');
    // No waiting between scans: all three lookups are in flight together.
    for (let i = 0; i < 3; i += 1) await userEvent.type(scan, '4006381333931{Enter}');
    await waitFor(() => expect(screen.getByLabelText('Quantity for Herbal Soap')).toHaveValue('3'));
  });

  it('saves the sale on the device when the server cannot be reached, and sends it later with the same id', async () => {
    signedInAs({ permissions: [...PERMS] });
    const fetch = mockApi(
      routes({
        onSale: (attempt) =>
          attempt === 1
            ? { status: 503, body: { error: { code: 'INTERNAL_ERROR', message: 'down' } } }
            : { status: 200, body: sale },
      }),
    );
    renderAt('/pos');
    await scanSoapTwice();
    await userEvent.click(screen.getByRole('button', { name: 'Exact' }));
    await userEvent.click(screen.getByRole('button', { name: /Complete sale/ }));

    expect(await screen.findByText('Sale saved on this device')).toBeInTheDocument();
    // The local receipt is complete; only its number waits for the sync.
    expect(screen.getByText('Pending (offline)')).toBeInTheDocument();
    expect(screen.getByRole('article', { name: 'Receipt' })).toHaveTextContent('2,360.00');
    expect(await screen.findByText(/1 sale\(s\) saved on this device/)).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Send now' }));
    await waitFor(() => expect(screen.queryByText(/saved on this device will be sent/)).toBeNull());
    const [first, second] = posts(fetch, '/sales');
    expect(bodyOf(second)).toMatchObject({
      id: bodyOf(first).id,
      expectedTotalMinor: 236_000,
      offline: {
        pricesIncludeTax: true,
        lines: [{ unitPriceMinor: 118_000, taxRateBp: 1800 }],
      },
    });
  });

  it('keeps scanning from the local catalogue copy when the connection drops', async () => {
    signedInAs({ permissions: [...PERMS] });
    let down = false;
    const base = routes({ onSale: () => ({ status: 201, body: sale }) });
    const fetchMock = mockApi((url, init) => {
      if (url.includes('/sync/catalog'))
        return {
          status: 200,
          body: {
            items: [
              {
                variantId: VARIANT,
                productId: PRODUCT,
                productName: 'Herbal Soap',
                brand: null,
                sku: 'SOAP-1',
                barcode: '4006381333931',
                variantLabel: '',
                unit: 'piece',
                priceMinor: 118_000,
                taxRateId: null,
                active: true,
              },
            ],
            cursor: 'c1',
            hasMore: false,
          },
        };
      if (down && url.includes('/products/lookup')) throw new TypeError('Failed to fetch');
      return base(url, init);
    });
    renderAt('/pos');
    const scan = await screen.findByLabelText('Scan or search items');
    // The engine asks for tax rates only after storing the catalogue (the till asks once too):
    // a second request means the local copy is ready. Then the connection drops.
    await waitFor(() => expect(callsTo(fetchMock, '/tax-rates').length).toBeGreaterThanOrEqual(2));
    down = true;
    await userEvent.type(scan, '4006381333931{Enter}');
    expect(await screen.findByText('Herbal Soap')).toBeInTheDocument();
    expect(screen.getByTestId('cart-total')).toHaveTextContent('1,180.00');
  });

  it('reprices the cart when the server reports changed prices', async () => {
    signedInAs({ permissions: [...PERMS] });
    let price = 118_000;
    mockApi(
      routes({
        price: () => price,
        onSale: () => ({
          status: 409,
          body: { error: { code: 'TOTAL_MISMATCH', message: 'changed' } },
        }),
      }),
    );
    renderAt('/pos');
    await scanSoapTwice();
    await userEvent.click(screen.getByRole('button', { name: 'Exact' }));
    price = 120_000;
    await userEvent.click(screen.getByRole('button', { name: /Complete sale/ }));
    expect(await screen.findByText(/cart was updated/)).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId('cart-total')).toHaveTextContent('2,400.00'));
  });

  it('applies line and sale discounts and blocks oversized ones', async () => {
    signedInAs({ permissions: [...PERMS] });
    const fetch = mockApi(routes({}));
    renderAt('/pos');
    await scanSoapTwice();
    await userEvent.click(screen.getByRole('button', { name: 'Discount for Herbal Soap' }));
    await userEvent.type(screen.getByRole('textbox', { name: 'Discount for Herbal Soap' }), '10');
    // 2,360.00 − 10 % = 2,124.00
    expect(screen.getByTestId('cart-total')).toHaveTextContent('2,124.00');

    const saleDiscount = screen.getByRole('textbox', { name: 'Sale discount' });
    await userEvent.selectOptions(
      screen.getByRole('combobox', { name: 'Sale discount: Discount' }),
      'AMOUNT',
    );
    await userEvent.type(saleDiscount, '5000');
    expect(screen.getByText('The discount is larger than the sale amount')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Complete sale/ })).toBeDisabled();
    await userEvent.clear(saleDiscount);
    await userEvent.type(saleDiscount, '24');
    expect(screen.getByTestId('cart-total')).toHaveTextContent('2,100.00');
    await userEvent.click(screen.getByRole('button', { name: 'Exact' }));
    await userEvent.click(screen.getByRole('button', { name: /Complete sale/ }));
    await screen.findByText('Sale INV-000001 completed');
    expect(bodyOf(posts(fetch, '/sales')[0])).toMatchObject({
      discount: { kind: 'AMOUNT', value: 2_400 },
      lines: [{ discount: { kind: 'PERCENT', value: 1000 } }],
      expectedTotalMinor: 210_000,
    });
  });

  it('asks a manager to approve a discount above the limit and resubmits the same sale', async () => {
    signedInAs({ permissions: [...PERMS] });
    const MANAGER = 'abababab-abab-4bab-8bab-abababababab';
    const base = routes({
      onSale: (attempt) =>
        attempt === 1
          ? { status: 403, body: { error: { code: 'APPROVAL_REQUIRED', message: 'x' } } }
          : { status: 201, body: sale },
    });
    const fetch = mockApi((url, init) => {
      if (url.includes('/approvers'))
        return {
          status: 200,
          body: { items: [{ userId: MANAGER, fullName: 'Kamal Perera', role: 'MANAGER' }] },
        };
      return base(url, init);
    });
    renderAt('/pos');
    await scanSoapTwice();
    await userEvent.type(screen.getByRole('textbox', { name: 'Sale discount' }), '50');
    await userEvent.click(screen.getByRole('button', { name: 'Exact' }));
    await userEvent.click(screen.getByRole('button', { name: /Complete sale/ }));
    expect(await screen.findByRole('dialog', { name: 'Manager approval' })).toHaveTextContent(
      'above the limit',
    );
    await userEvent.type(screen.getByLabelText('Manager’s PIN'), '2468');
    await userEvent.click(screen.getByRole('button', { name: 'Approve' }));
    expect(await screen.findByText('Sale INV-000001 completed')).toBeInTheDocument();
    const [first, second] = posts(fetch, '/sales');
    expect(bodyOf(second)).toMatchObject({
      id: bodyOf(first).id,
      approval: { approverId: MANAGER, pin: '2468' },
    });
  });

  it('attaches a customer found by phone and charges the sale to their account', async () => {
    signedInAs({ permissions: [...PERMS, 'customers.read', 'customers.manage'] });
    const CUSTOMER = 'c0c0c0c0-c0c0-4c0c-8c0c-c0c0c0c0c0c0';
    const nimali = {
      id: CUSTOMER,
      number: 'CUS-000001',
      name: 'Nimali Perera',
      phone: '+94771234567',
      email: null,
      address: null,
      notes: null,
      marketingConsent: false,
      marketingConsentAt: null,
      creditLimitMinor: 500_000,
      balanceMinor: 0,
      availableCreditMinor: 500_000,
      status: 'ACTIVE',
      version: 1,
      createdAt: '2026-10-17T08:00:00.000Z',
    };
    const base = routes({});
    const fetch = mockApi((url, init) => {
      if (url.includes('/customers'))
        return { status: 200, body: { items: [nimali], nextCursor: null } };
      return base(url, init);
    });
    renderAt('/pos');
    await scanSoapTwice();
    // ACCOUNT is not offered without a customer.
    expect(
      within(screen.getByLabelText('Method')).queryByRole('option', { name: 'On account' }),
    ).toBeNull();
    await userEvent.type(screen.getByLabelText('Customer'), '0771234567');
    await userEvent.click(await screen.findByRole('button', { name: /Nimali Perera/ }));
    expect(screen.getByTestId('attached-customer')).toHaveTextContent(
      'On account available: LKR 5,000.00',
    );
    await userEvent.selectOptions(screen.getByLabelText('Method'), 'ACCOUNT');
    await userEvent.click(screen.getByRole('button', { name: 'Exact' }));
    await userEvent.click(screen.getByRole('button', { name: /Complete sale/ }));
    await screen.findByText('Sale INV-000001 completed');
    expect(bodyOf(posts(fetch, '/sales')[0])).toMatchObject({
      customerId: CUSTOMER,
      payments: [{ method: 'ACCOUNT', amountMinor: 236_000 }],
    });
  });

  it('hides discounts from staff without the permission', async () => {
    signedInAs({ permissions: PERMS.filter((p) => p !== 'sales.discount') });
    mockApi(routes({}));
    renderAt('/pos');
    await scanSoapTwice();
    expect(screen.queryByRole('button', { name: 'Discount for Herbal Soap' })).toBeNull();
    expect(screen.queryByRole('textbox', { name: 'Sale discount' })).toBeNull();
  });

  it("does not let a cashier sell on someone else's shift", async () => {
    signedInAs({ permissions: [...PERMS] });
    mockApi(routes({ current: () => shift({ openedById: VAT, openedByName: 'Kamal Perera' }) }));
    renderAt('/pos');
    expect(await screen.findByText(/belongs to Kamal Perera/)).toBeInTheDocument();
    expect(screen.queryByLabelText('Scan or search items')).toBeNull();
  });

  it('closes the shift with counted cash and shows the difference', async () => {
    signedInAs({ permissions: [...PERMS] });
    const fetch = mockApi((url, init) => {
      if (url.includes('/close'))
        return {
          status: 200,
          body: shift({
            status: 'CLOSED',
            closedAt: '2026-10-16T18:00:00.000Z',
            expectedCashMinor: 500_000,
            countedCashMinor: 499_000,
            differenceMinor: -1_000,
            version: 2,
          }),
        };
      return routes({})(url, init);
    });
    renderAt('/pos');
    await userEvent.click(await screen.findByRole('button', { name: 'Close shift' }));
    await userEvent.type(screen.getByLabelText(/Cash counted in drawer/), '4990');
    expect(screen.getByText(/Short/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Close shift' }));
    expect(await screen.findByText('Shift SHF-000001 closed.')).toBeInTheDocument();
    expect(bodyOf(posts(fetch, '/close')[0])).toEqual({
      version: 1,
      countedCashMinor: 499_000,
      notes: '',
    });
  });
});

describe('Taxes & checkout settings', () => {
  it('adds a tax rate and saves till options', async () => {
    signedInAs({ permissions: [...PERMS] });
    let saved: unknown = null;
    const fetch = mockApi((url, init) => {
      if (url.includes('/tax-rates') && init.method === 'POST')
        return { status: 201, body: taxRates.items[0] };
      if (url.includes('/tax-rates')) return { status: 200, body: { items: [] } };
      if (url.endsWith('/settings') && init.method === 'PATCH') {
        saved = JSON.parse(String(init.body));
        return { status: 200, body: settingsFixture({ version: 4 }) };
      }
      return { status: 404 };
    });
    renderAt('/settings/checkout');
    await userEvent.click(await screen.findByRole('button', { name: 'Add tax rate' }));
    await userEvent.type(screen.getByLabelText('Name'), 'VAT');
    await userEvent.type(screen.getByLabelText('Rate (%)'), '18.5');
    await userEvent.click(screen.getByLabelText('Default for products'));
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await screen.findByText('Tax rate added.');
    expect(bodyOf(posts(fetch, '/tax-rates')[0])).toEqual({
      name: 'VAT',
      rateBp: 1850,
      isDefault: true,
    });

    await userEvent.click(screen.getByLabelText('Allow selling more than recorded stock'));
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() =>
      expect(saved).toMatchObject({
        version: 3,
        checkout: { pricesIncludeTax: true, allowNegativeStock: true },
      }),
    );
  });
});

describe('Approval PIN', () => {
  it('lets a manager set their PIN after confirming their password', async () => {
    signedInAs({ permissions: [...PERMS, 'approvals.grant'] });
    let hasPin = false;
    const fetch = mockApi((url, init) => {
      if (url.includes('/tax-rates')) return { status: 200, body: { items: [] } };
      if (url.includes('/me/approval-pin') && init.method === 'PUT') {
        hasPin = true;
        return { status: 204 };
      }
      if (url.includes('/me/approval-pin')) return { status: 200, body: { hasPin } };
      return { status: 404 };
    });
    renderAt('/settings/checkout');
    expect(await screen.findByText(/No PIN yet/)).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('New PIN'), '12ab34');
    await userEvent.type(screen.getByLabelText('Your password'), 'blue-mango-river-42');
    await userEvent.click(screen.getByRole('button', { name: 'Save PIN' }));
    expect(await screen.findByText('Approval PIN saved.')).toBeInTheDocument();
    expect(screen.getByText('A PIN is set.')).toBeInTheDocument();
    const put = callsTo(fetch, '/me/approval-pin').find(
      ([, init]) => (init as RequestInit).method === 'PUT',
    );
    // Letters are dropped while typing; only digits are sent.
    expect(bodyOf(put)).toEqual({ currentPassword: 'blue-mango-river-42', pin: '1234' });
  });
});

describe('Checkout with loyalty points', () => {
  beforeEach(() => {
    sessionStorage.clear();
    localStorage.clear();
  });

  const CUSTOMER = 'c0c0c0c0-c0c0-4c0c-8c0c-c0c0c0c0c0c0';
  const nimali = {
    id: CUSTOMER,
    number: 'CUS-000001',
    name: 'Nimali Perera',
    phone: '+94771234567',
    email: null,
    address: null,
    notes: null,
    marketingConsent: false,
    marketingConsentAt: null,
    creditLimitMinor: 0,
    balanceMinor: 0,
    availableCreditMinor: 0,
    loyaltyPoints: 500,
    status: 'ACTIVE',
    version: 1,
    createdAt: '2026-10-17T08:00:00.000Z',
  };
  const loyaltyOn = settingsFixture({
    loyalty: {
      enabled: true,
      spendPerPointMinor: 10_000,
      pointValueMinor: 100,
      minRedeemPoints: 10,
    },
  });

  async function attachNimali() {
    await scanSoapTwice();
    await userEvent.type(screen.getByLabelText('Customer'), '0771234567');
    await userEvent.click(await screen.findByRole('button', { name: /Nimali Perera/ }));
  }

  it('pays part of the sale with points in one tap', async () => {
    signedInAs({ permissions: [...PERMS, 'customers.read'], features: ['loyalty'] });
    const base = routes({});
    const fetch = mockApi((url, init) => {
      if (url.includes('/customers'))
        return { status: 200, body: { items: [nimali], nextCursor: null } };
      return base(url, init);
    }, loyaltyOn);
    renderAt('/pos');
    // Points are not offered before a customer is attached.
    await scanSoapTwice();
    expect(
      within(screen.getByLabelText('Method')).queryByRole('option', { name: 'Points' }),
    ).toBeNull();
    await userEvent.type(screen.getByLabelText('Customer'), '0771234567');
    await userEvent.click(await screen.findByRole('button', { name: /Nimali Perera/ }));

    expect(screen.getByText(/500 points · worth LKR\s500\.00/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /Use LKR\s500\.00 in points/ }));
    await userEvent.click(screen.getAllByRole('button', { name: 'Exact' })[1]!);
    await userEvent.click(screen.getByRole('button', { name: /Complete sale/ }));
    await screen.findByText('Sale INV-000001 completed');
    expect(bodyOf(posts(fetch, '/sales')[0])).toMatchObject({
      customerId: CUSTOMER,
      payments: [
        { method: 'LOYALTY', amountMinor: 50_000 },
        { method: 'CASH', amountMinor: 186_000 },
      ],
    });
  });

  it('does not save a points payment on the device when offline', async () => {
    signedInAs({ permissions: [...PERMS, 'customers.read'], features: ['loyalty'] });
    const base = routes({});
    mockApi((url, init) => {
      if (url.includes('/customers'))
        return { status: 200, body: { items: [nimali], nextCursor: null } };
      if (url.endsWith('/sales') && init.method === 'POST') throw new TypeError('Failed to fetch');
      return base(url, init);
    }, loyaltyOn);
    renderAt('/pos');
    await attachNimali();
    await userEvent.click(screen.getByRole('button', { name: /Use LKR\s500\.00 in points/ }));
    await userEvent.click(screen.getAllByRole('button', { name: 'Exact' })[1]!);
    await userEvent.click(screen.getByRole('button', { name: /Complete sale/ }));
    expect(
      await screen.findByText(/Points can only be used while the till is online/),
    ).toBeInTheDocument();
    expect(screen.queryByText('Sale saved on this device')).toBeNull();
  });

  it('offers no points when the business has loyalty off', async () => {
    signedInAs({ permissions: [...PERMS, 'customers.read'], features: [] });
    const base = routes({});
    mockApi((url, init) => {
      if (url.includes('/customers'))
        return { status: 200, body: { items: [nimali], nextCursor: null } };
      return base(url, init);
    }, loyaltyOn);
    renderAt('/pos');
    await attachNimali();
    expect(screen.queryByText(/500 points/)).toBeNull();
    expect(
      within(screen.getByLabelText('Method')).queryByRole('option', { name: 'Points' }),
    ).toBeNull();
  });
});
