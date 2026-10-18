import { isApiError } from '@pos/api-client';
import type { Sale, SaleReturn } from '@pos/contracts';
import {
  type CurrencyCode,
  fromMilli,
  isCurrencyCode,
  lineRefund,
  minorToDecimalString,
  parseMoney,
  parseQuantity,
  type PaymentMethod,
  remainingQuantity,
  suggestRefunds,
} from '@pos/domain';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Printer, RotateCcw, XCircle } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router';
import { useApproval } from '../../components/ApprovalDialog';
import { ReceiptView } from '../../components/ReceiptView';
import {
  Alert,
  Badge,
  Button,
  Card,
  CheckboxField,
  Skeleton,
  TextField,
} from '../../components/ui';
import { api } from '../../lib/api';
import { useAuthContext } from '../../lib/auth-store';
import { useMoney } from '../../lib/catalog';
import { errorMessage } from '../../lib/errors';
import { newDocumentId } from '../../lib/inventory';
import { salesKey, useBusinessDateTime, useMyOpenShift } from '../../lib/sales';
import { useSettings } from '../../lib/settings';

/** A sale with its receipt, returns, and (with permission) return and void actions. */
export function SaleDetailPage() {
  const { t } = useTranslation();
  const { id, number } = useParams();
  const { tenant, permissions } = useAuthContext();
  const queryClient = useQueryClient();
  const sale = useQuery({
    queryKey: ['sale', id ?? `number:${number}`],
    queryFn: () => (id ? api.sales.get(id) : api.sales.byNumber(number ?? '')),
  });
  // The printable receipt is only available to whoever may see the sale's shift.
  const receipt = useQuery({
    queryKey: ['receipt', sale.data?.id],
    queryFn: () => api.sales.receipt(sale.data!.id),
    enabled: !!sale.data,
    retry: false,
  });
  const [mode, setMode] = useState<'view' | 'return' | 'void'>('view');
  const [notice, setNotice] = useState<string | null>(null);
  const { format: money } = useMoney();
  const dateTime = useBusinessDateTime();

  const refresh = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['sale'] }),
      queryClient.invalidateQueries({ queryKey: ['receipt'] }),
      queryClient.invalidateQueries({ queryKey: ['shift'] }),
      queryClient.invalidateQueries({ queryKey: salesKey(tenant.id) }),
    ]);
  };

  if (sale.isPending) return <Skeleton className="h-64 w-full" />;
  if (sale.isError) return <Alert tone="danger">{errorMessage(t, sale.error)}</Alert>;
  const s = sale.data;
  const canRefund = permissions.includes('sales.refund');
  const status = s.voided ? 'VOIDED' : s.returnStatus;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link
          to="/sales"
          className="inline-flex min-h-11 items-center gap-1 text-sm font-medium text-brand-800 hover:underline"
        >
          <ArrowLeft aria-hidden className="size-4" />
          {t('sales.receipt.back')}
        </Link>
        <div className="flex flex-wrap gap-2">
          {canRefund && mode === 'view' && s.returnStatus !== 'FULL' && (
            <Button variant="secondary" onClick={() => setMode('return')}>
              <RotateCcw aria-hidden className="size-4" />
              {t('sales.actions.return')}
            </Button>
          )}
          {canRefund && mode === 'view' && s.returnStatus === 'NONE' && (
            <Button variant="danger" onClick={() => setMode('void')}>
              <XCircle aria-hidden className="size-4" />
              {t('sales.actions.void')}
            </Button>
          )}
          <Button variant="secondary" disabled={!receipt.isSuccess} onClick={() => window.print()}>
            <Printer aria-hidden className="size-4" />
            {t('sales.receipt.print')}
          </Button>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="font-mono text-2xl font-semibold text-neutral-900">{s.number}</h1>
        {status !== 'NONE' && (
          <Badge tone={status === 'PARTIAL' ? 'warning' : 'neutral'}>
            {t(`sales.status.${status}`)}
          </Badge>
        )}
      </div>
      {notice && <Alert tone="success">{notice}</Alert>}

      {mode === 'return' && (
        <ReturnForm
          sale={s}
          onCancel={() => setMode('view')}
          onDone={async (ret) => {
            setMode('view');
            setNotice(
              t('sales.returnForm.done', { number: ret.number, amount: money(ret.refundMinor) }),
            );
            await refresh();
          }}
        />
      )}
      {mode === 'void' && (
        <VoidForm
          sale={s}
          onCancel={() => setMode('view')}
          onDone={async (ret) => {
            setMode('view');
            setNotice(t('sales.voidForm.done', { number: ret.number }));
            await refresh();
          }}
        />
      )}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div>
          {receipt.isSuccess ? (
            <ReceiptView receipt={receipt.data} />
          ) : receipt.isPending ? (
            <Skeleton className="mx-auto h-96 w-full max-w-sm" />
          ) : (
            <Card>
              <ul className="space-y-1 text-sm">
                {s.lines.map((line) => (
                  <li key={line.id} className="flex justify-between gap-3">
                    <span>
                      {line.productName} × {line.quantity}
                    </span>
                    <span className="tabular-nums">{money(line.totalMinor)}</span>
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-right font-semibold">{money(s.totalMinor)}</p>
            </Card>
          )}
        </div>
        {s.returns.length > 0 && (
          <Card title={t('sales.history')} className="h-fit">
            <ul className="space-y-2 text-sm">
              {s.returns.map((r) => (
                <li key={r.id} className="flex justify-between gap-2">
                  <span>
                    <span className="font-mono font-medium">{r.number}</span>
                    {r.kind === 'VOID' ? ` · ${t('sales.status.VOIDED')}` : ''}
                    <span className="block text-xs text-neutral-600">{dateTime(r.createdAt)}</span>
                  </span>
                  <span className="tabular-nums">-{money(r.refundMinor)}</span>
                </li>
              ))}
            </ul>
          </Card>
        )}
      </div>
    </div>
  );
}

interface RefundDraft {
  key: string;
  method: PaymentMethod;
  amount: string;
  reference: string;
}

function ReturnForm({
  sale,
  onCancel,
  onDone,
}: {
  sale: Sale;
  onCancel: () => void;
  onDone: (ret: SaleReturn) => Promise<void>;
}) {
  const { t } = useTranslation();
  const { format: money } = useMoney();
  const currency: CurrencyCode = isCurrencyCode(sale.currency) ? sale.currency : 'LKR';
  const approval = useApproval();
  const { shift, isPending } = useMyOpenShift();
  const allowFractions = useSettings().data?.profile.allowFractionalQuantities ?? false;
  const [id] = useState(newDocumentId);
  const [quantities, setQuantities] = useState<Record<string, string>>({});
  const [restock, setRestock] = useState<Record<string, boolean>>({});
  const [reason, setReason] = useState('');
  const [refunds, setRefunds] = useState<RefundDraft[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Live refund per line, exactly as the server will compute it.
  const computed = sale.lines.map((line) => {
    const text = (quantities[line.id] ?? '').trim();
    if (!text) return { line, quantity: null, refund: 0, error: null };
    // Same rule as the API: part quantities if the business allows them or the item was sold so.
    const parsed = parseQuantity(text, {
      allowFraction: allowFractions || !Number.isInteger(Number(line.quantity)),
    });
    if (!parsed.ok)
      return { line, quantity: null, refund: 0, error: `validation.quantity.${parsed.issue}` };
    const result = lineRefund(line, parsed.value);
    if (!result.ok)
      return { line, quantity: null, refund: 0, error: 'validation.return.exceeds_remaining' };
    return { line, quantity: parsed.value, refund: result.refundMinor, error: null };
  });
  const chosen = computed.filter((c) => c.quantity !== null && Number(c.quantity) > 0);
  const refundTotal = chosen.reduce((sum, c) => sum + c.refund, 0);
  const limits = new Map(sale.refundable.map((r) => [r.method, r.amountMinor]));
  const drafts: RefundDraft[] =
    refunds ??
    suggestRefunds(refundTotal, limits).map((r) => ({
      key: r.method,
      method: r.method,
      amount: minorToDecimalString(r.amountMinor, currency),
      reference: '',
    }));

  if (isPending) return <Skeleton className="h-40 w-full" />;
  if (!shift) return <Alert tone="warning">{t('sales.returnForm.needShift')}</Alert>;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    if (chosen.length === 0) return setError(t('sales.returnForm.nothing'));
    if (!reason.trim()) return setError(t('validation.required'));
    const parsedRefunds = drafts
      .filter((d) => d.amount.trim() !== '')
      .map((d) => ({ ...d, parsed: parseMoney(d.amount, currency) }));
    if (parsedRefunds.some((d) => !d.parsed.ok)) return setError(t('validation.money.invalid'));
    setSaving(true);
    try {
      const result = await approval.run('RETURN', (given) =>
        api.sales.createReturn(sale.id, {
          id,
          shiftId: shift.id,
          reason,
          lines: chosen.map((c) => ({
            saleLineId: c.line.id,
            quantity: c.quantity!,
            restock: restock[c.line.id] ?? true,
          })),
          refunds: parsedRefunds
            .filter((d) => d.parsed.ok && d.parsed.minor > 0)
            .map((d) => ({
              method: d.method,
              amountMinor: d.parsed.ok ? d.parsed.minor : 0,
              reference: d.reference.trim() || null,
            })),
          ...(given ? { approval: given } : {}),
        }),
      );
      if (result) await onDone(result);
    } catch (e) {
      setError(isApiError(e) && e.issues.length > 0 ? t(e.issues[0]!.message) : errorMessage(t, e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card title={t('sales.returnForm.title', { number: sale.number })}>
      {approval.dialog}
      <form noValidate onSubmit={submit} className="space-y-5">
        {error && <Alert tone="danger">{error}</Alert>}
        <ul className="divide-y divide-neutral-100">
          {computed.map(({ line, refund, error: lineError }) => {
            const remaining = remainingQuantity(line);
            const name = line.variantLabel
              ? `${line.productName} (${line.variantLabel})`
              : line.productName;
            return (
              <li key={line.id} className="flex flex-wrap items-start gap-3 py-3">
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-neutral-900">{name}</p>
                  <p className="text-xs text-neutral-600">
                    {line.sku} ·{' '}
                    {t('sales.returnForm.ofRemaining', { count: Number(fromMilli(remaining)) })}
                  </p>
                </div>
                <div className="w-28">
                  <label htmlFor={`rq-${line.id}`} className="sr-only">
                    {t('sales.returnForm.returnQty', { name })}
                  </label>
                  <input
                    id={`rq-${line.id}`}
                    inputMode="decimal"
                    disabled={remaining <= 0}
                    placeholder="0"
                    value={quantities[line.id] ?? ''}
                    aria-invalid={lineError ? true : undefined}
                    onChange={(e) => {
                      setQuantities({ ...quantities, [line.id]: e.target.value });
                      setRefunds(null);
                    }}
                    className="min-h-11 w-full rounded-md border border-neutral-300 px-3 text-right tabular-nums disabled:bg-neutral-100"
                  />
                  {lineError && <p className="mt-1 text-xs text-danger-700">{t(lineError)}</p>}
                </div>
                <div className="w-40">
                  <CheckboxField
                    label={t('sales.returnForm.restock')}
                    checked={restock[line.id] ?? true}
                    disabled={remaining <= 0}
                    onChange={(e) => setRestock({ ...restock, [line.id]: e.target.checked })}
                  />
                </div>
                <p className="w-24 text-right tabular-nums">{refund > 0 ? money(refund) : ''}</p>
              </li>
            );
          })}
        </ul>
        <p className="text-xs text-neutral-600">{t('sales.returnForm.restockHint')}</p>
        <TextField
          label={t('sales.returnForm.reason')}
          maxLength={200}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
        <div className="space-y-2">
          <p className="flex justify-between text-base font-semibold">
            <span>{t('sales.returnForm.refundTotal')}</span>
            <span className="tabular-nums" data-testid="refund-total">
              {money(refundTotal)}
            </span>
          </p>
          {refundTotal > 0 &&
            drafts.map((draft, index) => (
              <div key={draft.key} className="flex flex-wrap items-end gap-2">
                <div className="w-44">
                  <label
                    htmlFor={`rm-${draft.key}`}
                    className="block text-xs font-medium text-neutral-700"
                  >
                    {t('sales.returnForm.refundBy')}
                  </label>
                  <select
                    id={`rm-${draft.key}`}
                    value={draft.method}
                    onChange={(e) =>
                      setRefunds(
                        drafts.map((d, i) =>
                          i === index ? { ...d, method: e.target.value as PaymentMethod } : d,
                        ),
                      )
                    }
                    className="mt-1 min-h-11 w-full rounded-md border border-neutral-300 bg-white px-2 text-sm"
                  >
                    {sale.refundable.map((r) => (
                      <option key={r.method} value={r.method}>
                        {t(`paymentMethods.${r.method}`)} (
                        {t('sales.returnForm.refundable', { amount: money(r.amountMinor) })})
                      </option>
                    ))}
                  </select>
                </div>
                <div className="w-36">
                  <label
                    htmlFor={`ra-${draft.key}`}
                    className="block text-xs font-medium text-neutral-700"
                  >
                    {t('pos.paymentAmount')} ({currency})
                  </label>
                  <input
                    id={`ra-${draft.key}`}
                    inputMode="decimal"
                    value={draft.amount}
                    onChange={(e) =>
                      setRefunds(
                        drafts.map((d, i) => (i === index ? { ...d, amount: e.target.value } : d)),
                      )
                    }
                    className="mt-1 min-h-11 w-full rounded-md border border-neutral-300 px-3 text-right tabular-nums"
                  />
                </div>
                {draft.method !== 'CASH' && (
                  <div className="w-40">
                    <label
                      htmlFor={`rr-${draft.key}`}
                      className="block text-xs font-medium text-neutral-700"
                    >
                      {t('pos.reference')}
                    </label>
                    <input
                      id={`rr-${draft.key}`}
                      maxLength={40}
                      value={draft.reference}
                      onChange={(e) =>
                        setRefunds(
                          drafts.map((d, i) =>
                            i === index ? { ...d, reference: e.target.value } : d,
                          ),
                        )
                      }
                      className="mt-1 min-h-11 w-full rounded-md border border-neutral-300 px-3 text-sm"
                    />
                  </div>
                )}
              </div>
            ))}
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onCancel}>
            {t('sales.returnForm.cancel')}
          </Button>
          <Button type="submit" loading={saving} disabled={chosen.length === 0}>
            {t('sales.returnForm.submit')}
          </Button>
        </div>
      </form>
    </Card>
  );
}

function VoidForm({
  sale,
  onCancel,
  onDone,
}: {
  sale: Sale;
  onCancel: () => void;
  onDone: (ret: SaleReturn) => Promise<void>;
}) {
  const { t } = useTranslation();
  const approval = useApproval();
  const [id] = useState(newDocumentId);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!reason.trim()) return setError(t('validation.required'));
    setError(null);
    setSaving(true);
    try {
      const result = await approval.run('VOID', (given) =>
        api.sales.void(sale.id, { id, reason, ...(given ? { approval: given } : {}) }),
      );
      if (result) await onDone(result);
    } catch (e) {
      setError(errorMessage(t, e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card title={t('sales.voidForm.title', { number: sale.number })}>
      {approval.dialog}
      <form noValidate onSubmit={submit} className="max-w-md space-y-4">
        <p className="text-sm text-neutral-700">{t('sales.voidForm.hint')}</p>
        {error && <Alert tone="danger">{error}</Alert>}
        <TextField
          label={t('sales.voidForm.reason')}
          maxLength={200}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
        <div className="flex gap-2">
          <Button variant="secondary" onClick={onCancel}>
            {t('sales.returnForm.cancel')}
          </Button>
          <Button type="submit" variant="danger" loading={saving}>
            {t('sales.voidForm.submit')}
          </Button>
        </div>
      </form>
    </Card>
  );
}
