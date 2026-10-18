import type { StockCount } from '@pos/contracts';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useParams } from 'react-router';
import { ItemPicker } from '../../components/ItemPicker';
import { Alert, Badge, Button, Card, SelectField, Skeleton } from '../../components/ui';
import { api } from '../../lib/api';
import { useAuthContext } from '../../lib/auth-store';
import { errorMessage } from '../../lib/errors';
import { inventoryKey, issuesByPath, useSelectedBranch } from '../../lib/inventory';

export function CountsPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { tenant, permissions } = useAuthContext();
  const canManage = permissions.includes('inventory.manage');
  const [branchId, setBranchId, branches] = useSelectedBranch();
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const counts = useQuery({
    queryKey: [...inventoryKey(tenant.id), 'counts'],
    queryFn: () => api.stockCounts.list({ limit: 50 }),
  });

  const start = async () => {
    setError(null);
    setStarting(true);
    try {
      const count = await api.stockCounts.start({ branchId: branchId! });
      navigate(`/inventory/counts/${count.id}`);
    } catch (err) {
      setError(errorMessage(t, err));
    } finally {
      setStarting(false);
    }
  };

  return (
    <div className="space-y-6">
      <Link
        to="/inventory"
        className="inline-flex items-center gap-1 text-sm font-medium text-brand-700 hover:underline"
      >
        <ArrowLeft aria-hidden className="size-4" />
        {t('inventory.title')}
      </Link>
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-neutral-900">
          {t('inventory.counts.title')}
        </h1>
        <p className="mt-1 text-sm text-neutral-600">{t('inventory.counts.subtitle')}</p>
      </div>
      {error && <Alert tone="danger">{error}</Alert>}
      {canManage && (
        <Card>
          <div className="flex flex-col gap-4 sm:flex-row sm:items-end">
            <div className="flex-1">
              <SelectField
                label={t('inventory.branch')}
                value={branchId ?? ''}
                onChange={(e) => setBranchId(e.target.value)}
                options={branches.map((b) => ({ value: b.id, label: b.name }))}
              />
            </div>
            <Button loading={starting} disabled={!branchId} onClick={() => void start()}>
              {t('inventory.counts.start')}
            </Button>
          </div>
        </Card>
      )}
      {counts.isPending ? (
        <Card>
          <Skeleton className="h-24 w-full" />
        </Card>
      ) : counts.isError ? (
        <Alert
          tone="danger"
          action={
            <Button variant="secondary" onClick={() => void counts.refetch()}>
              {t('common.retry')}
            </Button>
          }
        >
          {errorMessage(t, counts.error)}
        </Alert>
      ) : counts.data.items.length === 0 ? (
        <Card>
          <p className="text-sm text-neutral-600">{t('inventory.counts.empty')}</p>
        </Card>
      ) : (
        <Card>
          <ul className="-mx-5 divide-y divide-neutral-100">
            {counts.data.items.map((count) => (
              <li
                key={count.id}
                className="flex items-center justify-between gap-3 px-5 py-3 text-sm"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <Link
                    to={`/inventory/counts/${count.id}`}
                    className="font-mono font-semibold text-brand-800 hover:underline"
                  >
                    {count.number}
                  </Link>
                  <span>{count.branchName}</span>
                  <Badge
                    tone={
                      count.status === 'OPEN'
                        ? 'warning'
                        : count.status === 'COMPLETED'
                          ? 'success'
                          : 'neutral'
                    }
                  >
                    {t(`inventory.counts.status.${count.status}`)}
                  </Badge>
                </div>
                <span className="text-neutral-600">
                  {t('inventory.counts.lines', { count: count.lineCount })}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}

export function CountDetailPage() {
  const { id } = useParams();
  const { t } = useTranslation();
  const { tenant, permissions } = useAuthContext();
  const canManage = permissions.includes('inventory.manage');
  const queryClient = useQueryClient();
  const key = [...inventoryKey(tenant.id), 'count', id];
  const count = useQuery({ queryKey: key, queryFn: () => api.stockCounts.get(id!) });
  const [entries, setEntries] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState<{
    tone: 'success' | 'danger' | 'info';
    message: string;
  } | null>(null);
  const [busy, setBusy] = useState<'save' | 'complete' | 'cancel' | null>(null);

  if (count.isPending)
    return (
      <Card>
        <Skeleton className="h-40 w-full" />
      </Card>
    );
  if (count.isError) {
    return (
      <Alert
        tone="danger"
        action={
          <Button variant="secondary" onClick={() => void count.refetch()}>
            {t('common.retry')}
          </Button>
        }
      >
        {errorMessage(t, count.error)}
      </Alert>
    );
  }
  const data = count.data;
  const editable = canManage && data.status === 'OPEN';
  const lineKey = (line: StockCount['lines'][number]) => `${line.variantId}:${line.batchId ?? ''}`;
  const pending = Object.entries(entries);

  const save = async (): Promise<StockCount | null> => {
    if (pending.length === 0) return data;
    setErrors({});
    const lines = pending.map(([key, value]) => {
      const [variantId, batchId] = key.split(':');
      return {
        variantId: variantId!,
        batchId: batchId || null,
        countedQuantity: value.trim() === '' ? null : value.trim(),
      };
    });
    try {
      const updated = await api.stockCounts.update(data.id, { version: data.version, lines });
      queryClient.setQueryData(key, updated);
      setEntries({});
      return updated;
    } catch (error) {
      const issues = issuesByPath(error);
      // Map "lines.N.countedQuantity" back to the row the user typed in.
      setErrors(
        Object.fromEntries(
          Object.entries(issues).map(([path, message]) => {
            const index = Number(path.split('.')[1]);
            return [pending[index]?.[0] ?? path, message];
          }),
        ),
      );
      if (Object.keys(issues).length === 0)
        setNotice({ tone: 'danger', message: errorMessage(t, error) });
      return null;
    }
  };

  const run = async (action: 'save' | 'complete' | 'cancel') => {
    if (action === 'complete' && !window.confirm(t('inventory.counts.completeConfirm'))) return;
    setBusy(action);
    setNotice(null);
    try {
      if (action === 'save') {
        if (await save()) setNotice({ tone: 'success', message: t('inventory.counts.saved') });
        return;
      }
      const current = await save();
      if (!current) return;
      const result =
        action === 'complete'
          ? await api.stockCounts.complete(current.id, current.version)
          : await api.stockCounts.cancel(current.id, current.version);
      queryClient.setQueryData(key, result);
      await queryClient.invalidateQueries({ queryKey: inventoryKey(tenant.id) });
      if (action === 'complete') {
        const corrections = result.lines.filter(
          (l) => l.varianceQuantity && Number(l.varianceQuantity) !== 0,
        ).length;
        setNotice({
          tone: 'success',
          message: t('inventory.counts.completed', { count: corrections }),
        });
      }
    } catch (error) {
      setNotice({ tone: 'danger', message: errorMessage(t, error) });
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-6">
      <Link
        to="/inventory/counts"
        className="inline-flex items-center gap-1 text-sm font-medium text-brand-700 hover:underline"
      >
        <ArrowLeft aria-hidden className="size-4" />
        {t('inventory.counts.title')}
      </Link>
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="font-mono text-2xl font-semibold text-neutral-900">{data.number}</h1>
        <span className="text-neutral-700">{data.branchName}</span>
        <Badge
          tone={
            data.status === 'OPEN' ? 'warning' : data.status === 'COMPLETED' ? 'success' : 'neutral'
          }
        >
          {t(`inventory.counts.status.${data.status}`)}
        </Badge>
      </div>
      {notice && <Alert tone={notice.tone}>{notice.message}</Alert>}
      {editable && (
        <p className="text-sm text-neutral-600">{t('inventory.counts.uncountedHint')}</p>
      )}

      <Card>
        <div className="-mx-5 overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead className="border-b border-neutral-200 text-neutral-600">
              <tr>
                <th scope="col" className="px-5 py-2 font-medium">
                  {t('inventory.lines.item')}
                </th>
                <th scope="col" className="px-5 py-2 text-right font-medium">
                  {t('inventory.counts.expected')}
                </th>
                <th scope="col" className="px-5 py-2 font-medium">
                  {t('inventory.counts.counted')}
                </th>
                {data.status === 'COMPLETED' && (
                  <th scope="col" className="px-5 py-2 text-right font-medium">
                    {t('inventory.counts.variance')}
                  </th>
                )}
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100">
              {data.lines.map((line) => {
                const k = lineKey(line);
                const value = entries[k] ?? line.countedQuantity ?? '';
                return (
                  <tr key={k}>
                    <td className="px-5 py-2">
                      <div className="font-medium text-neutral-900">
                        {line.productName}
                        {line.variantLabel && ` — ${line.variantLabel}`}
                      </div>
                      <div className="font-mono text-xs text-neutral-600">
                        {line.sku}
                        {line.batchNumber && ` · ${line.batchNumber}`}
                      </div>
                    </td>
                    <td className="px-5 py-2 text-right tabular-nums">{line.expectedQuantity}</td>
                    <td className="px-5 py-2">
                      {editable ? (
                        <>
                          <input
                            aria-label={`${t('inventory.counts.counted')}: ${line.productName} ${line.sku}${line.batchNumber ? ` ${line.batchNumber}` : ''}`}
                            inputMode="decimal"
                            value={value}
                            onChange={(e) =>
                              setEntries((current) => ({ ...current, [k]: e.target.value }))
                            }
                            aria-invalid={errors[k] ? true : undefined}
                            className={`min-h-11 w-28 rounded-md border px-3 tabular-nums ${errors[k] ? 'border-danger-600' : 'border-neutral-300'}`}
                          />
                          {errors[k] && <p className="text-xs text-danger-700">{t(errors[k]!)}</p>}
                        </>
                      ) : (
                        <span className="tabular-nums">{line.countedQuantity ?? '—'}</span>
                      )}
                    </td>
                    {data.status === 'COMPLETED' && (
                      <td className="px-5 py-2 text-right tabular-nums">
                        {line.varianceQuantity ?? '—'}
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      {editable && (
        <>
          <Card title={t('inventory.counts.addItem')}>
            <ItemPicker
              onPick={(item) => {
                const k = `${item.variantId}:`;
                if (!data.lines.some((l) => lineKey(l) === k)) {
                  void api.stockCounts
                    .update(data.id, {
                      version: data.version,
                      lines: [{ variantId: item.variantId, batchId: null, countedQuantity: null }],
                    })
                    .then((updated) => queryClient.setQueryData(key, updated))
                    .catch((error: unknown) =>
                      setNotice({ tone: 'danger', message: errorMessage(t, error) }),
                    );
                }
              }}
            />
          </Card>
          <div className="flex flex-wrap justify-end gap-2">
            <Button
              variant="danger"
              loading={busy === 'cancel'}
              disabled={busy !== null}
              onClick={() => void run('cancel')}
            >
              {t('inventory.counts.cancel')}
            </Button>
            <Button
              variant="secondary"
              loading={busy === 'save'}
              disabled={busy !== null}
              onClick={() => void run('save')}
            >
              {t('inventory.counts.save')}
            </Button>
            <Button
              loading={busy === 'complete'}
              disabled={busy !== null}
              onClick={() => void run('complete')}
            >
              {t('inventory.counts.complete')}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
