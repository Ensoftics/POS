import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Button, Card, TextField } from '../../components/ui';
import { api } from '../../lib/api';
import { useAuthContext } from '../../lib/auth-store';
import { errorMessage } from '../../lib/errors';
import { newDocumentId } from '../../lib/inventory';

/** A customer's points: balance, history and (for managers) adjustments. */
export function LoyaltyCard({ customerId }: { customerId: string }) {
  const { t, i18n } = useTranslation();
  const { permissions } = useAuthContext();
  const queryClient = useQueryClient();
  const key = ['loyalty', customerId];
  const history = useInfiniteQuery({
    queryKey: key,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      api.customers.loyalty(customerId, pageParam ? { cursor: pageParam } : {}),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
  const date = new Intl.DateTimeFormat(i18n.resolvedLanguage, { dateStyle: 'medium' });
  const rows = history.data?.pages.flatMap((page) => page.items) ?? [];
  const balance = history.data?.pages[0]?.balance ?? 0;

  return (
    <Card title={t('loyalty.title')}>
      {history.isError ? (
        <Alert tone="danger">{errorMessage(t, history.error)}</Alert>
      ) : (
        <div className="space-y-4">
          <p className="text-2xl font-semibold tabular-nums">
            {t('loyalty.balance', { points: balance })}
          </p>
          {rows.length === 0 ? (
            <p className="text-sm text-neutral-600">{t('loyalty.empty')}</p>
          ) : (
            <ul className="divide-y divide-neutral-200 text-sm" aria-label={t('loyalty.history')}>
              {rows.map((entry) => (
                <li key={entry.id} className="flex flex-wrap justify-between gap-2 py-2">
                  <span>
                    {date.format(new Date(entry.createdAt))} · {t(`loyalty.type.${entry.type}`)}
                    {entry.referenceNumber ? ` · ${entry.referenceNumber}` : ''}
                    {entry.note ? ` · ${entry.note}` : ''}
                  </span>
                  <span className="tabular-nums">
                    {entry.points > 0 ? `+${entry.points}` : entry.points} → {entry.balanceAfter}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {history.hasNextPage && (
            <Button
              variant="secondary"
              loading={history.isFetchingNextPage}
              onClick={() => void history.fetchNextPage()}
            >
              {t('notifications.more')}
            </Button>
          )}
          {permissions.includes('customers.credit') && (
            <AdjustForm
              customerId={customerId}
              onDone={() => queryClient.invalidateQueries({ queryKey: key })}
            />
          )}
        </div>
      )}
    </Card>
  );
}

function AdjustForm({ customerId, onDone }: { customerId: string; onDone: () => void }) {
  const { t } = useTranslation();
  const [points, setPoints] = useState('');
  const [reason, setReason] = useState('');
  // One id per intended adjustment: a double click or retry records it once.
  const [requestId, setRequestId] = useState(newDocumentId);
  const adjust = useMutation({
    mutationFn: () =>
      api.customers.adjustLoyalty(customerId, { id: requestId, points: Number(points), reason }),
    onSuccess: () => {
      setPoints('');
      setReason('');
      setRequestId(newDocumentId());
      onDone();
    },
  });
  const issues = (field: string) =>
    adjust.error && 'issues' in adjust.error
      ? (adjust.error as { issues: Array<{ path: string; message: string }> }).issues.find(
          (i) => i.path === field,
        )?.message
      : undefined;
  const submit = (event: FormEvent) => {
    event.preventDefault();
    adjust.mutate();
  };
  return (
    <form
      noValidate
      onSubmit={submit}
      className="space-y-3 border-t border-neutral-200 pt-4"
      aria-label={t('loyalty.adjust')}
    >
      <h3 className="text-sm font-semibold">{t('loyalty.adjust')}</h3>
      <div className="grid gap-3 sm:grid-cols-2">
        <TextField
          label={t('loyalty.adjustPoints')}
          inputMode="numeric"
          value={points}
          error={issues('points')}
          onChange={(e) => setPoints(e.target.value.replace(/[^\d-]/g, ''))}
        />
        <TextField
          label={t('loyalty.adjustReason')}
          value={reason}
          error={issues('reason')}
          onChange={(e) => setReason(e.target.value)}
        />
      </div>
      {adjust.isError && !issues('points') && !issues('reason') && (
        <Alert tone="danger">{errorMessage(t, adjust.error)}</Alert>
      )}
      {adjust.isSuccess && <Alert tone="success">{t('loyalty.adjusted')}</Alert>}
      <Button type="submit" variant="secondary" loading={adjust.isPending}>
        {t('loyalty.adjustSave')}
      </Button>
    </form>
  );
}
