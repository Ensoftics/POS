import { fireEvent, render, screen } from '@testing-library/react-native';
import '@/lib/i18n';
import LookupScreen from '@/app/(app)/lookup';
import { saveDeviceRegister } from '@/lib/device-register';
import { sessionStore } from '@/lib/session';
import { mobileSession, respond, secureStoreMap } from '../test/fixtures';

const settings = {
  version: 1,
  legalName: null,
  taxRegistrationNumber: null,
  addressLine1: null,
  addressLine2: null,
  city: null,
  postalCode: null,
  country: 'LK',
  currency: 'USD',
  timezone: 'Asia/Colombo',
  defaultLanguage: 'en',
  enabledLanguages: ['en'],
  profile: {
    trackBatchNumbers: false,
    trackExpiryDates: false,
    allowFractionalQuantities: true,
    variantAttributes: ['colour', 'size'],
    defaultUnits: ['piece'],
  },
  checkout: {
    pricesIncludeTax: true,
    allowNegativeStock: false,
    receiptFooter: null,
    discountApprovalBp: null,
    refundsRequireApproval: true,
  },
  updatedAt: '2026-01-01T00:00:00.000Z',
};

const variant = {
  id: '77777777-7777-4777-8777-777777777777',
  productId: '66666666-6666-4666-8666-666666666666',
  sku: 'TEE-RED-M',
  barcode: '4006381333931',
  attributes: { colour: 'Red', size: 'M' },
  priceMinor: 250050,
  costMinor: null,
  packSize: null,
  reorderLevel: null,
  status: 'ACTIVE',
  version: 1,
};

const lookup = {
  variant,
  product: {
    id: variant.productId,
    name: 'Cotton T-shirt',
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

describe('price check', () => {
  const fetchMock = jest.fn();
  beforeEach(async () => {
    secureStoreMap().clear();
    fetchMock.mockReset();
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    await sessionStore.applySession(mobileSession());
  });

  it('looks up a scanned code and shows the price in the business currency', async () => {
    fetchMock.mockImplementation(async (url: string) =>
      url.includes('/products/lookup') ? respond(200, lookup) : respond(200, settings),
    );
    await render(<LookupScreen />);
    const field = screen.getByLabelText('Barcode or SKU');
    await fireEvent.changeText(field, '4006381333931');
    // A keyboard-wedge scanner ends the code with Enter.
    await fireEvent(field, 'submitEditing');

    expect(await screen.findByText('Cotton T-shirt')).toBeOnTheScreen();
    expect(screen.getByText('Colour: Red · Size: M')).toBeOnTheScreen();
    expect(screen.getByText(/2,500\.50/)).toBeOnTheScreen();
    const lookupCall = fetchMock.mock.calls.find(([url]) =>
      String(url).includes('/products/lookup'),
    );
    expect(lookupCall?.[0]).toMatch(/code=4006381333931$/);
    // No photo: no image placeholder either.
    expect(screen.queryByLabelText('Photo of Cotton T-shirt')).toBeNull();
  });

  it('shows the main product photo', async () => {
    const thumbUrl = 'https://api.example.lk/api/v1/media/t/x/i/y/thumb.webp?s=abc';
    const withPhoto = {
      ...lookup,
      product: {
        ...lookup.product,
        images: [
          {
            id: 'a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1',
            url: thumbUrl.replace('thumb', 'full'),
            thumbUrl,
            width: 800,
            height: 600,
          },
        ],
      },
    };
    fetchMock.mockImplementation(async (url: string) =>
      url.includes('/products/lookup') ? respond(200, withPhoto) : respond(200, settings),
    );
    await render(<LookupScreen />);
    const field = screen.getByLabelText('Barcode or SKU');
    await fireEvent.changeText(field, '4006381333931');
    await fireEvent(field, 'submitEditing');
    const image = await screen.findByLabelText('Photo of Cotton T-shirt');
    expect(image.props.source).toEqual({ uri: thumbUrl });
  });

  it('shows stock at the device branch when a register is chosen', async () => {
    await saveDeviceRegister(mobileSession().tenant.id, {
      branchId: '33333333-3333-4333-8333-333333333333',
      branchCode: 'MAIN',
      branchName: 'Main branch',
      registerId: '44444444-4444-4444-8444-444444444444',
      registerCode: 'R1',
      registerName: 'Register 1',
    });
    fetchMock.mockImplementation(async (url: string) => {
      if (url.includes('/products/lookup')) return respond(200, lookup);
      if (url.includes('/stock')) {
        return respond(200, {
          items: [
            {
              variantId: variant.id,
              productId: variant.productId,
              productName: 'Cotton T-shirt',
              sku: 'TEE-RED-M',
              variantLabel: 'Red / M',
              unit: 'piece',
              barcode: variant.barcode,
              quantity: '12',
              reorderLevel: null,
              low: false,
              nextExpiry: null,
              batches: [],
            },
          ],
          nextCursor: null,
        });
      }
      return respond(200, settings);
    });
    await render(<LookupScreen />);
    await fireEvent.changeText(screen.getByLabelText('Barcode or SKU'), 'TEE-RED-M');
    await fireEvent(screen.getByLabelText('Barcode or SKU'), 'submitEditing');
    expect(await screen.findByText('12 Piece')).toBeOnTheScreen();
    expect(screen.getByText(/In stock at Main branch/)).toBeOnTheScreen();
  });

  it('explains when nothing matches', async () => {
    fetchMock.mockImplementation(async (url: string) =>
      url.includes('/products/lookup')
        ? respond(404, { error: { code: 'NOT_FOUND', message: 'x' } })
        : respond(200, settings),
    );
    await render(<LookupScreen />);
    await fireEvent.changeText(screen.getByLabelText('Barcode or SKU'), 'NOPE');
    await fireEvent.press(screen.getByRole('button', { name: 'Look up' }));
    expect(await screen.findByText('No active item has the code NOPE.')).toBeOnTheScreen();
  });
});
