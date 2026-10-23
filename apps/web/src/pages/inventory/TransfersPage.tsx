import type { StockTransfer } from '@pos/contracts';
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, ArrowRight } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { DocumentLines, type DocumentLine } from '../../components/DocumentLines';
import { ItemPicker } from '../../components/ItemPicker';
import { Alert, Badge, Button, Card, SelectField, Skeleton, TextField } from '../../components/ui';
import { api } from '../../lib/api';
import { useAuthContext } from '../../lib/auth-store';
import { errorMessage } from '../../lib/errors';
import { inventoryKey, issuesByPath, newDocumentId, useActiveBranches } from '../../lib/inventory';

export function TransfersPage() {
  const { t } = useTranslation();
  const { tenant, permissions } = useAuthContext();
  const canManage = permissions.includes('inventory.manage');
  const branches = useActiveBranches();
  const [creating, setCreating] = useState(false);
  const [notice, setNotice] = useState<{ tone: 'success' | 'danger'; message: string } | null>(
    null,
  );
  const queryClient = useQueryClient();

  const query = useInfiniteQuery({
    queryKey: [...inventoryKey(tenant.id), 'transfers'],
    queryFn: ({ pageParam }) => api.stockTransfers.list({ cursor: pageParam, limit: 25 }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
  const transfers = query.data?.pages.flatMap((page) => page.items) ?? [];
  const refresh = () => queryClient.invalidateQueries({ queryKey: inventoryKey(tenant.id) });
  const enoughBranches = (branches.data?.length ?? 0) >= 2;

  return (
    <div className="space-y-6">
      <Link
        to="/inventory"
        className="inline-flex items-center gap-1 text-sm font-medium text-brand-700 hover:underline"
      >
        <ArrowLeft aria-hidden className="size-4" />
        {t('inventory.title')}
      </Link>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-neutral-900">
            {t('inventory.transfers.title')}
          </h1>
          <p className="mt-1 text-sm text-neutral-600">{t('inventory.transfers.subtitle')}</p>
        </div>
        {canManage && enoughBranches && !creating && (
          <Button onClick={() => setCreating(true)}>{t('inventory.transfers.new')}</Button>
        )}
      </div>
      {!enoughBranches && branches.isSuccess && (
        <Alert tone="info">{t('inventory.transfers.needTwoBranches')}</Alert>
      )}
      {notice && <Alert tone={notice.tone}>{notice.message}</Alert>}

      {creating && (
        <NewTransfer
          onCancel={() => setCreating(false)}
          onSent={async (number) => {
            setCreating(false);
            setNotice({ tone: 'success', message: t('inventory.transfers.sent', { number }) });
            await refresh();
          }}
        />
      )}

      {query.isPending ? (
        <Card>
          <Skeleton className="h-24 w-full" />
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
      ) : transfers.length === 0 ? (
        <Card>
          <p className="text-sm text-neutral-600">{t('inventory.transfers.empty')}</p>
        </Card>
      ) : (
        <ul className="space-y-4">
          {transfers.map((transfer) => (
            <TransferCard
              key={transfer.id}
              transfer={transfer}
              canManage={canManage}
              onDone={async (message, tone = 'success') => {
                setNotice({ tone, message });
                await refresh();
              }}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function TransferCard({
  transfer,
  canManage,
  onDone,
}: {
  transfer: StockTransfer;
  canManage: boolean;
  onDone: (message: string, tone?: 'success' | 'danger') => Promise<void>;
}) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState<'receive' | 'cancel' | null>(null);
  const act = async (action: 'receive' | 'cancel') => {
    if (
      action === 'cancel' &&
      !window.confirm(
        t('inventory.transfers.cancelConfirm', {
          number: transfer.number,
          branch: transfer.fromBranchName,
        }),
      )
    )
      return;
    setBusy(action);
    try {
      const updated =
        action === 'receive'
          ? await api.stockTransfers.receive(transfer.id, transfer.version)
          : await api.stockTransfers.cancel(transfer.id, transfer.version);
      await onDone(`${updated.number}: ${t(`inventory.transfers.status.${updated.status}`)}`);
    } catch (error) {
      await onDone(errorMessage(t, error), 'danger');
    } finally {
      setBusy(null);
    }
  };
  const tone =
    transfer.status === 'RECEIVED'
      ? 'success'
      : transfer.status === 'CANCELLED'
        ? 'neutral'
        : 'warning';

  return (
    <li>
      <section
        aria-label={transfer.number}
        className="rounded-lg bg-white p-5 border border-neutral-200"
      >
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="font-mono font-semibold">{transfer.number}</span>
            <span>{transfer.fromBranchName}</span>
            <ArrowRight aria-label="→" className="size-4 text-neutral-500" />
            <span>{transfer.toBranchName}</span>
            <Badge tone={tone}>{t(`inventory.transfers.status.${transfer.status}`)}</Badge>
          </div>
          {canManage && transfer.status === 'IN_TRANSIT' && (
            <div className="flex gap-2">
              <Button
                variant="secondary"
                loading={busy === 'cancel'}
                disabled={busy !== null}
                onClick={() => void act('cancel')}
              >
                {t('inventory.transfers.cancel')}
              </Button>
              <Button
                loading={busy === 'receive'}
                disabled={busy !== null}
                onClick={() => void act('receive')}
              >
                {t('inventory.transfers.receive')}
              </Button>
            </div>
          )}
        </div>
        <ul className="mt-3 space-y-1 text-sm text-neutral-700">
          {transfer.lines.map((line, index) => (
            <li key={index} className="flex justify-between gap-4">
              <span>
                {line.productName}
                {line.variantLabel && ` — ${line.variantLabel}`}
                {line.batchNumber && (
                  <span className="text-neutral-500"> · {line.batchNumber}</span>
                )}
              </span>
              <span className="tabular-nums">{line.quantity}</span>
            </li>
          ))}
        </ul>
      </section>
    </li>
  );
}

function NewTransfer({
  onCancel,
  onSent,
}: {
  onCancel: () => void;
  onSent: (number: string) => Promise<void>;
}) {
  const { t } = useTranslation();
  const branches = useActiveBranches().data ?? [];
  const [documentId] = useState(newDocumentId);
  const [from, setFrom] = useState(branches[0]?.id ?? '');
  const [to, setTo] = useState(branches[1]?.id ?? '');
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState<DocumentLine[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const options = branches.map((b) => ({ value: b.id, label: b.name }));

  const submit = async () => {
    setErrors({});
    setError(null);
    setSaving(true);
    try {
      const transfer = await api.stockTransfers.create({
        id: documentId,
        fromBranchId: from,
        toBranchId: to,
        notes,
        lines: lines.map((line) => ({ variantId: line.variantId, quantity: line.quantity.trim() })),
      });
      await onSent(transfer.number);
    } catch (err) {
      const issues = issuesByPath(err);
      setErrors(issues);
      setError(
        issues.toBranchId
          ? t(issues.toBranchId)
          : Object.keys(issues).length
            ? null
            : errorMessage(t, err),
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card title={t('inventory.transfers.new')}>
      <div className="space-y-4">
        {error && <Alert tone="danger">{error}</Alert>}
        <div className="grid gap-4 md:grid-cols-2">
          <SelectField
            label={t('inventory.transfers.from')}
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            options={options}
          />
          <SelectField
            label={t('inventory.transfers.to')}
            value={to}
            onChange={(e) => setTo(e.target.value)}
            options={options}
          />
        </div>
        <ItemPicker
          onPick={(item) => setLines((current) => [...current, { ...item, quantity: '1' }])}
        />
        <DocumentLines lines={lines} onChange={setLines} errors={errors} />
        <TextField
          label={t('inventory.transfers.notes')}
          optional
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onCancel}>
            {t('locations.cancel')}
          </Button>
          <Button loading={saving} disabled={lines.length === 0} onClick={() => void submit()}>
            {t('inventory.transfers.submit')}
          </Button>
        </div>
      </div>
    </Card>
  );
}
