import { fireEvent, render, screen } from '@testing-library/react-native';
import '@/lib/i18n';
import CashScreen from '@/app/(app)/cash';
import { sessionStore } from '@/lib/session';
import { mobileSession, respond, secureStoreMap } from '../test/fixtures';

const SHIFT = '55555555-5555-4555-8555-555555555555';
const MANAGER = 'abababab-abab-4bab-8bab-abababababab';

jest.mock('expo-router', () => ({
  router: { back: jest.fn() },
  useLocalSearchParams: () => ({ id: '55555555-5555-4555-8555-555555555555' }),
}));

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
    pricesIncludeTax: true,
    allowNegativeStock: false,
    receiptFooter: null,
    discountApprovalBp: null,
    refundsRequireApproval: true,
  },
  updatedAt: '2026-01-01T00:00:00.000Z',
};

const shift = {
  id: SHIFT,
  number: 'SHF-000003',
  status: 'OPEN',
  branchId: '33333333-3333-4333-8333-333333333333',
  branchName: 'Main',
  registerId: '44444444-4444-4444-8444-444444444444',
  registerName: 'Till 1',
  openingFloatMinor: 100_000,
  openedAt: '2026-10-17T08:00:00.000Z',
  openedById: mobileSession().user.id,
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
    payOutMinor: 20_000,
    collectionsMinor: 0,
    collectionsCashMinor: 0,
    expectedCashMinor: 80_000,
  },
  cashMovements: [],
};

describe('cash in / out', () => {
  const fetchMock = jest.fn();
  beforeEach(async () => {
    secureStoreMap().clear();
    fetchMock.mockReset();
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    await sessionStore.applySession(mobileSession());
  });

  it('records a pay-out once a manager approves it, keeping the same id', async () => {
    let attempt = 0;
    fetchMock.mockImplementation(async (url: string) => {
      if (url.includes('/approvers'))
        return respond(200, {
          items: [{ userId: MANAGER, fullName: 'Kamal Perera', role: 'MANAGER' }],
        });
      if (url.includes('/cash-movements')) {
        attempt += 1;
        return attempt === 1
          ? respond(403, { error: { code: 'APPROVAL_REQUIRED', message: 'x' } })
          : respond(200, shift);
      }
      return respond(200, settings);
    });
    await render(<CashScreen />);
    await fireEvent.press(await screen.findByRole('radio', { name: 'Pay out' }));
    await fireEvent.changeText(screen.getByLabelText('Amount (LKR)'), '200');
    await fireEvent.changeText(screen.getByLabelText('Reason'), 'Courier');
    await fireEvent.press(screen.getByRole('button', { name: 'Record' }));
    await fireEvent.changeText(await screen.findByLabelText('Manager’s PIN'), '2468');
    await fireEvent.press(screen.getByRole('button', { name: 'Approve' }));
    expect(await screen.findByText('Cash movement recorded.')).toBeOnTheScreen();
    const calls = fetchMock.mock.calls.filter(([url]) => String(url).includes('/cash-movements'));
    const body = (i: number) => JSON.parse(String((calls[i]![1] as RequestInit).body));
    expect(body(0)).toMatchObject({ type: 'PAY_OUT', amountMinor: 20_000, reason: 'Courier' });
    expect(body(1)).toMatchObject({
      id: body(0).id,
      approval: { approverId: MANAGER, pin: '2468' },
    });
  });
});
