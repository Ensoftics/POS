import { INTL_LOCALES, isSupportedLanguage } from '@pos/i18n';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, ArrowDownRight, ArrowUpRight } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { SalesTrendChart } from '../../components/SalesTrendChart';
import { Alert, Card, Skeleton } from '../../components/ui';
import { api } from '../../lib/api';
import { useAuthContext } from '../../lib/auth-store';
import { useMoney } from '../../lib/catalog';
import { errorMessage } from '../../lib/errors';

/** Today at a glance for owners and managers: tiles, the last seven days, what needs attention. */
export function BusinessOverview() {
  const { t, i18n } = useTranslation();
  const { tenant, branchIds } = useAuthContext();
  const { format: money } = useMoney();
  // Staff limited to some branches see their first branch; everyone else the whole business.
  const branchId = branchIds?.[0];
  const dashboard = useQuery({
    queryKey: ['dashboard', tenant.id, branchId],
    queryFn: () => api.reports.dashboard(branchId ? { branchId } : {}),
    refetchInterval: 60_000,
  });
  const locale = isSupportedLanguage(i18n.resolvedLanguage)
    ? INTL_LOCALES[i18n.resolvedLanguage]
    : 'en-LK';
  const day = new Intl.DateTimeFormat(locale, {
    weekday: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });

  if (dashboard.isPending) return <Skeleton className="h-48 w-full" />;
  if (dashboard.isError) return <Alert tone="danger">{errorMessage(t, dashboard.error)}</Alert>;
  const d = dashboard.data;
  const today = d.todayTotals;
  const yesterday = d.yesterdayTotals;

  const tiles: Array<{
    label: string;
    value: string;
    now: number;
    before: number;
    upIsGood: boolean;
  }> = [
    {
      label: t('overview.sales'),
      value: money(today.salesMinor),
      now: today.salesMinor,
      before: yesterday.salesMinor,
      upIsGood: true,
    },
    {
      label: t('overview.count'),
      value: String(today.saleCount),
      now: today.saleCount,
      before: yesterday.saleCount,
      upIsGood: true,
    },
    {
      label: t('overview.average'),
      value: money(today.averageSaleMinor),
      now: today.averageSaleMinor,
      before: yesterday.averageSaleMinor,
      upIsGood: true,
    },
    {
      label: t('overview.refunds'),
      value: money(today.refundsMinor),
      now: today.refundsMinor,
      before: yesterday.refundsMinor,
      upIsGood: false,
    },
  ];
  const attention = [
    d.lowStockCount > 0 && {
      to: '/inventory',
      text: t('overview.lowStock', { count: d.lowStockCount }),
    },
    d.openConflicts > 0 && {
      to: '/sales/review',
      text: t('overview.conflicts', { count: d.openConflicts }),
    },
    d.receivablesMinor > 0 && {
      to: '/reports?tab=receivables',
      text: t('overview.receivables', { amount: money(d.receivablesMinor) }),
    },
    d.openShifts > 0 && {
      to: '/reports?tab=shifts',
      text: t('overview.openShifts', { count: d.openShifts }),
    },
  ].filter((x): x is { to: string; text: string } => !!x);

  return (
    <section aria-labelledby="overview-title" className="space-y-4">
      <div className="flex items-end justify-between">
        <h2 id="overview-title" className="text-lg font-semibold text-neutral-900">
          {t('overview.title')}
        </h2>
        <Link to="/reports" className="text-sm font-medium text-brand-800 hover:underline">
          {t('overview.allReports')}
        </Link>
      </div>
      <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {tiles.map((tile) => {
          const change = tile.now - tile.before;
          const good = change === 0 ? null : change > 0 === tile.upIsGood;
          return (
            <div
              key={tile.label}
              className="rounded-lg bg-white p-4 shadow-sm ring-1 ring-neutral-200"
            >
              <dt className="text-sm text-neutral-600">{tile.label}</dt>
              <dd className="mt-1 text-2xl font-semibold tabular-nums text-neutral-900">
                {tile.value}
              </dd>
              <dd className="mt-1 flex items-center gap-1 text-xs text-neutral-600">
                {change !== 0 &&
                  (change > 0 ? (
                    <ArrowUpRight
                      aria-hidden
                      className={`size-4 ${good ? 'text-success-700' : 'text-danger-700'}`}
                    />
                  ) : (
                    <ArrowDownRight
                      aria-hidden
                      className={`size-4 ${good ? 'text-success-700' : 'text-danger-700'}`}
                    />
                  ))}
                {change === 0
                  ? t('overview.same')
                  : change > 0
                    ? t('overview.up')
                    : t('overview.down')}
              </dd>
            </div>
          );
        })}
      </dl>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <Card title={t('overview.week')}>
          <SalesTrendChart
            title={t('overview.week')}
            points={d.last7Days.map((x) => ({
              date: x.date,
              valueMinor: x.salesMinor,
              count: x.saleCount,
            }))}
            formatMoney={money}
            formatDay={(date) => day.format(new Date(`${date}T00:00:00Z`))}
            countLabel={(count) => t('overview.salesCount', { count })}
          />
        </Card>
        <Card title={t('overview.top')}>
          {d.topProducts.length === 0 ? (
            <p className="text-sm text-neutral-600">{t('overview.noSalesToday')}</p>
          ) : (
            <ol className="space-y-2 text-sm">
              {d.topProducts.map((p) => (
                <li key={p.label} className="flex justify-between gap-2">
                  <span className="truncate">
                    {p.label} <span className="text-neutral-500">× {p.quantity}</span>
                  </span>
                  <span className="tabular-nums">{money(p.totalMinor)}</span>
                </li>
              ))}
            </ol>
          )}
        </Card>
      </div>
      {attention.length > 0 && (
        <ul className="flex flex-wrap gap-2">
          {attention.map((a) => (
            <li key={a.to}>
              <Link
                to={a.to}
                className="inline-flex min-h-11 items-center gap-2 rounded-md bg-warning-50 px-3 text-sm text-warning-700 ring-1 ring-warning-600/20 hover:underline"
              >
                <AlertTriangle aria-hidden className="size-4" />
                {a.text}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
