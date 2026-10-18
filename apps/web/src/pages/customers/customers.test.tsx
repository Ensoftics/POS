import { screen, within } from '@testing-library/react';
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
  'customers.read',
  'customers.manage',
  'customers.collect',
] as const;

const USER = '6f1b2c4e-1c1a-4b7a-9a43-0f1e2d3c4b5a';
const CUSTOMER = 'c0c0c0c0-c0c0-4c0c-8c0c-c0c0c0c0c0c0';
const BRANCH = '33333333-3333-4333-8333-333333333333';
const REGISTER = '44444444-4444-4444-8444-444444444444';
const SHIFT = '55555555-5555-4555-8555-555555555555';

const customer = (overrides: Record<string, unknown> = {}) => ({
  id: CUSTOMER,
  number: 'CUS-000001',
  name: 'Nimali Perera',
  phone: '+94771234567',
  email: null,
  address: null,
  notes: null,
  marketingConsent: false,
  marketingConsentAt: null,
  creditLimitMinor: 100_000,
  balanceMinor: 60_000,
  availableCreditMinor: 40_000,
  status: 'ACTIVE',
  version: 1,
  createdAt: '2026-10-17T08:00:00.000Z',
  ...overrides,
});

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

const shift = {
  id: SHIFT,
  number: 'SHF-000001',
  status: 'OPEN',
  branchId: BRANCH,
  branchName: 'Main branch',
  registerId: REGISTER,
  registerName: 'Till 1',
  openingFloatMinor: 0,
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
    expectedCashMinor: 0,
  },
  cashMovements: [],
};

const statement = {
  business: {
    name: 'Lotus Cosmetics',
    legalName: null,
    addressLines: [],
    timezone: 'Asia/Colombo',
    currency: 'LKR',
  },
  customer: customer(),
  from: '2026-09-17',
  to: '2026-10-17',
  openingBalanceMinor: 0,
  closingBalanceMinor: 60_000,
  entries: [
    {
      id: 'e0e0e0e0-e0e0-4e0e-8e0e-e0e0e0e0e0e0',
      type: 'CHARGE',
      amountMinor: 60_000,
      balanceAfterMinor: 60_000,
      referenceType: 'sale',
      referenceId: '99999999-9999-4999-8999-999999999999',
      referenceNumber: 'INV-000001',
      createdAt: '2026-10-17T09:00:00.000Z',
    },
  ],
};

const bodyOf = (call: unknown[] | undefined) => JSON.parse(String((call?.[1] as RequestInit).body));
const posts = (fetch: ReturnType<typeof mockApi>, path: string) =>
  callsTo(fetch, path).filter(([, init]) => (init as RequestInit).method === 'POST');

describe('Customers', () => {
  beforeEach(() => localStorage.clear());

  it('adds a customer without offering credit to cashiers', async () => {
    signedInAs({ permissions: [...PERMS] });
    const fetch = mockApi((url, init) => {
      if (url.includes('/customers') && init.method === 'POST')
        return {
          status: 201,
          body: customer({ balanceMinor: 0, availableCreditMinor: 0, creditLimitMinor: 0 }),
        };
      if (url.includes('/customers')) return { status: 200, body: { items: [], nextCursor: null } };
      return { status: 404 };
    });
    renderAt('/customers');
    await userEvent.click(await screen.findByRole('button', { name: 'Add customer' }));
    expect(screen.queryByLabelText(/Credit limit/)).toBeNull();
    await userEvent.type(screen.getByLabelText('Name'), 'Nimali Perera');
    await userEvent.type(screen.getByLabelText(/^Phone/), '077 123 4567');
    await userEvent.click(screen.getByLabelText('Agrees to receive offers and news'));
    await userEvent.type(screen.getByLabelText(/How was this agreed/), 'Asked at the till');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('Customer added.')).toBeInTheDocument();
    expect(bodyOf(posts(fetch, '/customers')[0])).toMatchObject({
      name: 'Nimali Perera',
      phone: '077 123 4567',
      marketingConsent: true,
      consentNote: 'Asked at the till',
    });
    expect(bodyOf(posts(fetch, '/customers')[0]).creditLimitMinor).toBeUndefined();
  });

  it('shows the account, records a cash payment into the open shift and prints a statement', async () => {
    signedInAs({ permissions: [...PERMS] });
    let paid = false;
    const fetch = mockApi((url, init) => {
      if (url.includes('/branches')) return { status: 200, body: branches };
      if (url.includes('/shifts/current')) return { status: 200, body: { shift } };
      if (url.includes('/payments')) {
        paid = true;
        return {
          status: 201,
          body: {
            id: bodyOf([url, init]).id,
            number: 'PAY-000001',
            customerId: CUSTOMER,
            customerName: 'Nimali Perera',
            method: 'CASH',
            amountMinor: 20_000,
            reference: null,
            shiftNumber: 'SHF-000001',
            createdByName: 'Ama Silva',
            createdAt: '2026-10-17T10:00:00.000Z',
            balanceAfterMinor: 40_000,
          },
        };
      }
      if (url.includes('/statement')) return { status: 200, body: statement };
      if (url.includes('/sales')) return { status: 200, body: { items: [], nextCursor: null } };
      if (url.includes(`/customers/${CUSTOMER}`))
        return {
          status: 200,
          body: customer(paid ? { balanceMinor: 40_000, availableCreditMinor: 60_000 } : {}),
        };
      return { status: 404 };
    });
    renderAt(`/customers/${CUSTOMER}`);
    expect(await screen.findByTestId('customer-balance')).toHaveTextContent('Owes LKR 600.00');
    expect(await screen.findByText('INV-000001')).toBeInTheDocument();
    expect(screen.getByTestId('closing-balance')).toHaveTextContent('600.00');

    await userEvent.click(screen.getByRole('button', { name: 'Record payment' }));
    const form = screen.getByRole('region', { name: 'Payment from Nimali Perera' });
    await userEvent.type(within(form).getByLabelText(/^Amount/), '200');
    await userEvent.click(within(form).getByRole('button', { name: 'Record payment' }));
    expect(
      await screen.findByText(/Payment PAY-000001 recorded\. Balance now LKR 400\.00/),
    ).toBeInTheDocument();
    expect(bodyOf(posts(fetch, '/payments')[0])).toMatchObject({
      method: 'CASH',
      amountMinor: 20_000,
      shiftId: SHIFT,
    });
    expect(await screen.findByTestId('customer-balance')).toHaveTextContent('Owes LKR 400.00');
  });
});
