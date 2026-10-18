import { fireEvent, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { callsTo, mockApi, renderAt, signedInAs } from '../../test/render';

const PERMS = ['tenant.read', 'settings.read', 'branches.read', 'reports.view'] as const;

const totals = (salesMinor: number, saleCount: number, refundsMinor = 0) => ({
  salesMinor,
  saleCount,
  averageSaleMinor: saleCount ? Math.round(salesMinor / saleCount) : 0,
  refundsMinor,
});

const dashboard = {
  today: '2026-10-17',
  currency: 'LKR',
  todayTotals: totals(250_000, 5),
  yesterdayTotals: totals(200_000, 6, 10_000),
  last7Days: ['11', '12', '13', '14', '15', '16', '17'].map((d, i) => ({
    date: `2026-10-${d}`,
    salesMinor: i === 6 ? 250_000 : i * 10_000,
    saleCount: i,
  })),
  topProducts: [{ label: 'Brass Lamp', quantity: '2', totalMinor: 236_000 }],
  lowStockCount: 3,
  openShifts: 1,
  openConflicts: 0,
  receivablesMinor: 118_000,
};

const salesReport = (groupBy: string) => ({
  from: '2026-10-11',
  to: '2026-10-17',
  currency: 'LKR',
  groupBy,
  rows:
    groupBy === 'payment_method'
      ? [
          {
            key: 'CASH',
            label: 'CASH',
            saleCount: 4,
            quantity: null,
            discountMinor: 0,
            taxMinor: 0,
            totalMinor: 180_000,
            refundsMinor: 0,
            netMinor: 180_000,
          },
        ]
      : [
          {
            key: '2026-10-17',
            label: '2026-10-17',
            saleCount: 5,
            quantity: null,
            discountMinor: 1_000,
            taxMinor: 38_000,
            totalMinor: 250_000,
            refundsMinor: 10_000,
            netMinor: 240_000,
          },
        ],
  totals: {
    saleCount: 5,
    quantity: null,
    discountMinor: 1_000,
    taxMinor: 38_000,
    totalMinor: 250_000,
    refundsMinor: 10_000,
    netMinor: 240_000,
  },
});

describe('Dashboard overview', () => {
  it('shows today against yesterday, the week and what needs attention', async () => {
    signedInAs({ permissions: [...PERMS] });
    mockApi((url) =>
      url.includes('/reports/dashboard') ? { status: 200, body: dashboard } : { status: 404 },
    );
    renderAt('/');
    const tiles = await screen.findByText('Sales today');
    expect(tiles.parentElement).toHaveTextContent('LKR 2,500.00');
    expect(tiles.parentElement).toHaveTextContent('Up on yesterday');
    // Fewer refunds than yesterday counts as good news for that tile.
    expect(screen.getByText('Refunds today').parentElement).toHaveTextContent('Down on yesterday');
    const today = screen.getByRole('button', { name: /17.*2,500.00, 6 sale/ });
    fireEvent.mouseEnter(today);
    expect(screen.getByRole('tooltip')).toHaveTextContent('LKR 2,500.00');
    expect(screen.getByRole('table', { name: 'Sales, last 7 days' })).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: '3 item(s) at or below reorder level' }),
    ).toHaveAttribute('href', '/inventory');
    expect(screen.getByRole('link', { name: /Customers owe LKR\s1,180\.00/ })).toBeInTheDocument();
    expect(screen.queryByText(/offline sale difference/)).toBeNull();
  });

  it('renders a week without any sales (new business)', async () => {
    signedInAs({ permissions: [...PERMS] });
    const quiet = {
      ...dashboard,
      todayTotals: totals(0, 0),
      yesterdayTotals: totals(0, 0),
      last7Days: dashboard.last7Days.map((d) => ({ ...d, salesMinor: 0, saleCount: 0 })),
      topProducts: [],
      lowStockCount: 0,
      openShifts: 0,
      receivablesMinor: 0,
    };
    mockApi((url) =>
      url.includes('/reports/dashboard') ? { status: 200, body: quiet } : { status: 404 },
    );
    renderAt('/');
    expect(await screen.findByText('No sales yet today.')).toBeInTheDocument();
    expect(screen.getByText('Sales today').parentElement).toHaveTextContent('Same as yesterday');
    expect(screen.getAllByRole('button', { name: /0\.00, 0 sale/ })).toHaveLength(7);
  });

  it('is hidden from staff without reports', async () => {
    signedInAs({ permissions: ['tenant.read', 'settings.read'] });
    const fetch = mockApi(() => ({ status: 404 }));
    renderAt('/');
    await screen.findByRole('heading', { name: /Hello/ });
    expect(screen.queryByText('Sales today')).toBeNull();
    expect(callsTo(fetch, '/reports')).toHaveLength(0);
  });
});

describe('Reports', () => {
  it('groups sales, downloads CSV and hides cost reports without permission', async () => {
    signedInAs({ permissions: [...PERMS] });
    const fetch = mockApi((url) => {
      if (url.includes('format=csv')) return { status: 200, body: 'day,sales\r\n' };
      if (url.includes('/reports/sales')) {
        const groupBy = new URL(url, 'http://x').searchParams.get('groupBy') ?? 'day';
        return { status: 200, body: salesReport(groupBy) };
      }
      if (url.includes('/branches')) return { status: 200, body: { items: [] } };
      return { status: 404 };
    });
    const created = vi.fn(() => 'blob:report');
    vi.stubGlobal(
      'URL',
      Object.assign(URL, { createObjectURL: created, revokeObjectURL: vi.fn() }),
    );
    renderAt('/reports');
    const table = await screen.findByRole('table', { name: 'Sales' });
    expect(within(table).getByText('LKR 2,400.00', { selector: 'tfoot td' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Profit' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Stock value' })).toBeNull();

    await userEvent.selectOptions(screen.getByLabelText('Group by'), 'payment_method');
    expect(await screen.findByRole('cell', { name: 'Cash' })).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Download CSV' }));
    const csvCall = callsTo(fetch, 'format=csv')[0];
    expect(String(csvCall?.[0])).toContain('/reports/sales?format=csv&groupBy=payment_method');
    expect(created).toHaveBeenCalled();
  });
});
