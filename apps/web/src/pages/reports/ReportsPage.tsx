import { formatPercent } from '@pos/domain';
import { useQuery } from '@tanstack/react-query';
import { Download, Printer } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router';
import { Alert, Button, Card, SelectField, Skeleton, TextField } from '../../components/ui';
import { api } from '../../lib/api';
import { useAuthContext } from '../../lib/auth-store';
import { downloadText, useMoney } from '../../lib/catalog';
import { errorMessage } from '../../lib/errors';
import { useActiveBranches } from '../../lib/inventory';
import { useBusinessDateTime } from '../../lib/sales';

const TABS = ['sales', 'tax', 'profit', 'stock', 'receivables', 'shifts'] as const;
type Tab = (typeof TABS)[number];
const COST_TABS: Tab[] = ['profit', 'stock'];

interface Column<T> {
  header: string;
  cell: (row: T) => ReactNode;
  numeric?: boolean;
}

/** A report table with a total row; numbers right-aligned and tabular. */
function ReportTable<T>({
  rows,
  columns,
  total,
  caption,
  empty,
}: {
  rows: T[];
  columns: Column<T>[];
  total?: T;
  caption: string;
  empty: string;
}) {
  if (rows.length === 0) return <p className="text-sm text-neutral-600">{empty}</p>;
  return (
    <div className="-mx-5 overflow-x-auto px-5">
      <table className="w-full min-w-[36rem] text-sm">
        <caption className="sr-only">{caption}</caption>
        <thead className="text-left text-xs font-medium text-neutral-600">
          <tr>
            {columns.map((c) => (
              <th
                key={c.header}
                scope="col"
                className={`py-2 pr-3 ${c.numeric ? 'text-right' : ''}`}
              >
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-neutral-100">
          {rows.map((row, index) => (
            <tr key={index}>
              {columns.map((c) => (
                <td
                  key={c.header}
                  className={`py-2 pr-3 ${c.numeric ? 'text-right tabular-nums' : ''}`}
                >
                  {c.cell(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
        {total && (
          <tfoot className="border-t-2 border-neutral-300 font-semibold">
            <tr>
              {columns.map((c, i) => (
                <td
                  key={c.header}
                  className={`py-2 pr-3 ${c.numeric ? 'text-right tabular-nums' : ''}`}
                >
                  {i === 0 ? (c.cell(total) ?? '') : c.cell(total)}
                </td>
              ))}
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  );
}

const signedPercent = (bp: number | null) =>
  bp === null ? '—' : `${bp < 0 ? '-' : ''}${formatPercent(Math.abs(bp))}%`;

export function ReportsPage() {
  const { t } = useTranslation();
  const { permissions, branchIds } = useAuthContext();
  const [params, setParams] = useSearchParams();
  const canCost = permissions.includes('reports.profit');
  const tabs = TABS.filter((tab) => canCost || !COST_TABS.includes(tab));
  const requested = params.get('tab') as Tab | null;
  const tab: Tab = requested && tabs.includes(requested) ? requested : 'sales';
  const branches = useActiveBranches();
  const [filters, setFilters] = useState({
    from: '',
    to: '',
    branchId: branchIds?.[0] ?? '',
    salesGroup: 'day',
    profitGroup: 'day',
  });
  const range = {
    ...(filters.from ? { from: filters.from } : {}),
    ...(filters.to ? { to: filters.to } : {}),
    ...(filters.branchId ? { branchId: filters.branchId } : {}),
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-neutral-900">
          {t('reports.title')}
        </h1>
        <p className="mt-1 text-sm text-neutral-600">{t('reports.subtitle')}</p>
      </div>
      <nav aria-label={t('reports.title')} className="-mx-4 overflow-x-auto px-4 print:hidden">
        <ul className="flex min-w-max gap-1 border-b border-neutral-200">
          {tabs.map((value) => (
            <li key={value}>
              <button
                type="button"
                aria-current={tab === value ? 'page' : undefined}
                onClick={() => setParams({ tab: value })}
                className={`-mb-px flex min-h-11 items-center border-b-2 px-3 text-sm font-medium ${
                  tab === value
                    ? 'border-brand-700 text-brand-800'
                    : 'border-transparent text-neutral-600 hover:text-neutral-900'
                }`}
              >
                {t(`reports.tabs.${value}`)}
              </button>
            </li>
          ))}
        </ul>
      </nav>
      {['sales', 'tax', 'profit', 'stock'].includes(tab) && (
        <Card className="print:hidden">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {tab !== 'stock' && (
              <>
                <TextField
                  label={t('reports.from')}
                  type="date"
                  value={filters.from}
                  onChange={(e) => setFilters({ ...filters, from: e.target.value })}
                />
                <TextField
                  label={t('reports.to')}
                  type="date"
                  value={filters.to}
                  onChange={(e) => setFilters({ ...filters, to: e.target.value })}
                />
              </>
            )}
            <SelectField
              label={t('reports.branch')}
              value={filters.branchId}
              onChange={(e) => setFilters({ ...filters, branchId: e.target.value })}
              options={[
                ...(branchIds ? [] : [{ value: '', label: t('reports.allBranches') }]),
                ...(branches.data ?? []).map((b) => ({ value: b.id, label: b.name })),
              ]}
            />
            {tab === 'sales' && (
              <SelectField
                label={t('reports.groupBy')}
                value={filters.salesGroup}
                onChange={(e) => setFilters({ ...filters, salesGroup: e.target.value })}
                options={['day', 'branch', 'cashier', 'category', 'product', 'payment_method'].map(
                  (g) => ({ value: g, label: t(`reports.groups.${g}`) }),
                )}
              />
            )}
            {tab === 'profit' && (
              <SelectField
                label={t('reports.groupBy')}
                value={filters.profitGroup}
                onChange={(e) => setFilters({ ...filters, profitGroup: e.target.value })}
                options={['day', 'category', 'product'].map((g) => ({
                  value: g,
                  label: t(`reports.groups.${g}`),
                }))}
              />
            )}
          </div>
        </Card>
      )}
      {tab === 'sales' && <SalesReportView range={range} groupBy={filters.salesGroup as never} />}
      {tab === 'tax' && <TaxReportView range={range} />}
      {tab === 'profit' && (
        <ProfitReportView range={range} groupBy={filters.profitGroup as never} />
      )}
      {tab === 'stock' && <StockReportView branchId={filters.branchId} />}
      {tab === 'receivables' && <ReceivablesView />}
      {tab === 'shifts' && <ShiftsView />}
    </div>
  );
}

/** Frame shared by all reports: title, period, CSV download and print (save as PDF). */
function ReportFrame({
  title,
  period,
  csv,
  children,
}: {
  title: string;
  period?: string;
  csv?: {
    report: Parameters<typeof api.reports.csv>[0];
    query: Record<string, string | undefined>;
    filename: string;
  };
  children: ReactNode;
}) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <Card>
      <div className="print-area space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-base font-semibold text-neutral-900">{title}</h2>
            {period && <p className="text-sm text-neutral-600">{period}</p>}
          </div>
          <div className="flex gap-2 print:hidden">
            {csv && (
              <Button
                variant="secondary"
                loading={busy}
                onClick={async () => {
                  setBusy(true);
                  setError(null);
                  try {
                    downloadText(
                      `${csv.filename}.csv`,
                      await api.reports.csv(csv.report, csv.query),
                    );
                  } catch (e) {
                    setError(errorMessage(t, e));
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                <Download aria-hidden className="size-4" />
                {t('reports.csv')}
              </Button>
            )}
            <Button variant="secondary" onClick={() => window.print()}>
              <Printer aria-hidden className="size-4" />
              {t('reports.print')}
            </Button>
          </div>
        </div>
        {error && <Alert tone="danger">{error}</Alert>}
        {children}
      </div>
    </Card>
  );
}

function useReport<T>(key: unknown[], fn: () => Promise<T>) {
  const { tenant } = useAuthContext();
  return useQuery({ queryKey: ['report', tenant.id, ...key], queryFn: fn });
}

function Loading({ query }: { query: { isPending: boolean; isError: boolean; error: unknown } }) {
  const { t } = useTranslation();
  if (query.isPending) return <Skeleton className="h-40 w-full" />;
  if (query.isError) return <Alert tone="danger">{errorMessage(t, query.error)}</Alert>;
  return null;
}

type Range = { from?: string; to?: string; branchId?: string };

function SalesReportView({ range, groupBy }: { range: Range; groupBy: 'day' }) {
  const { t } = useTranslation();
  const { format: money } = useMoney();
  const report = useReport(['sales', range, groupBy], () =>
    api.reports.sales({ ...range, groupBy }),
  );
  if (!report.data) return <Loading query={report} />;
  const r = report.data;
  const label = (row: (typeof r.rows)[number]) =>
    groupBy === ('payment_method' as never) ? t(`paymentMethods.${row.key}`) : row.label;
  type Row = (typeof r.rows)[number];
  const total = { key: 'total', label: t('reports.total'), ...r.totals } as Row;
  return (
    <ReportFrame
      title={`${t('reports.tabs.sales')} · ${t(`reports.groups.${groupBy}`)}`}
      period={`${r.from} – ${r.to}`}
      csv={{
        report: 'sales',
        query: { ...range, groupBy },
        filename: `sales-${groupBy}-${r.from}-${r.to}`,
      }}
    >
      <ReportTable<Row>
        caption={t('reports.tabs.sales')}
        empty={t('reports.empty')}
        rows={r.rows}
        total={total}
        columns={[
          {
            header: t(`reports.groups.${groupBy}`),
            cell: (row) => (row === total ? row.label : label(row)),
          },
          { header: t('reports.cols.sales'), cell: (row) => row.saleCount, numeric: true },
          ...(r.rows.some((x) => x.quantity !== null)
            ? [
                {
                  header: t('reports.cols.quantity'),
                  cell: (row: Row) => row.quantity ?? '',
                  numeric: true,
                },
              ]
            : []),
          {
            header: t('reports.cols.discount'),
            cell: (row) => money(row.discountMinor),
            numeric: true,
          },
          { header: t('reports.cols.tax'), cell: (row) => money(row.taxMinor), numeric: true },
          { header: t('reports.cols.total'), cell: (row) => money(row.totalMinor), numeric: true },
          {
            header: t('reports.cols.refunds'),
            cell: (row) => money(row.refundsMinor),
            numeric: true,
          },
          { header: t('reports.cols.net'), cell: (row) => money(row.netMinor), numeric: true },
        ]}
      />
    </ReportFrame>
  );
}

function TaxReportView({ range }: { range: Range }) {
  const { t } = useTranslation();
  const { format: money } = useMoney();
  const report = useReport(['tax', range], () => api.reports.tax(range));
  if (!report.data) return <Loading query={report} />;
  const r = report.data;
  type Row = (typeof r.rows)[number];
  const total = { name: t('reports.total'), rateBp: -1, ...r.totals } as Row;
  return (
    <ReportFrame
      title={t('reports.tabs.tax')}
      period={`${r.from} – ${r.to}`}
      csv={{ report: 'tax', query: range, filename: `tax-${r.from}-${r.to}` }}
    >
      <ReportTable<Row>
        caption={t('reports.tabs.tax')}
        empty={t('reports.empty')}
        rows={r.rows}
        total={total}
        columns={[
          { header: t('reports.cols.taxName'), cell: (row) => row.name ?? t('reports.noTaxName') },
          {
            header: t('reports.cols.rate'),
            cell: (row) => (row.rateBp < 0 ? '' : `${formatPercent(row.rateBp)}%`),
            numeric: true,
          },
          {
            header: t('reports.cols.taxable'),
            cell: (row) => money(row.taxableMinor),
            numeric: true,
          },
          { header: t('reports.cols.tax'), cell: (row) => money(row.taxMinor), numeric: true },
          {
            header: t('reports.cols.refundedTax'),
            cell: (row) => money(row.refundedTaxMinor),
            numeric: true,
          },
          {
            header: t('reports.cols.netTax'),
            cell: (row) => money(row.netTaxMinor),
            numeric: true,
          },
        ]}
      />
    </ReportFrame>
  );
}

function ProfitReportView({ range, groupBy }: { range: Range; groupBy: 'day' }) {
  const { t } = useTranslation();
  const { format: money } = useMoney();
  const report = useReport(['profit', range, groupBy], () =>
    api.reports.profit({ ...range, groupBy }),
  );
  if (!report.data) return <Loading query={report} />;
  const r = report.data;
  type Row = (typeof r.rows)[number];
  const total = { key: 'total', label: t('reports.total'), ...r.totals } as Row;
  return (
    <ReportFrame
      title={`${t('reports.tabs.profit')} · ${t(`reports.groups.${groupBy}`)}`}
      period={`${r.from} – ${r.to}`}
      csv={{
        report: 'profit',
        query: { ...range, groupBy },
        filename: `profit-${groupBy}-${r.from}-${r.to}`,
      }}
    >
      <p className="text-xs text-neutral-600">{t('reports.profitNote')}</p>
      {r.totals.unknownCostQuantity !== '0' && (
        <Alert tone="warning">
          {t('reports.unknownCost', { quantity: r.totals.unknownCostQuantity })}
        </Alert>
      )}
      <ReportTable<Row>
        caption={t('reports.tabs.profit')}
        empty={t('reports.empty')}
        rows={r.rows}
        total={total}
        columns={[
          { header: t(`reports.groups.${groupBy}`), cell: (row) => row.label },
          {
            header: t('reports.cols.revenue'),
            cell: (row) => money(row.revenueMinor),
            numeric: true,
          },
          { header: t('reports.cols.cost'), cell: (row) => money(row.costMinor), numeric: true },
          {
            header: t('reports.cols.profit'),
            cell: (row) => money(row.profitMinor),
            numeric: true,
          },
          {
            header: t('reports.cols.margin'),
            cell: (row) => signedPercent(row.marginBp),
            numeric: true,
          },
        ]}
      />
    </ReportFrame>
  );
}

function StockReportView({ branchId }: { branchId: string }) {
  const { t } = useTranslation();
  const { format: money } = useMoney();
  const query = branchId ? { branchId } : {};
  const report = useReport(['stock', branchId], () => api.reports.stockValuation(query));
  const dateTime = useBusinessDateTime();
  if (!report.data) return <Loading query={report} />;
  const r = report.data;
  type Row = (typeof r.rows)[number];
  const total = {
    variantId: 'total',
    sku: t('reports.total'),
    productName: '',
    variantLabel: '',
    quantity: '',
    averageCostMinor: null,
    valueMinor: r.totals.valueMinor,
  } as Row;
  return (
    <ReportFrame
      title={t('reports.tabs.stock')}
      period={t('reports.asOf', { time: dateTime(r.asOf) })}
      csv={{ report: 'stock-valuation', query, filename: `stock-valuation-${r.asOf.slice(0, 10)}` }}
    >
      {r.totals.itemsWithoutCost > 0 && (
        <Alert tone="warning">
          {t('reports.withoutCost', { count: r.totals.itemsWithoutCost })}
        </Alert>
      )}
      <ReportTable<Row>
        caption={t('reports.tabs.stock')}
        empty={t('reports.empty')}
        rows={r.rows}
        total={total}
        columns={[
          {
            header: t('reports.cols.sku'),
            cell: (row) => <span className="font-mono text-xs">{row.sku}</span>,
          },
          {
            header: t('reports.cols.product'),
            cell: (row) => `${row.productName}${row.variantLabel ? ` (${row.variantLabel})` : ''}`,
          },
          { header: t('reports.cols.quantity'), cell: (row) => row.quantity, numeric: true },
          {
            header: t('reports.cols.averageCost'),
            cell: (row) =>
              row.averageCostMinor === null
                ? row === total
                  ? ''
                  : '—'
                : money(row.averageCostMinor),
            numeric: true,
          },
          {
            header: t('reports.cols.value'),
            cell: (row) => (row.valueMinor === null ? '—' : money(row.valueMinor)),
            numeric: true,
          },
        ]}
      />
    </ReportFrame>
  );
}

function ReceivablesView() {
  const { t } = useTranslation();
  const { format: money } = useMoney();
  const report = useReport(['receivables'], () => api.reports.receivables());
  const dateTime = useBusinessDateTime();
  if (!report.data) return <Loading query={report} />;
  const r = report.data;
  type Row = (typeof r.rows)[number];
  const total = {
    customerId: 'total',
    number: '',
    name: t('reports.total'),
    phone: null,
    ...r.totals,
  } as Row;
  return (
    <ReportFrame
      title={t('reports.tabs.receivables')}
      period={t('reports.asOf', { time: dateTime(r.asOf) })}
      csv={{ report: 'receivables', query: {}, filename: `receivables-${r.asOf.slice(0, 10)}` }}
    >
      <ReportTable<Row>
        caption={t('reports.tabs.receivables')}
        empty={t('reports.noReceivables')}
        rows={r.rows}
        total={total}
        columns={[
          {
            header: t('reports.cols.customer'),
            cell: (row) =>
              row === total ? (
                row.name
              ) : (
                <Link
                  className="text-brand-800 hover:underline"
                  to={`/customers/${row.customerId}`}
                >
                  {row.name}
                </Link>
              ),
          },
          {
            header: t('reports.cols.balance'),
            cell: (row) => money(row.balanceMinor),
            numeric: true,
          },
          { header: t('reports.ageing.0_30'), cell: (row) => money(row['0_30']), numeric: true },
          { header: t('reports.ageing.31_60'), cell: (row) => money(row['31_60']), numeric: true },
          { header: t('reports.ageing.61_90'), cell: (row) => money(row['61_90']), numeric: true },
          { header: t('reports.ageing.OVER_90'), cell: (row) => money(row.OVER_90), numeric: true },
        ]}
      />
    </ReportFrame>
  );
}

function ShiftsView() {
  const { t } = useTranslation();
  const { permissions } = useAuthContext();
  const { format: money } = useMoney();
  const dateTime = useBusinessDateTime();
  const shifts = useReport(['shifts'], () => api.shifts.list({ limit: 50 }));
  if (!permissions.includes('shifts.manage'))
    return <Alert tone="info">{t('reports.shiftsNeedManager')}</Alert>;
  if (!shifts.data) return <Loading query={shifts} />;
  type Row = (typeof shifts.data.items)[number];
  return (
    <Card title={t('reports.tabs.shifts')}>
      <ReportTable<Row>
        caption={t('reports.tabs.shifts')}
        empty={t('reports.empty')}
        rows={shifts.data.items}
        columns={[
          {
            header: t('reports.cols.shift'),
            cell: (row) => (
              <Link
                className="font-mono text-brand-800 hover:underline"
                to={`/reports/shifts/${row.id}`}
              >
                {row.number}
              </Link>
            ),
          },
          {
            header: t('reports.cols.register'),
            cell: (row) => `${row.branchName} › ${row.registerName}`,
          },
          { header: t('reports.cols.cashier'), cell: (row) => row.openedByName },
          { header: t('reports.cols.opened'), cell: (row) => dateTime(row.openedAt) },
          {
            header: t('reports.cols.sales'),
            cell: (row) => money(row.summary.salesTotalMinor),
            numeric: true,
          },
          {
            header: t('reports.cols.difference'),
            cell: (row) =>
              row.differenceMinor === null ? t('reports.stillOpen') : money(row.differenceMinor),
            numeric: true,
          },
        ]}
      />
    </Card>
  );
}
