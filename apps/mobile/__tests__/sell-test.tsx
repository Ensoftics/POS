import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import '@/lib/i18n';
import SellScreen from '@/app/(app)/sell';
import { cartStore, scanBus } from '@/lib/checkout';
import { saveDeviceRegister } from '@/lib/device-register';
import { fromBase64, toBase64 } from '@/lib/printing/escpos';
import { savePrinter } from '@/lib/printing/printer-store';
import { encode } from 'fast-png';
import { captureRef } from 'react-native-view-shot';
import { sessionStore } from '@/lib/session';
import { mobileSession, respond, secureStoreMap } from '../test/fixtures';

const mockPush = jest.fn();
jest.mock('expo-router', () => ({
  router: { push: (href: unknown) => mockPush(href), back: jest.fn() },
  Redirect: () => null,
}));

const USER = mobileSession().user.id;
const BRANCH = '33333333-3333-4333-8333-333333333333';
const REGISTER = '44444444-4444-4444-8444-444444444444';
const SHIFT = '55555555-5555-4555-8555-555555555555';
const VARIANT = '77777777-7777-4777-8777-777777777777';
const PRODUCT = '66666666-6666-4666-8666-666666666666';

const settings = {
  version: 1,
  legalName: null,
  taxRegistrationNumber: null,
  addressLine1: null,
  addressLine2: null,
  city: null,
  postalCode: null,
  country: 'LK',
  currency: 'LKR',
  timezone: 'Asia/Colombo',
  defaultLanguage: 'en',
  enabledLanguages: ['en'],
  profile: {
    trackBatchNumbers: false,
    trackExpiryDates: false,
    allowFractionalQuantities: false,
    variantAttributes: [],
    defaultUnits: ['piece'],
  },
  checkout: {
    pricesIncludeTax: false,
    allowNegativeStock: false,
    receiptFooter: 'Come again',
    discountApprovalBp: null,
    refundsRequireApproval: true,
  },
  updatedAt: '2026-01-01T00:00:00.000Z',
};

const shift = {
  id: SHIFT,
  number: 'SHF-000003',
  status: 'OPEN',
  branchId: BRANCH,
  branchName: 'Main',
  registerId: REGISTER,
  registerName: 'Till 1',
  openingFloatMinor: 100_000,
  openedAt: '2026-10-16T08:00:00.000Z',
  openedById: USER,
  openedByName: 'Kasun Fernando',
  closedAt: null,
  closedByName: null,
  expectedCashMinor: null,
  countedCashMinor: null,
  differenceMinor: null,
  closingNotes: null,
  version: 1,
  summary: {
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
    expectedCashMinor: 100_000,
  },
  cashMovements: [],
};

const variant = {
  id: VARIANT,
  productId: PRODUCT,
  sku: 'SAREE-1',
  barcode: '4006381333931',
  attributes: {},
  priceMinor: 1_000_000,
  costMinor: null,
  packSize: null,
  reorderLevel: null,
  status: 'ACTIVE',
  version: 1,
};
const lookup = {
  variant,
  product: {
    id: PRODUCT,
    name: 'Silk Saree',
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
    variants: [variant],
  },
};

