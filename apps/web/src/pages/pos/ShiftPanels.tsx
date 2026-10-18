import { isApiError } from '@pos/api-client';
import type { Shift } from '@pos/contracts';
import { type CurrencyCode, parseMoney } from '@pos/domain';
import { type FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Button, Card, TextField } from '../../components/ui';
import { useApproval } from '../../components/ApprovalDialog';
import { api } from '../../lib/api';
import { newDocumentId } from '../../lib/inventory';
import { errorMessage } from '../../lib/errors';

export function OpenShiftCard({
  registerId,
  currency,
  onOpened,
}: {
  registerId: string;
  currency: CurrencyCode;
  onOpened: (shift: Shift) => void;
}) {
  const { t } = useTranslation();
  const [amount, setAmount] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const parsed = parseMoney(amount || '0', currency);
    if (!parsed.ok) return setError(`validation.money.${parsed.issue}`);
    setError(null);
    setSaving(true);
    try {
      onOpened(await api.shifts.open({ registerId, openingFloatMinor: parsed.minor }));
    } catch (e) {
      setFormError(errorMessage(t, e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card title={t('pos.shift.open')}>
      <form noValidate onSubmit={submit} className="max-w-sm space-y-4">
        <p className="text-sm text-neutral-700">{t('pos.shift.none')}</p>
        {formError && <Alert tone="danger">{formError}</Alert>}
        <TextField
          label={`${t('pos.shift.openingFloat')} (${currency})`}
          hint={t('pos.shift.openingFloatHint')}
          inputMode="decimal"
          autoFocus
          value={amount}
          error={error ?? undefined}
          onChange={(e) => setAmount(e.target.value)}
        />
        <Button type="submit" loading={saving}>
          {t('pos.shift.open')}
        </Button>
      </form>
    </Card>
  );
}

export function ShiftSummaryList({
  shift,
  money,
}: {
  shift: Shift;
  money: (minor: number) => string;
}) {
  const { t } = useTranslation();
  const s = shift.summary;
  const rows: Array<[string, string]> = [
    [
      t('pos.shift.sales'),
      `${t('pos.shift.salesCount', { count: s.saleCount })} · ${money(s.salesTotalMinor)}`,
    ],
    ...s.payments.map((p): [string, string] => [
      t(`paymentMethods.${p.method}`),
      money(p.amountMinor),
    ]),
    [t('pos.shift.openingFloatLabel'), money(shift.openingFloatMinor)],
    [t('pos.shift.cashReceived'), money(s.cashReceivedMinor)],
    [t('pos.shift.changeGiven'), `-${money(s.changeGivenMinor)}`],
    ...(s.returnCount > 0
      ? [
          [
            t('pos.shift.refunds'),
            `${t('pos.shift.returnsCount', { count: s.returnCount })} · ${money(s.refundsTotalMinor)}`,
          ] as [string, string],
          [t('pos.shift.cashRefunded'), `-${money(s.cashRefundedMinor)}`] as [string, string],
        ]
      : []),
    ...(s.payInMinor > 0 ? [[t('pos.shift.payIns'), money(s.payInMinor)] as [string, string]] : []),
    ...(s.collectionsMinor > 0
      ? [
          [t('pos.shift.collections'), money(s.collectionsMinor)] as [string, string],
          [t('pos.shift.collectionsCash'), money(s.collectionsCashMinor)] as [string, string],
        ]
      : []),
    ...(s.payOutMinor > 0
      ? [[t('pos.shift.payOuts'), `-${money(s.payOutMinor)}`] as [string, string]]
      : []),
    [t('pos.shift.expected'), money(shift.expectedCashMinor ?? s.expectedCashMinor)],
  ];
  return (
    <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 text-sm">
      {rows.map(([label, value]) => (
        <div key={label} className="contents">
          <dt className="text-neutral-600">{label}</dt>
          <dd className="text-right tabular-nums">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function CloseShiftCard({
  shift,
  currency,
  money,
  onCancel,
  onClosed,
  onStale,
}: {
  shift: Shift;
  currency: CurrencyCode;
  money: (minor: number) => string;
  onCancel: () => void;
  onClosed: (shift: Shift) => void;
  onStale: () => Promise<void>;
}) {
  const { t } = useTranslation();
  const [counted, setCounted] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const parsed = parseMoney(counted || 'x', currency);
  const difference = parsed.ok ? parsed.minor - shift.summary.expectedCashMinor : null;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!parsed.ok)
      return setError(counted ? `validation.money.${parsed.issue}` : 'validation.required');
    setError(null);
    setSaving(true);
    try {
      onClosed(
        await api.shifts.close(shift.id, {
          version: shift.version,
          countedCashMinor: parsed.minor,
          notes,
        }),
      );
    } catch (e) {
      if (isApiError(e) && e.code === 'VERSION_CONFLICT') await onStale();
      setFormError(errorMessage(t, e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card title={t('pos.shift.closeTitle', { number: shift.number })}>
      <form noValidate onSubmit={submit} className="grid gap-6 md:grid-cols-2">
        <div className="space-y-4">
          {formError && <Alert tone="danger">{formError}</Alert>}
          <TextField
            label={`${t('pos.shift.counted')} (${currency})`}
            hint={t('pos.shift.countedHint')}
            inputMode="decimal"
            autoFocus
            value={counted}
            error={error ?? undefined}
            onChange={(e) => setCounted(e.target.value)}
          />
          <TextField
            label={t('pos.shift.notes')}
            optional
            maxLength={1000}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
          {difference !== null && (
            <p aria-live="polite" className="text-sm font-medium">
              {t('pos.shift.difference')}:{' '}
              <span
                className={
                  difference === 0
                    ? 'text-success-700'
                    : difference > 0
                      ? 'text-warning-700'
                      : 'text-danger-700'
                }
              >
                {difference > 0 ? `+${money(difference)} (${t('pos.shift.over')})` : ''}
                {difference < 0 ? `${money(difference)} (${t('pos.shift.short')})` : ''}
                {difference === 0 ? money(0) : ''}
              </span>
            </p>
          )}
          <div className="flex gap-2">
            <Button variant="secondary" onClick={onCancel}>
              {t('locations.cancel')}
            </Button>
            <Button type="submit" loading={saving}>
              {t('pos.shift.confirmClose')}
            </Button>
          </div>
        </div>
        <div>
          <h3 className="mb-2 text-sm font-semibold text-neutral-900">{t('pos.shift.summary')}</h3>
          <ShiftSummaryList shift={shift} money={money} />
        </div>
      </form>
    </Card>
  );
}

export function CashMovementCard({
  shift,
  currency,
  onCancel,
  onRecorded,
}: {
  shift: Shift;
  currency: CurrencyCode;
  onCancel: () => void;
  onRecorded: (shift: Shift) => void;
}) {
  const { t } = useTranslation();
  const approval = useApproval();
  // One id per form: a retry after a timeout cannot record the movement twice.
  const [id] = useState(newDocumentId);
  const [type, setType] = useState<'PAY_IN' | 'PAY_OUT'>('PAY_IN');
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [errors, setErrors] = useState<{ amount?: string; reason?: string; form?: string }>({});
  const [saving, setSaving] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const parsed = parseMoney(amount, currency);
    const next = {
      ...(!parsed.ok || parsed.minor === 0 ? { amount: 'validation.payment.amount_positive' } : {}),
      ...(reason.trim() ? {} : { reason: 'validation.required' }),
    };
    setErrors(next);
    if (Object.keys(next).length > 0 || !parsed.ok) return;
    setSaving(true);
    try {
      const updated = await approval.run('PAY_OUT', (given) =>
        api.shifts.cashMovement(shift.id, {
          id,
          type,
          amountMinor: parsed.minor,
          reason,
          ...(given ? { approval: given } : {}),
        }),
      );
      if (updated) onRecorded(updated);
    } catch (e) {
      if (isApiError(e) && e.issues.some((i) => i.path === 'amountMinor'))
        setErrors({ amount: e.issues.find((i) => i.path === 'amountMinor')!.message });
      else setErrors({ form: errorMessage(t, e) });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card title={t('pos.shift.cashTitle')}>
      {approval.dialog}
      <form noValidate onSubmit={submit} className="max-w-md space-y-4">
        {errors.form && <Alert tone="danger">{errors.form}</Alert>}
        <fieldset>
          <legend className="text-sm font-medium text-neutral-800">
            {t('pos.shift.cashType')}
          </legend>
          <div className="mt-1 flex gap-2">
            {(['PAY_IN', 'PAY_OUT'] as const).map((value) => (
              <label
                key={value}
                className={`flex min-h-11 cursor-pointer items-center gap-2 rounded-md px-3 text-sm ring-1 ${
                  type === value ? 'bg-brand-50 ring-brand-600' : 'ring-neutral-300'
                }`}
              >
                <input
                  type="radio"
                  name="cash-type"
                  value={value}
                  checked={type === value}
                  onChange={() => setType(value)}
                  className="accent-brand-700"
                />
                {value === 'PAY_IN' ? t('pos.shift.payIn') : t('pos.shift.payOut')}
              </label>
            ))}
          </div>
        </fieldset>
        <TextField
          label={`${t('pos.shift.cashAmount')} (${currency})`}
          inputMode="decimal"
          value={amount}
          error={errors.amount}
          onChange={(e) => setAmount(e.target.value)}
        />
        <TextField
          label={t('pos.shift.cashReason')}
          hint={t('pos.shift.cashReasonHint')}
          maxLength={200}
          value={reason}
          error={errors.reason}
          onChange={(e) => setReason(e.target.value)}
        />
        <div className="flex gap-2">
          <Button variant="secondary" onClick={onCancel}>
            {t('locations.cancel')}
          </Button>
          <Button type="submit" loading={saving}>
            {t('pos.shift.cashSave')}
          </Button>
        </div>
      </form>
    </Card>
  );
}
