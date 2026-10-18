import { fireEvent, render, screen } from '@testing-library/react-native';
import '@/lib/i18n';
import ReturnsScreen from '@/app/(app)/returns';
import { sessionStore } from '@/lib/session';
import { mobileSession, respond, secureStoreMap } from '../test/fixtures';

const SHIFT = '55555555-5555-4555-8555-555555555555';
const SALE = '99999999-9999-4999-8999-999999999999';
const LINE = '12121212-1212-4121-8121-121212121212';

jest.mock('expo-router', () => ({
  router: { back: jest.fn() },
  useLocalSearchParams: () => ({ shiftId: '55555555-5555-4555-8555-555555555555' }),
}));

const sale = {
  id: SALE,
  number: 'INV-000007',
  status: 'COMPLETED',
  branchId: '33333333-3333-4333-8333-333333333333',
  branchName: 'Main',
  registerId: '44444444-4444-4444-8444-444444444444',
  registerName: 'Till 1',
  shiftId: SHIFT,
  shiftNumber: 'SHF-000001',
  cashierName: 'Kasun Fernando',
  customerId: null,
  customerName: null,
  currency: 'LKR',
  pricesIncludeTax: true,
  discount: null,
  subtotalMinor: 99_999,
  discountMinor: 0,
  taxMinor: 0,
  totalMinor: 99_999,
  paidMinor: 99_999,
  changeMinor: 0,
  notes: null,
  createdAt: '2026-10-17T09:00:00.000Z',
  lines: [
    {
      id: LINE,
      variantId: '77777777-7777-4777-8777-777777777777',
      productName: 'Rose Soap',
      sku: 'ROSE',
      variantLabel: '',
      unit: 'piece',
      quantity: '3',
      unitPriceMinor: 33_333,
      grossMinor: 99_999,
      discount: null,
      lineDiscountMinor: 0,
      cartDiscountMinor: 0,
      taxName: null,
      taxRateBp: 0,
      taxMinor: 0,
      totalMinor: 99_999,
      returnedQuantity: '1',
      refundedMinor: 33_333,
      refundedTaxMinor: 0,
    },
  ],
  payments: [{ method: 'CASH', amountMinor: 99_999, reference: null }],
  taxSummary: [],
  approvedByName: null,
  returnStatus: 'PARTIAL',
  capturedOffline: false,
  syncedAt: null,
  conflicts: [],
  voided: false,
  refundedMinor: 33_333,
  refundable: [{ method: 'CASH', amountMinor: 66_666 }],
  returns: [],
};

describe('returns on Android', () => {
  const fetchMock = jest.fn();
  beforeEach(async () => {
    secureStoreMap().clear();
    fetchMock.mockReset();
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    await sessionStore.applySession(mobileSession());
  });

  it('finds the receipt, limits quantities to what is left and refunds the exact amount', async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url.includes('/by-number/INV-000007')) return respond(200, sale);
      if (url.includes('/returns'))
        return respond(201, {
          id: 'cdcdcdcd-cdcd-4dcd-8dcd-cdcdcdcdcdcd',
          number: 'RET-000002',
          kind: 'RETURN',
          saleId: SALE,
          saleNumber: 'INV-000007',
          shiftId: SHIFT,
          shiftNumber: 'SHF-000001',
          branchName: 'Main',
          registerName: 'Till 1',
          cashierName: 'Kasun Fernando',
          approvedByName: null,
          reason: 'Wrong colour',
          refundMinor: 66_666,
          taxMinor: 0,
          createdAt: '2026-10-17T10:00:00.000Z',
          lines: [],
          refunds: [{ method: 'CASH', amountMinor: 66_666, reference: null }],
        });
      return respond(404, { error: { code: 'NOT_FOUND', message: 'x' } });
    });
    await render(<ReturnsScreen />);
    await fireEvent.changeText(
      screen.getByLabelText('Find a receipt to return items'),
      'inv-000007',
    );
    await fireEvent.press(screen.getByRole('button', { name: 'Find' }));
    const plus = await screen.findByRole('button', { name: 'Increase Rose Soap' });
    // Two of three are left: a third press does nothing.
    await fireEvent.press(plus);
    await fireEvent.press(plus);
    await fireEvent.press(plus);
    expect(screen.getByLabelText('Return quantity for Rose Soap')).toHaveTextContent('2');
    // Cumulative rounding: 999.99 − 333.33 already refunded = 666.66.
    expect(screen.getByTestId('refund-total')).toHaveTextContent(/666\.66/);
    await fireEvent.changeText(screen.getByLabelText('Reason'), 'Wrong colour');
    await fireEvent.press(screen.getByRole('button', { name: 'Record return and refund' }));
    expect(await screen.findByText(/Return RET-000002 recorded/)).toBeOnTheScreen();
    const post = fetchMock.mock.calls.find(([url]) => String(url).includes('/returns'))!;
    expect(JSON.parse(String((post[1] as RequestInit).body))).toMatchObject({
      shiftId: SHIFT,
      reason: 'Wrong colour',
      lines: [{ saleLineId: LINE, quantity: '2', restock: true }],
      refunds: [{ method: 'CASH', amountMinor: 66_666, reference: null }],
    });
  });
});
