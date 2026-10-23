import type { StockRow } from '@pos/contracts';
import { useInfiniteQuery } from '@tanstack/react-query';
import { ArrowLeftRight, ClipboardList, PackagePlus, SlidersHorizontal } from 'lucide-react';
import { INTL_LOCALES, isSupportedLanguage } from '@pos/i18n';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router';
import { Alert, Badge, Button, Card, SelectField, Skeleton } from '../../components/ui';
import { api } from '../../lib/api';
import { useAuthContext } from '../../lib/auth-store';
import { errorMessage } from '../../lib/errors';
import { inventoryKey, useSelectedBranch } from '../../lib/inventory';

const FILTERS = ['ALL', 'IN_STOCK', 'LOW', 'EXPIRING'] as const;

export function StockPage() {
  const { t } = useTranslation();
  const { tenant, permissions } = useAuthContext();
  const canManage = permissions.includes('inventory.manage');
  const canPurchase = permissions.includes('purchasing.manage');
  const [branchId, setBranchId, branches] = useSelectedBranch();
  const [text, setText] = useState('');
  const [q, setQ] = useState('');
  // Links from notifications open a branch and filter: /inventory?branch=…&filter=LOW
  const [params] = useSearchParams();
  const linkedFilter = params.get('filter');
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>(
    FILTERS.find((f) => f === linkedFilter) ?? 'ALL',
  );
  const [open, setOpen] = useState<string | null>(null);
  const linkedBranch = params.get('branch');
  useEffect(() => {
    if (linkedBranch && branches.some((b) => b.id === linkedBranch)) setBranchId(linkedBranch);
    // Only when the link or the branch list changes, not on every selection.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [linkedBranch, branches.length]);

  useEffect(() => {
    const timer = setTimeout(() => setQ(text.trim()), 250);
    return () => clearTimeout(timer);
  }, [text]);

  const query = useInfiniteQuery({
    queryKey: [...inventoryKey(tenant.id), 'stock', { branchId, q, filter }],
    queryFn: ({ pageParam }) =>
      api.stock.list({
        branchId: branchId!,
        q: q || undefined,
        filter,
        days: 30,
        cursor: pageParam,
        limit: 50,
      }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    enabled: !!branchId,
  });
  const rows = query.data?.pages.flatMap((page) => page.items) ?? [];
  const today = new Date().toISOString().slice(0, 10);

  const actions = [
    {
      to: '/inventory/receive',
      label: t('inventory.actions.receive'),
      icon: PackagePlus,
      show: canPurchase,
    },
    {
      to: '/inventory/adjust',
      label: t('inventory.actions.adjust'),
      icon: SlidersHorizontal,
      show: canManage,
    },
    {
      to: '/inventory/transfers',
      label: t('inventory.actions.transfer'),
      icon: ArrowLeftRight,
      show: true,
    },
    {
      to: '/inventory/counts',
      label: t('inventory.actions.count'),
      icon: ClipboardList,
      show: true,
    },
  ].filter((action) => action.show);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-neutral-900">
            {t('inventory.title')}
          </h1>
          <p className="mt-1 text-sm text-neutral-600">{t('inventory.subtitle')}</p>
        </div>
        <nav aria-label={t('inventory.title')} className="flex flex-wrap gap-2">
          {actions.map(({ to, label, icon: Icon }) => (
            <Link
              key={to}
              to={to}
              className="inline-flex min-h-11 items-center gap-2 rounded-md bg-white px-4 text-sm font-semibold text-neutral-800 ring-1 ring-neutral-300 hover:bg-neutral-100"
            >
              <Icon aria-hidden className="size-4" />
              {label}
            </Link>
          ))}
        </nav>
      </div>

      <div className="grid gap-4 md:grid-cols-[14rem_1fr]">
        <SelectField
          label={t('inventory.branch')}
          value={branchId ?? ''}
          onChange={(event) => setBranchId(event.target.value)}
          options={branches.map((b) => ({ value: b.id, label: b.name }))}
        />
        <div className="space-y-1.5">
          <label htmlFor="stock-search" className="block text-sm font-medium text-neutral-800">
            {t('inventory.search')}
          </label>
          <input
            id="stock-search"
            type="search"
            value={text}
            onChange={(event) => setText(event.target.value)}
            className="block min-h-11 w-full rounded-md border border-neutral-300 bg-white px-3 text-base focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-600/30"
          />
        </div>
      </div>

      <div role="group" aria-label={t('inventory.filters.ALL')} className="flex flex-wrap gap-2">
        {FILTERS.map((value) => (
          <button
            key={value}
            type="button"
            aria-pressed={filter === value}
            onClick={() => setFilter(value)}
            className={`min-h-10 rounded-full px-4 text-sm font-medium ring-1 ${
              filter === value
                ? 'bg-brand-700 text-white ring-brand-700'
                : 'bg-white text-neutral-700 ring-neutral-300 hover:bg-neutral-50'
            }`}
          >
            {t(`inventory.filters.${value}`)}
          </button>
        ))}
        {filter === 'EXPIRING' && (
          <span className="self-center text-xs text-neutral-600">
            {t('inventory.expiringWithin', { days: 30 })}
          </span>
        )}
      </div>

      {!branchId || query.isPending ? (
        <Card>
          <div className="space-y-3" aria-busy="true" aria-label={t('common.loading')}>
            {Array.from({ length: 5 }, (_, i) => (
              <Skeleton key={i} className="h-8 w-full" />
            ))}
          </div>
        </Card>
      ) : query.isError ? (
        <Alert
          tone="danger"
          action={
            <Button variant="secondary" onClick={() => void query.refetch()}>
              {t('common.retry')}
            </Button>
          }
        >
          {errorMessage(t, query.error)}
        </Alert>
      ) : rows.length === 0 ? (
        <Card>
          <p className="text-sm text-neutral-600">
            {filter === 'ALL' && !q ? t('inventory.empty') : t('inventory.noStock')}
          </p>
        </Card>
      ) : (
        <Card>
          <ul className="-mx-5 divide-y divide-neutral-100">
            {rows.map((row) => (
              <StockItem
                key={row.variantId}
                row={row}
                today={today}
                branchId={branchId}
                open={open === row.variantId}
                onToggle={() => setOpen(open === row.variantId ? null : row.variantId)}
              />
            ))}
          </ul>
          {query.hasNextPage && (
            <div className="mt-4 flex justify-center">
              <Button
                variant="secondary"
                onClick={() => void query.fetchNextPage()}
                loading={query.isFetchingNextPage}
              >
                {t('inventory.loadMore')}
              </Button>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}

function StockItem({
  row,
  today,
  branchId,
  open,
  onToggle,
}: {
  row: StockRow;
  today: string;
  branchId: string;
  open: boolean;
  onToggle: () => void;
}) {
  const { t } = useTranslation();
  const unit = t(`settings.profile.units.${row.unit}`, { defaultValue: row.unit });
  const expired = row.nextExpiry !== null && row.nextExpiry < today;
  return (
    <li className="px-5 py-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0 text-sm">
          <div className="font-medium text-neutral-900">
            {row.productName}
            {row.variantLabel && (
              <span className="font-normal text-neutral-600"> — {row.variantLabel}</span>
            )}
          </div>
          <div className="font-mono text-xs text-neutral-600">{row.sku}</div>
        </div>
        <div className="flex flex-wrap items-center gap-3 sm:justify-end">
          {row.low && <Badge tone="warning">{t('inventory.low')}</Badge>}
          {row.nextExpiry && (
            <span
              className={`text-xs ${expired ? 'font-semibold text-danger-700' : 'text-neutral-600'}`}
            >
              {expired ? t('inventory.expired') : t('inventory.columns.expiry')}: {row.nextExpiry}
            </span>
          )}
          <span className="min-w-24 text-right text-base font-semibold tabular-nums text-neutral-900">
            {row.quantity} <span className="text-xs font-normal text-neutral-600">{unit}</span>
          </span>
          <Button variant="ghost" aria-expanded={open} onClick={onToggle}>
            {open ? t('inventory.hideHistory') : t('inventory.history')}
          </Button>
        </div>
      </div>
      {open && <StockDetail row={row} branchId={branchId} />}
    </li>
  );
}

function StockDetail({ row, branchId }: { row: StockRow; branchId: string }) {
  const { t, i18n } = useTranslation();
  const movements = useInfiniteQuery({
    queryKey: ['movements', row.variantId, branchId],
    queryFn: ({ pageParam }) =>
      api.stock.movements({ variantId: row.variantId, branchId, cursor: pageParam, limit: 20 }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
  const items = movements.data?.pages.flatMap((page) => page.items) ?? [];
  const locale = isSupportedLanguage(i18n.resolvedLanguage)
    ? INTL_LOCALES[i18n.resolvedLanguage]
    : 'en-LK';
  const date = new Intl.DateTimeFormat(locale, {
    dateStyle: 'medium',
    timeStyle: 'short',
  });

  return (
    <div className="mt-3 space-y-4 rounded-md bg-neutral-50 p-4">
      {row.batches.some((b) => b.batchNumber) && (
        <div>
          <h3 className="mb-1 text-xs font-semibold text-neutral-600">{t('inventory.batches')}</h3>
          <ul className="space-y-1 text-sm">
            {row.batches.map((batch) => (
              <li key={batch.batchId ?? 'none'} className="flex justify-between gap-4">
                <span>
                  {batch.batchNumber ?? t('inventory.noBatch')}
                  {batch.expiryDate && (
                    <span className="text-neutral-600"> · {batch.expiryDate}</span>
                  )}
                </span>
                <span className="tabular-nums">{batch.quantity}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      <div>
        <h3 className="mb-1 text-xs font-semibold text-neutral-600">{t('inventory.history')}</h3>
        {movements.isPending ? (
          <Skeleton className="h-16 w-full" />
        ) : movements.isError ? (
          <p className="text-sm text-danger-700">{errorMessage(t, movements.error)}</p>
        ) : items.length === 0 ? (
          <p className="text-sm text-neutral-600">{t('inventory.historyEmpty')}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <tbody className="divide-y divide-neutral-200">
                {items.map((m) => (
                  <tr key={m.id}>
                    <td className="whitespace-nowrap py-1.5 pr-4 text-neutral-600">
                      {date.format(new Date(m.createdAt))}
                    </td>
                    <td className="py-1.5 pr-4">
                      {t(`inventory.movement.${m.type}`)}
                      {m.reason && (
                        <span className="text-neutral-600">
                          {' '}
                          · {t(`inventory.reasons.${m.reason}`)}
                        </span>
                      )}
                      {m.referenceNumber && (
                        <span className="font-mono text-xs text-neutral-600">
                          {' '}
                          · {m.referenceNumber}
                        </span>
                      )}
                    </td>
                    <td
                      className={`py-1.5 pr-4 text-right tabular-nums ${m.quantity.startsWith('-') ? 'text-danger-700' : 'text-success-700'}`}
                    >
                      {m.quantity.startsWith('-') ? m.quantity : `+${m.quantity}`}
                    </td>
                    <td className="py-1.5 text-right tabular-nums text-neutral-700">
                      <span className="sr-only">{t('inventory.balance')}: </span>
                      {m.balanceAfter}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {movements.hasNextPage && (
          <Button
            variant="ghost"
            onClick={() => void movements.fetchNextPage()}
            loading={movements.isFetchingNextPage}
          >
            {t('inventory.loadMore')}
          </Button>
        )}
      </div>
    </div>
  );
}
