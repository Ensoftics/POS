import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { callsTo, mockApi, renderAt, signedInAs } from '../../test/render';

const PERMS = [
  'tenant.read',
  'settings.read',
  'branches.read',
  'products.read',
  'sales.create',
  'sales.read',
  'sales.refund',
  'cash.manage',
] as const;

const USER = '6f1b2c4e-1c1a-4b7a-9a43-0f1e2d3c4b5a';
const MANAGER = 'abababab-abab-4bab-8bab-abababababab';
const BRANCH = '33333333-3333-4333-8333-333333333333';
const REGISTER = '44444444-4444-4444-8444-444444444444';
const SHIFT = '55555555-5555-4555-8555-555555555555';
const SALE = '99999999-9999-4999-8999-999999999999';
const LINE = '12121212-1212-4121-8121-121212121212';
const VARIANT = '77777777-7777-4777-8777-777777777777';

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

const shift = (overrides: Record<string, unknown> = {}) => ({
  id: SHIFT,
  number: 'SHF-000001',
  status: 'OPEN',
  branchId: BRANCH,
  branchName: 'Main branch',
  registerId: REGISTER,
  registerName: 'Till 1',
  openingFloatMinor: 100_000,
  openedAt: '2026-10-17T08:00:00.000Z',
  openedById: USER,
  openedByName: 'Ama Silva',
  closedAt: null,
  closedByName: null,
  expectedCashMinor: null,
  countedCashMinor: null,
  differenceMinor: null,
  closingNotes: null,
  version: 1,
  summary: {
    saleCount: 1,
    salesTotalMinor: 99_999,
    discountMinor: 0,
    taxMinor: 0,
    payments: [{ method: 'CASH', amountMinor: 99_999 }],
    cashReceivedMinor: 99_999,
    changeGivenMinor: 0,
    returnCount: 0,
    refundsTotalMinor: 0,
    refunds: [],
    cashRefundedMinor: 0,
    payInMinor: 0,
    payOutMinor: 0,
    collectionsMinor: 0,
    collectionsCashMinor: 0,
    expectedCashMinor: 199_999,
  },
  cashMovements: [],
  ...overrides,
});

const sale = (overrides: Record<string, unknown> = {}) => ({
  id: SALE,
  number: 'INV-000007',
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
      variantId: VARIANT,
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
      returnedQuantity: '0',
      refundedMinor: 0,
      refundedTaxMinor: 0,
    },
  ],
  payments: [{ method: 'CASH', amountMinor: 99_999, reference: null }],
  taxSummary: [],
  approvedByName: null,
  returnStatus: 'NONE',
  capturedOffline: false,
  syncedAt: null,
  conflicts: [],
  voided: false,
  refundedMinor: 0,
  refundable: [{ method: 'CASH', amountMinor: 99_999 }],
  returns: [],
  ...overrides,
});

const saleReturn = (overrides: Record<string, unknown> = {}) => ({
  id: 'cdcdcdcd-cdcd-4dcd-8dcd-cdcdcdcdcdcd',
  number: 'RET-000001',
  kind: 'RETURN',
  saleId: SALE,
  saleNumber: 'INV-000007',
  shiftId: SHIFT,
  shiftNumber: 'SHF-000001',
  branchName: 'Main branch',
  registerName: 'Till 1',
  cashierName: 'Ama Silva',
  approvedByName: 'Kamal Perera',
  reason: 'Wrong shade',
  refundMinor: 33_333,
  taxMinor: 0,
  createdAt: '2026-10-17T10:00:00.000Z',
  lines: [],
  refunds: [{ method: 'CASH', amountMinor: 33_333, reference: null }],
  ...overrides,
});

const approvers = { items: [{ userId: MANAGER, fullName: 'Kamal Perera', role: 'MANAGER' }] };
const approvalRequired = {
  status: 403,
  body: { error: { code: 'APPROVAL_REQUIRED', message: 'x' } },
};
const bodyOf = (call: unknown[] | undefined) => JSON.parse(String((call?.[1] as RequestInit).body));
const posts = (fetch: ReturnType<typeof mockApi>, path: string) =>
  callsTo(fetch, path).filter(([, init]) => (init as RequestInit).method === 'POST');