const sale = {
  id: '99999999-9999-4999-8999-999999999999',
  number: 'INV-000042',
  status: 'COMPLETED',
  branchId: BRANCH,
  branchName: 'Main',
  registerId: REGISTER,
  registerName: 'Till 1',
  shiftId: SHIFT,
  shiftNumber: 'SHF-000003',
  cashierName: 'Kasun Fernando',
  customerId: null,
  customerName: null,
  currency: 'LKR',
  pricesIncludeTax: false,
  discount: null,
  subtotalMinor: 1_000_000,
  discountMinor: 0,
  taxMinor: 180_000,
  totalMinor: 1_180_000,
  paidMinor: 1_200_000,
  changeMinor: 20_000,
  notes: null,
  createdAt: '2026-10-16T09:00:00.000Z',
  lines: [
    {
      id: '12121212-1212-4121-8121-121212121212',
      variantId: VARIANT,
      productName: 'Silk Saree',
      sku: 'SAREE-1',
      variantLabel: '',
      unit: 'piece',
      quantity: '1',
      unitPriceMinor: 1_000_000,
      grossMinor: 1_000_000,
      discount: null,
      lineDiscountMinor: 0,
      cartDiscountMinor: 0,
      taxName: 'VAT',
      taxRateBp: 1800,
      taxMinor: 180_000,
      totalMinor: 1_180_000,
      returnedQuantity: '0',
      refundedMinor: 0,
      refundedTaxMinor: 0,
    },
  ],
  payments: [{ method: 'CASH', amountMinor: 1_200_000, reference: null }],
  taxSummary: [{ name: 'VAT', rateBp: 1800, taxableMinor: 1_000_000, taxMinor: 180_000 }],
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

const PERMS = ['tenant.read', 'settings.read', 'products.read', 'sales.create', 'sales.read'];

describe('sell screen', () => {
  const fetchMock = jest.fn();
  let saleResponses: Array<() => Response>;

  beforeEach(async () => {
    secureStoreMap().clear();
    fetchMock.mockReset();
    mockPush.mockReset();
    cartStore.reset();
    saleResponses = [];
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    await sessionStore.applySession({ ...mobileSession(), permissions: PERMS as never });
    await saveDeviceRegister(mobileSession().tenant.id, {
      branchId: BRANCH,
      branchCode: 'MAIN',
      branchName: 'Main',
      registerId: REGISTER,
      registerCode: 'R1',
      registerName: 'Till 1',
    });
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url.includes('/tax-rates'))
        return respond(200, {
          items: [
            {
              id: '88888888-8888-4888-8888-888888888888',
              name: 'VAT',
              rateBp: 1800,
              isDefault: true,
              status: 'ACTIVE',
              version: 1,
            },
          ],
        });
      if (url.includes('/shifts/current')) return respond(200, { shift });
      if (url.includes('/products/lookup')) return respond(200, lookup);
      if (url.includes('/receipt'))
        return respond(200, {
          business: {
            name: 'Nimal Textiles',
            legalName: null,
            taxRegistrationNumber: null,
            addressLines: [],
            branchName: 'Main',
            branchAddress: null,
            branchPhone: null,
            footer: 'Come again',
            timezone: 'Asia/Colombo',
          },
          sale,
        });
      if (url.endsWith('/sales') && init?.method === 'POST')
        return (saleResponses.shift() ?? (() => respond(201, sale)))();
      return respond(200, settings);
    });
  });

  const salePosts = () =>
    fetchMock.mock.calls.filter(
      ([url, init]) => String(url).endsWith('/sales') && (init as RequestInit).method === 'POST',
    );

  async function scanOne() {
    const field = await screen.findByLabelText('Barcode or SKU');
    await fireEvent.changeText(field, '4006381333931');
    await fireEvent(field, 'submitEditing');
    await screen.findByText('Silk Saree');
  }

  it('adds scanned items, adds tax on top and completes a cash sale with change', async () => {
    await render(<SellScreen />);
    await scanOne();
    // Prices exclude tax in this business: 10,000.00 + 18 %.
    expect(screen.getByTestId('cart-total')).toHaveTextContent(/11,800\.00/);
    await fireEvent.press(screen.getByRole('button', { name: /^Pay/ }));
    await fireEvent.changeText(screen.getByLabelText('Amount (LKR)'), '12000');
    expect(screen.getByText(/Change: .*200\.00/)).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'Complete sale' }));

    expect(await screen.findByText('Sale INV-000042 completed')).toBeOnTheScreen();
    expect(screen.getByTestId('sale-change')).toHaveTextContent(/200\.00/);
    expect(screen.getByText('Come again')).toBeOnTheScreen();
    const body = JSON.parse(String((salePosts()[0]![1] as RequestInit).body));
    expect(body).toMatchObject({
      shiftId: SHIFT,
      lines: [{ variantId: VARIANT, quantity: '1' }],
      payments: [{ method: 'CASH', amountMinor: 1_200_000, reference: null }],
      expectedTotalMinor: 1_180_000,
    });
    // The next sale gets a new id.
    expect(cartStore.get().saleId).not.toBe(body.id);
  });

  it('prints the receipt on the saved Bluetooth printer', async () => {
    const write = jest.fn(async () => undefined);
    const device = {
      mtu: 185,
      writeCharacteristicWithoutResponseForService: write,
      discoverAllServicesAndCharacteristics: async () => device,
    };
    const ble = jest.requireMock('react-native-ble-plx').__manager;
    ble.connectToDevice.mockResolvedValue(device);
    const white = new Uint8Array(384 * 40 * 4).fill(255);
    jest
      .mocked(captureRef)
      .mockResolvedValue(toBase64(encode({ width: 384, height: 40, channels: 4, data: white })));
    await savePrinter({
      id: 'AA:BB:CC:DD:EE:FF',
      name: 'MTP-II',
      serviceUUID: '000018f0-0000-1000-8000-00805f9b34fb',
      characteristicUUID: '00002af1-0000-1000-8000-00805f9b34fb',
      withResponse: false,
      paperWidth: 58,
      autoPrint: false,
    });

    await render(<SellScreen />);
    await scanOne();
    await fireEvent.press(screen.getByRole('button', { name: /^Pay/ }));
    await fireEvent.changeText(screen.getByLabelText('Amount (LKR)'), '11800');
    await fireEvent.press(screen.getByRole('button', { name: 'Complete sale' }));
    await screen.findByText('Sale INV-000042 completed');
    await fireEvent(
      screen.getByTestId('printable-receipt', { includeHiddenElements: true }),
      'layout',
      { nativeEvent: { layout: { x: 0, y: 0, width: 300, height: 600 } } },
    );
    await fireEvent.press(screen.getByRole('button', { name: 'Print receipt' }));

    expect(await screen.findByText('Receipt sent to the printer.')).toBeOnTheScreen();
    // Scaled to the 58 mm paper: 384 dots wide, height in proportion.
    expect(jest.mocked(captureRef).mock.calls[0]![1]).toMatchObject({
      format: 'png',
      result: 'base64',
      width: 384,
      height: 768,
    });
    expect(ble.connectToDevice).toHaveBeenCalledWith('AA:BB:CC:DD:EE:FF', expect.anything());
    const [service, characteristic, first] = write.mock.calls[0] as unknown as string[];
    expect([service, characteristic]).toEqual([
      '000018f0-0000-1000-8000-00805f9b34fb',
      '00002af1-0000-1000-8000-00805f9b34fb',
    ]);
    expect(Array.from(fromBase64(first!).subarray(0, 2))).toEqual([0x1b, 0x40]);
    expect(ble.cancelDeviceConnection).toHaveBeenCalledWith('AA:BB:CC:DD:EE:FF');
  });

  it('adds codes read by the camera and changes quantities with the steppers', async () => {
    await render(<SellScreen />);
    await fireEvent.press(await screen.findByRole('button', { name: 'Scan with camera' }));
    expect(mockPush).toHaveBeenCalledWith('/scan');
    await act(async () => {
      scanBus.publish('4006381333931');
    });
    await screen.findByText('Silk Saree');
    await fireEvent.press(screen.getByRole('button', { name: 'Increase Silk Saree' }));
    expect(screen.getByLabelText('Quantity for Silk Saree')).toHaveTextContent('2');
    await fireEvent.press(screen.getByRole('button', { name: 'Decrease Silk Saree' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Decrease Silk Saree' }));
    expect(screen.queryByText('Silk Saree')).toBeNull();
  });

  it('saves the sale on the device when the server is unreachable and sends it later', async () => {
    saleResponses.push(() => respond(503, { error: { code: 'INTERNAL_ERROR', message: 'x' } }));
    await render(<SellScreen />);
    await scanOne();
    await fireEvent.press(screen.getByRole('button', { name: /^Pay/ }));
    await fireEvent.press(screen.getByRole('button', { name: 'Exact' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Complete sale' }));
    expect(await screen.findByText(/Sale saved on this device/)).toBeOnTheScreen();
    expect(screen.getByText(/Pending \(offline\)/)).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'New sale' }));
    expect(await screen.findByText(/1 sale\(s\) saved on this device/)).toBeOnTheScreen();

    await fireEvent.press(screen.getByRole('button', { name: 'Send now' }));
    await waitFor(() => expect(screen.queryByText(/saved on this device will be sent/)).toBeNull());
    const [first, second] = salePosts();
    const body = (call: unknown[] | undefined) =>
      JSON.parse(String((call![1] as RequestInit).body));
    expect(body(second)).toMatchObject({
      id: body(first).id,
      expectedTotalMinor: 1_180_000,
      offline: { pricesIncludeTax: false, lines: [{ unitPriceMinor: 1_000_000, taxRateBp: 1800 }] },
    });
  });

  it('scans from the device’s catalogue copy when there is no connection', async () => {
    const base = fetchMock.getMockImplementation()!;
    let down = false;
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url.includes('/sync/catalog'))
        return respond(200, {
          items: [
            {
              variantId: VARIANT,
              productId: PRODUCT,
              productName: 'Silk Saree',
              brand: null,
              sku: 'SAREE-1',
              barcode: '4006381333931',
              variantLabel: '',
              unit: 'piece',
              priceMinor: 1_000_000,
              taxRateId: null,
              active: true,
            },
          ],
          cursor: 'c1',
          hasMore: false,
        });
      if (down) throw new TypeError('Network request failed');
      return base(url, init);
    });
    await render(<SellScreen />);
    await screen.findByLabelText('Barcode or SKU');
    // The first sync stores the catalogue, then fetches tax rates again.
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.filter(([url]) => String(url).includes('/tax-rates')).length,
      ).toBeGreaterThanOrEqual(2),
    );
    down = true;
    const field = screen.getByLabelText('Barcode or SKU');
    await fireEvent.changeText(field, '4006381333931');
    await fireEvent(field, 'submitEditing');
    expect(await screen.findByText('Silk Saree')).toBeOnTheScreen();
    expect(screen.getByTestId('cart-total')).toHaveTextContent(/11,800\.00/);
  });

  it('asks a manager to approve a large discount, then resubmits the same sale', async () => {
    await sessionStore.applySession({
      ...mobileSession(),
      permissions: [...PERMS, 'sales.discount'] as never,
    });
    const MANAGER = 'abababab-abab-4bab-8bab-abababababab';
    saleResponses.push(() => respond(403, { error: { code: 'APPROVAL_REQUIRED', message: 'x' } }));
    const base = fetchMock.getMockImplementation()!;
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) =>
      url.includes('/approvers')
        ? respond(200, { items: [{ userId: MANAGER, fullName: 'Kamal Perera', role: 'MANAGER' }] })
        : base(url, init),
    );
    await render(<SellScreen />);
    await scanOne();
    await fireEvent.changeText(screen.getByLabelText('Sale discount (%)'), '50');
    await fireEvent.press(screen.getByRole('button', { name: /^Pay/ }));
    await fireEvent.press(screen.getByRole('button', { name: 'Exact' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Complete sale' }));
    expect(await screen.findByText('Manager approval')).toBeOnTheScreen();
    await fireEvent.press(await screen.findByRole('radio', { name: 'Kamal Perera' }));
    await fireEvent.changeText(screen.getByLabelText('Manager’s PIN'), '2468');
    await fireEvent.press(screen.getByRole('button', { name: 'Approve' }));
    await screen.findByText('Sale INV-000042 completed');
    const [first, second] = salePosts();
    const body = (call: unknown[] | undefined) =>
      JSON.parse(String((call![1] as RequestInit).body));
    expect(body(second)).toMatchObject({
      id: body(first).id,
      discount: { kind: 'PERCENT', value: 5000 },
      approval: { approverId: MANAGER, pin: '2468' },
    });
  });

  it('finds a customer by phone and charges the sale to their account', async () => {
    await sessionStore.applySession({
      ...mobileSession(),
      permissions: [...PERMS, 'customers.read'] as never,
    });
    const CUSTOMER = 'c0c0c0c0-c0c0-4c0c-8c0c-c0c0c0c0c0c0';
    const base = fetchMock.getMockImplementation()!;
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) =>
      url.includes('/customers')
        ? respond(200, {
            items: [
              {
                id: CUSTOMER,
                number: 'CUS-000001',
                name: 'Nimali Perera',
                phone: '+94771234567',
                email: null,
                address: null,
                notes: null,
                marketingConsent: false,
                marketingConsentAt: null,
                creditLimitMinor: 2_000_000,
                balanceMinor: 0,
                availableCreditMinor: 2_000_000,
                status: 'ACTIVE',
                version: 1,
                createdAt: '2026-10-17T08:00:00.000Z',
              },
            ],
            nextCursor: null,
          })
        : base(url, init),
    );
    await render(<SellScreen />);
    await scanOne();
    await fireEvent.press(screen.getByRole('button', { name: /^Pay/ }));
    expect(screen.queryByRole('radio', { name: 'On account' })).toBeNull();
    await fireEvent.changeText(screen.getByLabelText('Customer phone'), '0771234567');
    await fireEvent.press(screen.getByRole('button', { name: 'Find customer' }));
    expect(await screen.findByText('Nimali Perera')).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('radio', { name: 'On account' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Exact' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Complete sale' }));
    await screen.findByText('Sale INV-000042 completed');
    const body = JSON.parse(String((salePosts()[0]![1] as RequestInit).body));
    expect(body).toMatchObject({
      customerId: CUSTOMER,
      payments: [{ method: 'ACCOUNT', amountMinor: 1_180_000 }],
    });
  });

  it('pays part of the sale with the customer’s points', async () => {
    await sessionStore.applySession({
      ...mobileSession(),
      permissions: [...PERMS, 'customers.read'] as never,
      features: ['loyalty'],
    });
    const CUSTOMER = 'c0c0c0c0-c0c0-4c0c-8c0c-c0c0c0c0c0c0';
    const base = fetchMock.getMockImplementation()!;
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/settings'))
        return respond(200, {
          ...settings,
          loyalty: {
            enabled: true,
            spendPerPointMinor: 10_000,
            pointValueMinor: 100,
            minRedeemPoints: 10,
          },
        });
      if (url.includes('/customers'))
        return respond(200, {
          items: [
            {
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
              loyaltyPoints: 2_000,
              status: 'ACTIVE',
              version: 1,
              createdAt: '2026-10-17T08:00:00.000Z',
            },
          ],
          nextCursor: null,
        });
      return base(url, init);
    });
    await render(<SellScreen />);
    await scanOne();
    await fireEvent.press(screen.getByRole('button', { name: /^Pay/ }));
    expect(screen.queryByRole('radio', { name: 'Points' })).toBeNull();
    await fireEvent.changeText(screen.getByLabelText('Customer phone'), '0771234567');
    await fireEvent.press(screen.getByRole('button', { name: 'Find customer' }));
    expect(await screen.findByText(/2000 points \(worth LKR\s2,000\.00\)/)).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: /Use LKR\s2,000\.00 in points/ }));
    const exact = screen.getAllByRole('button', { name: 'Exact' });
    await fireEvent.press(exact[exact.length - 1]!);
    await fireEvent.press(screen.getByRole('button', { name: 'Complete sale' }));
    await screen.findByText('Sale INV-000042 completed');
    const body = JSON.parse(String((salePosts()[0]![1] as RequestInit).body));
    expect(body).toMatchObject({
      customerId: CUSTOMER,
      payments: [
        { method: 'LOYALTY', amountMinor: 200_000 },
        { method: 'CASH', amountMinor: 980_000 },
      ],
    });
  });

  it("refuses to sell on another cashier's shift", async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url.includes('/shifts/current'))
        return respond(200, { shift: { ...shift, openedById: PRODUCT, openedByName: 'Nimal' } });
      if (url.includes('/tax-rates')) return respond(200, { items: [] });
      return respond(200, settings);
    });
    await render(<SellScreen />);
    expect(await screen.findByText(/belongs to Nimal/)).toBeOnTheScreen();
    expect(screen.queryByLabelText('Barcode or SKU')).toBeNull();
  });
});
