import { SUBSCRIPTION_STATUSES } from '@pos/domain';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Alert, Badge, Card, Skeleton } from '../../components/ui';
import { errorMessage } from '../../lib/errors';
import { platformApi } from '../../lib/platform';
import { usePlatformFormat } from './PlatformLayout';

export function PlatformOverviewPage() {
  const { t } = useTranslation();
  const { money, dateTime } = usePlatformFormat();
  const overview = useQuery({
    queryKey: ['platform', 'overview'],
    queryFn: () => platformApi.overview(),
    refetchInterval: 60_000,
  });
  if (overview.isPending) return <Skeleton className="h-48 w-full" />;
  if (overview.isError) return <Alert tone="danger">{errorMessage(t, overview.error)}</Alert>;
  const o = overview.data;
  const tiles = [
    { label: t('platform.overview.businesses'), value: String(o.tenants.total) },
    { label: t('platform.overview.signups'), value: String(o.tenants.signupsLast30Days) },
    {
      label: t('platform.overview.mrr'),
      value: money(o.revenue.monthlyRecurringMinor, o.revenue.currency),
      hint: t('platform.overview.mrrHint'),
    },
    {
      label: t('platform.overview.paid30'),
      value: money(o.revenue.paidLast30DaysMinor, o.revenue.currency),
      hint: t('platform.overview.payments30', { count: o.revenue.paymentsLast30Days }),
    },
  ];

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight text-neutral-900">
        {t('platform.overview.title')}
      </h1>
      <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {tiles.map((tile) => (
          <div
            key={tile.label}
            className="rounded-lg bg-white p-4 shadow-sm ring-1 ring-neutral-200"
          >
            <dt className="text-sm text-neutral-600">{tile.label}</dt>
            <dd className="mt-1 text-2xl font-semibold tabular-nums text-neutral-900">
              {tile.value}
            </dd>
            {tile.hint && <dd className="mt-1 text-xs text-neutral-500">{tile.hint}</dd>}
          </div>
        ))}
      </dl>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title={t('platform.overview.subscriptions')}>
          <table className="w-full text-sm">
            <tbody className="divide-y divide-neutral-200">
              {SUBSCRIPTION_STATUSES.map((status) => (
                <tr key={status}>
                  <th scope="row" className="py-2 text-left font-normal">
                    {t(`billing.status.${status}`)}
                  </th>
                  <td className="py-2 text-right tabular-nums">{o.subscriptions[status] ?? 0}</td>
                </tr>
              ))}
              <tr>
                <th scope="row" className="py-2 text-left font-normal">
                  {t('platform.overview.suspended')}
                </th>
                <td className="py-2 text-right tabular-nums">{o.tenants.suspended}</td>
              </tr>
              <tr>
                <th scope="row" className="py-2 text-left font-normal">
                  {t('platform.overview.closed')}
                </th>
                <td className="py-2 text-right tabular-nums">{o.tenants.closed}</td>
              </tr>
            </tbody>
          </table>
        </Card>
        <Card title={t('platform.overview.payments')}>
          <dl className="space-y-3 text-sm">
            <div className="flex justify-between gap-4">
              <dt>{t('platform.overview.payments')}</dt>
              <dd>
                <Badge tone={o.paymentsConfigured ? 'success' : 'warning'}>
                  {o.paymentsConfigured
                    ? t('platform.overview.paymentsOn')
                    : t('platform.overview.paymentsOff')}
                </Badge>
              </dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt>{t('platform.overview.sweep')}</dt>
              <dd>
                {o.lastBillingSweepAt
                  ? dateTime(o.lastBillingSweepAt)
                  : t('platform.overview.never')}
              </dd>
            </div>
          </dl>
        </Card>
      </div>
    </div>
  );
}