describe('Returns and voids', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('finds a sale by receipt number, returns one item with a manager’s approval', async () => {
    signedInAs({ permissions: [...PERMS] });
    let attempt = 0;
    const fetch = mockApi((url, init) => {
      if (url.includes('/branches')) return { status: 200, body: branches };
      if (url.includes('/shifts/current')) return { status: 200, body: { shift: shift() } };
      if (url.includes('/approvers')) return { status: 200, body: approvers };
      if (url.includes('/sales/by-number/INV-000007')) return { status: 200, body: sale() };
      if (url.includes('/receipt'))
        return { status: 404, body: { error: { code: 'NOT_FOUND', message: 'x' } } };
      if (url.includes('/returns') && init.method === 'POST') {
        attempt += 1;
        return attempt === 1 ? approvalRequired : { status: 201, body: saleReturn() };
      }
      if (url.includes('/sales')) return { status: 200, body: { items: [], nextCursor: null } };
      return { status: 404 };
    });
    renderAt('/sales');
    await userEvent.type(
      await screen.findByLabelText('Find a receipt to return items'),
      'inv-000007',
    );
    await userEvent.click(screen.getByRole('button', { name: 'Find' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Return items' }));

    await userEvent.type(await screen.findByLabelText('Return quantity for Rose Soap'), '1');
    // 999.99 for 3: the first unit refunds 333.33, exactly as the server computes.
    expect(screen.getByTestId('refund-total')).toHaveTextContent('333.33');
    await userEvent.type(screen.getByLabelText('Reason'), 'Wrong shade');
    await userEvent.click(screen.getByRole('button', { name: 'Record return and refund' }));

    const dialog = await screen.findByRole('dialog', { name: 'Manager approval' });
    expect(dialog).toHaveTextContent('Returns and refunds need a manager.');
    await userEvent.type(screen.getByLabelText('Manager’s PIN'), '2468');
    await userEvent.click(screen.getByRole('button', { name: 'Approve' }));

    expect(await screen.findByText(/Return RET-000001 recorded/)).toBeInTheDocument();
    const [first, second] = posts(fetch, '/returns');
    expect(bodyOf(first)).toMatchObject({
      shiftId: SHIFT,
      reason: 'Wrong shade',
      lines: [{ saleLineId: LINE, quantity: '1', restock: true }],
      refunds: [{ method: 'CASH', amountMinor: 33_333, reference: null }],
    });
    expect(bodyOf(first).approval).toBeUndefined();
    // The retry is the same return (same id) plus the approval.
    expect(bodyOf(second)).toMatchObject({
      id: bodyOf(first).id,
      approval: { approverId: MANAGER, pin: '2468' },
    });
  });

  it('asks again when the PIN is wrong and lets the cashier cancel', async () => {
    signedInAs({ permissions: [...PERMS] });
    const fetch = mockApi((url, init) => {
      if (url.includes('/branches')) return { status: 200, body: branches };
      if (url.includes('/shifts/current')) return { status: 200, body: { shift: shift() } };
      if (url.includes('/approvers')) return { status: 200, body: approvers };
      if (url.includes('/receipt'))
        return { status: 404, body: { error: { code: 'NOT_FOUND', message: 'x' } } };
      if (url.includes('/void'))
        return bodyOf([url, init]).approval
          ? { status: 403, body: { error: { code: 'APPROVAL_INVALID', message: 'x' } } }
          : approvalRequired;
      if (url.includes(`/sales/${SALE}`)) return { status: 200, body: sale() };
      return { status: 404 };
    });
    renderAt(`/sales/${SALE}`);
    await userEvent.click(await screen.findByRole('button', { name: 'Void sale' }));
    await userEvent.type(screen.getByLabelText('Reason'), 'Rang up twice');
    await userEvent.click(screen.getAllByRole('button', { name: 'Void sale' }).at(-1)!);
    await userEvent.type(await screen.findByLabelText('Manager’s PIN'), '1111');
    await userEvent.click(screen.getByRole('button', { name: 'Approve' }));
    expect(await screen.findByText('That approval PIN is not correct.')).toBeInTheDocument();
    await userEvent.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancel' }),
    );
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(posts(fetch, '/void')).toHaveLength(2);
    expect(screen.queryByText(/Sale voided/)).toBeNull();
  });

  it('shows returned state and hides actions that no longer apply', async () => {
    signedInAs({ permissions: [...PERMS] });
    mockApi((url) => {
      if (url.includes('/branches')) return { status: 200, body: branches };
      if (url.includes('/receipt'))
        return { status: 404, body: { error: { code: 'NOT_FOUND', message: 'x' } } };
      if (url.includes(`/sales/${SALE}`))
        return {
          status: 200,
          body: sale({
            voided: true,
            returnStatus: 'FULL',
            returns: [
              {
                id: saleReturn().id,
                number: 'RET-000002',
                kind: 'VOID',
                refundMinor: 99_999,
                createdAt: '2026-10-17T10:00:00.000Z',
              },
            ],
          }),
        };
      return { status: 404 };
    });
    renderAt(`/sales/${SALE}`);
    expect(await screen.findByText('Voided')).toBeInTheDocument();
    expect(screen.getByText('RET-000002')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Return items' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Void sale' })).toBeNull();
  });
});

