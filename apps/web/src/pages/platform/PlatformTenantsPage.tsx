import type { PlatformTenantSummary } from '@pos/contracts';
import { SUBSCRIPTION_STATUSES, type SubscriptionStatus } from '@pos/domain';
import { useInfiniteQuery } from '@tanstack/react-query';
import { useDeferredValue, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { Alert, Badge, Button, Card, SelectField, Skeleton, TextField } from '../../components/ui';
import { errorMessage } from '../../lib/errors';
import { platformApi } from '../../lib/platform';
import { usePlatformFormat } from './PlatformLayout';

export function PlatformTenantsPage() {
  const { t } = useTranslation();
  const { date } = usePlatformFormat();
  const [q, setQ] = useState('');
  const [subscriptionStatus, setSubscriptionStatus] = useState('');
  const [tenantStatus, setTenantStatus] = useState('');
  const query = useDeferredValue(q.trim());
  const list = useInfiniteQuery({
    queryKey: ['platform', 'tenants', query, subscriptionStatus, tenantStatus],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      platformApi.tenants({
        ...(query ? { q: query } : {}),
        ...(subscriptionStatus
          ? { subscriptionStatus: subscriptionStatus as SubscriptionStatus }
          : {}),
        ...(tenantStatus ? { tenantStatus: tenantStatus as PlatformTenantSummary['status'] } : {}),
        ...(pageParam ? { cursor: pageParam } : {}),
      }),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
  const rows = list.data?.pages.flatMap((page) => page.items) ?? [];

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold tracking-tight text-neutral-900">
        {t('platform.tenants.title')}
      </h1>
      <div className="grid gap-3 md:grid-cols-3">
        <TextField
          label={t('platform.tenants.search')}
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <SelectField
          label={t('platform.tenants.subscription')}
          value={subscriptionStatus}
          onChange={(e) => setSubscriptionStatus(e.target.value)}
          options={[
            { value: '', label: t('platform.tenants.any') },
            ...SUBSCRIPTION_STATUSES.map((s) => ({ value: s, label: t(`billing.status.${s}`) })),
          ]}
        />
        <SelectField
          label={t('platform.tenants.account')}
          value={tenantStatus}
          onChange={(e) => setTenantStatus(e.target.value)}
          options={[
            { value: '', label: t('platform.tenants.any') },
            ...(['ACTIVE', 'SUSPENDED', 'CLOSED'] as const).map((s) => ({
              value: s,
              label: t(`platform.tenants.status.${s}`),
            })),
          ]}
        />
      </div>
      {list.isPending ? (
        <Skeleton className="h-40 w-full" />
      ) : list.isError ? (
        <Alert tone="danger">{errorMessage(t, list.error)}</Alert>
      ) : rows.length === 0 ? (
        <Card>
          <p className="text-sm text-neutral-600">{t('platform.tenants.empty')}</p>
        </Card>
      ) : (
        <Card>
          <ul className="divide-y divide-neutral-200">
            {rows.map((tenant) => (
              <li
                key={tenant.id}
                className="flex flex-col gap-1 py-3 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0">
                  <Link
                    to={`/platform/tenants/${tenant.id}`}
                    className="font-medium text-brand-800 hover:underline"
                  >
                    {tenant.name}
                  </Link>
                  <p className="truncate text-xs text-neutral-600">
                    {tenant.slug} · {t('platform.tenants.owner')}: {tenant.ownerEmail ?? '—'} ·{' '}
                    {t('platform.tenants.created')} {date(tenant.createdAt)}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {tenant.status !== 'ACTIVE' && (
                    <Badge tone="warning">{t(`platform.tenants.status.${tenant.status}`)}</Badge>
                  )}
                  {tenant.subscription && (
                    <Badge tone={tenant.subscription.status === 'ACTIVE' ? 'success' : 'neutral'}>
                      {tenant.subscription.planName} ·{' '}
                      {t(`billing.status.${tenant.subscription.status}`)}
                    </Badge>
                  )}
                </div>
              </li>
            ))}
          </ul>
          {list.hasNextPage && (
            <div className="mt-4">
              <Button
                variant="secondary"
                loading={list.isFetchingNextPage}
                onClick={() => void list.fetchNextPage()}
              >
                {t('platform.tenants.more')}
              </Button>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
