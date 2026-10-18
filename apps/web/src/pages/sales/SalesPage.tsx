import { useInfiniteQuery } from '@tanstack/react-query';
import { Search } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router';
import { Alert, Button, Card, Skeleton, TextField } from '../../components/ui';
import { api } from '../../lib/api';
import { useAuthContext } from '../../lib/auth-store';
import { useMoney } from '../../lib/catalog';
import { errorMessage } from '../../lib/errors';
import { salesKey, useBusinessDateTime } from '../../lib/sales';

export function SalesPage() {
  const { t } = useTranslation();
  const { tenant, permissions } = useAuthContext();
  const { format: money } = useMoney();
  const dateTime = useBusinessDateTime();
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [q, setQ] = useState('');
  const filters = {
    ...(from ? { from } : {}),
    ...(to ? { to } : {}),
    ...(q.trim() ? { q: q.trim() } : {}),
  };
  const sales = useInfiniteQuery({
    queryKey: [...salesKey(tenant.id), filters],
    queryFn: ({ pageParam }) => api.sales.list({ ...filters, cursor: pageParam, limit: 25 }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
  const items = sales.data?.pages.flatMap((page) => page.items) ?? [];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-neutral-900">
          {t('sales.title')}
        </h1>
        <p className="mt-1 text-sm text-neutral-600">{t('sales.subtitle')}</p>
      </div>
      {permissions.includes('shifts.manage') && (
        <Link
          to="/sales/review"
          className="inline-flex min-h-11 items-center text-sm font-medium text-brand-800 hover:underline"
        >
          {t('review.link')}
        </Link>
      )}
      {permissions.includes('sales.refund') && <FindForReturn />}
      <Card>
        <div className="grid gap-4 sm:grid-cols-3">
          <TextField
            label={t('sales.from')}
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
          />
          <TextField
            label={t('sales.to')}
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
          />
          <TextField
            label={t('sales.search')}
            type="search"
            placeholder="INV-000123"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
      </Card>
      {sales.isPending ? (
        <Card>
          <Skeleton className="h-24 w-full" />
        </Card>
      ) : sales.isError ? (
        <Alert
          tone="danger"
          action={
            <Button variant="secondary" onClick={() => void sales.refetch()}>
              {t('common.retry')}
            </Button>
          }
        >
          {errorMessage(t, sales.error)}
        </Alert>
      ) : items.length === 0 ? (
        <Card>
          <p className="text-sm text-neutral-600">{t('sales.empty')}</p>
        </Card>
      ) : (
        <Card>
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase text-neutral-600">
              <tr>
                <th scope="col" className="py-2 pr-3">
                  {t('sales.number')}
                </th>
                <th scope="col" className="hidden py-2 pr-3 sm:table-cell">
                  {t('sales.date')}
                </th>
                <th scope="col" className="hidden py-2 pr-3 md:table-cell">
                  {t('sales.cashier')}
                </th>
                <th scope="col" className="py-2 pr-3 text-right">
                  {t('sales.total')}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100">
              {items.map((sale) => (
                <tr key={sale.id}>
                  <td className="py-2 pr-3">
                    <Link
                      to={`/sales/${sale.id}`}
                      className="font-mono font-medium text-brand-800 hover:underline"
                    >
                      {sale.number}
                    </Link>
                    <span className="block text-xs text-neutral-600 sm:hidden">
                      {dateTime(sale.createdAt)}
                    </span>
                  </td>
                  <td className="hidden py-2 pr-3 sm:table-cell">{dateTime(sale.createdAt)}</td>
                  <td className="hidden py-2 pr-3 md:table-cell">{sale.cashierName ?? '—'}</td>
                  <td className="py-2 pr-3 text-right tabular-nums">{money(sale.totalMinor)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {sales.hasNextPage && (
            <div className="mt-4 flex justify-center">
              <Button
                variant="secondary"
                loading={sales.isFetchingNextPage}
                onClick={() => void sales.fetchNextPage()}
              >
                {t('sales.loadMore')}
              </Button>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}

/** Opens any sale by its receipt number (from the customer's receipt) to return items. */
function FindForReturn() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [number, setNumber] = useState('');
  return (
    <Card>
      <form
        className="flex flex-wrap items-end gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          if (number.trim())
            navigate(`/sales/number/${encodeURIComponent(number.trim().toUpperCase())}`);
        }}
      >
        <div className="min-w-56 flex-1">
          <TextField
            label={t('sales.findForReturn')}
            hint={t('sales.findHint')}
            value={number}
            autoComplete="off"
            onChange={(e) => setNumber(e.target.value)}
          />
        </div>
        <Button type="submit" variant="secondary">
          <Search aria-hidden className="size-4" />
          {t('sales.find')}
        </Button>
      </form>
    </Card>
  );
}
