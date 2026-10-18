import type { SaleConflict } from '@pos/contracts';
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { Alert, Badge, Button, Card, Skeleton, TextField } from '../../components/ui';
import { api } from '../../lib/api';
import { useAuthContext } from '../../lib/auth-store';
import { useMoney } from '../../lib/catalog';
import { errorMessage } from '../../lib/errors';
import { useBusinessDateTime } from '../../lib/sales';

const conflictsKey = (tenantId: string, status: string) => ['conflicts', tenantId, status];

/** Offline sales whose details differed from the server's when they synced. */
export function ReviewPage() {
  const { t } = useTranslation();
  const { tenant } = useAuthContext();
  const [status, setStatus] = useState<'OPEN' | 'RESOLVED'>('OPEN');
  const conflicts = useInfiniteQuery({
    queryKey: conflictsKey(tenant.id, status),
    queryFn: ({ pageParam }) => api.sync.conflicts({ status, cursor: pageParam, limit: 25 }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
  const items = conflicts.data?.pages.flatMap((page) => page.items) ?? [];

  return (
    <div className="space-y-6">
      <Link
        to="/sales"
        className="inline-flex min-h-11 items-center gap-1 text-sm font-medium text-brand-800 hover:underline"
      >
        <ArrowLeft aria-hidden className="size-4" />
        {t('sales.receipt.back')}
      </Link>
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-neutral-900">
          {t('review.title')}
        </h1>
        <p className="mt-1 text-sm text-neutral-600">{t('review.subtitle')}</p>
      </div>
      <div role="tablist" className="flex gap-2">
        {(['OPEN', 'RESOLVED'] as const).map((value) => (
          <Button
            key={value}
            role="tab"
            aria-selected={status === value}
            variant={status === value ? 'primary' : 'secondary'}
            onClick={() => setStatus(value)}
          >
            {t(`review.status.${value}`)}
          </Button>
        ))}
      </div>
      {conflicts.isPending ? (
        <Skeleton className="h-24 w-full" />
      ) : conflicts.isError ? (
        <Alert tone="danger">{errorMessage(t, conflicts.error)}</Alert>
      ) : items.length === 0 ? (
        <Card>
          <p className="text-sm text-neutral-600">{t(`review.empty.${status}`)}</p>
        </Card>
      ) : (
        <ul className="space-y-3">
          {items.map((conflict) => (
            <li key={conflict.id}>
              <ConflictCard conflict={conflict} />
            </li>
          ))}
        </ul>
      )}
      {conflicts.hasNextPage && (
        <Button variant="secondary" onClick={() => void conflicts.fetchNextPage()}>
          {t('sales.loadMore')}
        </Button>
      )}
    </div>
  );
}

function ConflictCard({ conflict }: { conflict: SaleConflict }) {
  const { t } = useTranslation();
  const { tenant } = useAuthContext();
  const queryClient = useQueryClient();
  const { format: money } = useMoney();
  const dateTime = useBusinessDateTime();
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const resolve = async (event: FormEvent) => {
    event.preventDefault();
    if (!note.trim()) return setError(t('validation.required'));
    setSaving(true);
    setError(null);
    try {
      await api.sync.resolveConflict(conflict.id, { note });
      await queryClient.invalidateQueries({ queryKey: ['conflicts', tenant.id] });
    } catch (e) {
      setError(errorMessage(t, e));
    } finally {
      setSaving(false);
    }
  };

  const lines = (conflict.detail.lines ?? []) as Array<Record<string, unknown>>;
  return (
    <Card>
      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone="warning">{t(`review.types.${conflict.type}`)}</Badge>
            <Link
              to={`/sales/${conflict.saleId}`}
              className="font-mono font-medium text-brand-800 hover:underline"
            >
              {conflict.saleNumber}
            </Link>
            <span className="text-sm text-neutral-600">
              {conflict.branchName} · {conflict.cashierName ?? '—'} ·{' '}
              {money(conflict.saleTotalMinor)}
            </span>
          </div>
          <span className="text-xs text-neutral-600">
            {t('review.capturedAt', { time: dateTime(conflict.capturedAt) })}
          </span>
        </div>
        <p className="text-sm text-neutral-700">{t(`review.explain.${conflict.type}`)}</p>
        {lines.length > 0 && (
          <ul className="text-sm">
            {lines.map((line, index) => (
              <li key={index} className="font-mono text-xs text-neutral-700">
                {conflict.type === 'PRICE_CHANGED'
                  ? t('review.priceLine', {
                      sku: line.sku,
                      charged: money(Number(line.chargedMinor)),
                      current: money(Number(line.currentMinor)),
                    })
                  : conflict.type === 'EXPIRED_SOLD'
                    ? t('review.expiredLine', {
                        sku: line.sku,
                        quantity: line.quantity,
                        batch: line.batchNumber ?? '—',
                        expiry: line.expiryDate ?? '—',
                      })
                    : t('review.stockLine', {
                        sku: line.sku,
                        sold: line.soldQuantity,
                        available: line.availableQuantity,
                      })}
              </li>
            ))}
          </ul>
        )}
        {conflict.resolvedAt ? (
          <p className="text-sm text-success-700">
            {t('review.resolvedBy', {
              name: conflict.resolvedByName ?? '—',
              time: dateTime(conflict.resolvedAt),
            })}
            : {conflict.resolutionNote}
          </p>
        ) : (
          <form noValidate onSubmit={resolve} className="flex flex-wrap items-end gap-2">
            <div className="min-w-64 flex-1">
              <TextField
                label={t('review.note')}
                hint={t('review.noteHint')}
                maxLength={500}
                value={note}
                error={error ?? undefined}
                onChange={(e) => setNote(e.target.value)}
              />
            </div>
            <Button type="submit" loading={saving}>
              {t('review.resolve')}
            </Button>
          </form>
        )}
      </div>
    </Card>
  );
}