describe('Cash in / out', () => {
  it('records a pay-out after approval and updates the shift', async () => {
    signedInAs({ permissions: [...PERMS] });
    let attempt = 0;
    const fetch = mockApi((url, init) => {
      if (url.includes('/branches')) return { status: 200, body: branches };
      if (url.includes('/tax-rates')) return { status: 200, body: { items: [] } };
      if (url.includes('/approvers')) return { status: 200, body: approvers };
      if (url.includes('/shifts/current')) return { status: 200, body: { shift: shift() } };
      if (url.includes('/cash-movements')) {
        attempt += 1;
        return attempt === 1
          ? approvalRequired
          : {
              status: 200,
              body: shift({
                cashMovements: [
                  {
                    id: bodyOf([url, init]).id,
                    type: 'PAY_OUT',
                    amountMinor: 20_000,
                    reason: 'Courier',
                    createdByName: 'Ama Silva',
                    approvedByName: 'Kamal Perera',
                    createdAt: '2026-10-17T11:00:00.000Z',
                  },
                ],
              }),
            };
      }
      return { status: 404 };
    });
    renderAt('/pos');
    await userEvent.click(await screen.findByRole('button', { name: 'Cash in / out' }));
    await userEvent.click(screen.getByLabelText('Pay out'));
    await userEvent.type(screen.getByLabelText(/^Amount/), '200');
    await userEvent.type(screen.getByLabelText('Reason'), 'Courier');
    await userEvent.click(screen.getByRole('button', { name: 'Record' }));
    await userEvent.type(await screen.findByLabelText('Manager’s PIN'), '2468');
    await userEvent.click(screen.getByRole('button', { name: 'Approve' }));
    expect(await screen.findByText('Cash movement recorded.')).toBeInTheDocument();
    const [first, second] = posts(fetch, '/cash-movements');
    expect(bodyOf(first)).toMatchObject({
      type: 'PAY_OUT',
      amountMinor: 20_000,
      reason: 'Courier',
    });
    expect(bodyOf(second).id).toBe(bodyOf(first).id);
  });
});

describe('Offline sales to review', () => {
  it('explains expired stock sold offline, with the batch and its date', async () => {
    signedInAs({ permissions: [...PERMS, 'shifts.manage'] });
    mockApi((url) =>
      url.includes('/sale-conflicts')
        ? {
            status: 200,
            body: {
              items: [
                {
                  id: 'efefefef-efef-4fef-8fef-efefefefefe1',
                  type: 'EXPIRED_SOLD',
                  detail: {
                    lines: [
                      {
                        sku: 'LIP-RUBY',
                        batchNumber: 'OLD',
                        expiryDate: '2025-01-31',
                        quantity: '1',
                      },
                    ],
                  },
                  saleId: SALE,
                  saleNumber: 'INV-000010',
                  branchName: 'Main branch',
                  cashierName: 'Ama Silva',
                  saleTotalMinor: 125_000,
                  capturedAt: '2026-10-17T09:00:00.000Z',
                  createdAt: '2026-10-17T12:00:00.000Z',
                  resolvedAt: null,
                  resolvedByName: null,
                  resolutionNote: null,
                },
              ],
              nextCursor: null,
            },
          }
        : { status: 200, body: { items: [], nextCursor: null } },
    );
    renderAt('/sales/review');
    expect(await screen.findByText('Expired stock sold')).toBeInTheDocument();
    expect(screen.getByText('LIP-RUBY: 1 from batch OLD (expired 2025-01-31)')).toBeInTheDocument();
  });

  it('shows what differed and lets a manager resolve it with a note', async () => {
    signedInAs({ permissions: [...PERMS, 'shifts.manage'] });
    const conflict = {
      id: 'efefefef-efef-4fef-8fef-efefefefefef',
      type: 'PRICE_CHANGED',
      detail: { lines: [{ sku: 'ROSE', chargedMinor: 30_000, currentMinor: 33_333 }] },
      saleId: SALE,
      saleNumber: 'INV-000009',
      branchName: 'Main branch',
      cashierName: 'Ama Silva',
      saleTotalMinor: 30_000,
      capturedAt: '2026-10-17T09:00:00.000Z',
      createdAt: '2026-10-17T12:00:00.000Z',
      resolvedAt: null,
      resolvedByName: null,
      resolutionNote: null,
    };
    let resolved = false;
    const fetch = mockApi((url, init) => {
      if (url.includes('/resolve')) {
        resolved = true;
        return {
          status: 200,
          body: {
            ...conflict,
            resolvedAt: '2026-10-17T13:00:00.000Z',
            resolvedByName: 'Kamal',
            resolutionNote: 'ok',
          },
        };
      }
      if (url.includes('/sale-conflicts'))
        return { status: 200, body: { items: resolved ? [] : [conflict], nextCursor: null } };
      return { status: 404, body: { error: { code: 'NOT_FOUND', message: init.method ?? 'x' } } };
    });
    renderAt('/sales/review');
    expect(await screen.findByText('Price changed')).toBeInTheDocument();
    expect(screen.getByText(/ROSE: charged .*300\.00, current .*333\.33/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Mark resolved' }));
    expect(screen.getByText('This field is required')).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('What was done'), 'Old shelf label; accepted.');
    await userEvent.click(screen.getByRole('button', { name: 'Mark resolved' }));
    expect(await screen.findByText('Nothing to review.')).toBeInTheDocument();
    expect(bodyOf(posts(fetch, '/resolve')[0])).toEqual({ note: 'Old shelf label; accepted.' });
  });
});
