import {
  type CartTotals,
  type CurrencyCode,
  minorToDecimalString,
  parseMoney,
  PAYMENT_METHODS,
  type PaymentMethod,
} from '@pos/domain';
import { Plus, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';

export interface PaymentDraft {
  key: string;
  method: PaymentMethod;
  amount: string;
  reference: string;
}

export const newPayment = (method: PaymentMethod = 'CASH'): PaymentDraft => ({
  key: Math.random().toString(36).slice(2),
  method,
  amount: '',
  reference: '',
});

/** Parsed payments, or null when an amount is not a valid positive number. */
export function parsePayments(
  drafts: PaymentDraft[],
  currency: CurrencyCode,
): Array<{ method: PaymentMethod; amountMinor: number; reference: string | null }> | null {
  const result = [];
  for (const draft of drafts) {
    if (draft.amount.trim() === '') continue;
    const parsed = parseMoney(draft.amount, currency);
    if (!parsed.ok || parsed.minor === 0) return null;
    result.push({
      method: draft.method,
      amountMinor: parsed.minor,
      reference: draft.reference.trim() || null,
    });
  }
  return result;
}

export function TotalsSummary({
  totals,
  pricesIncludeTax,
  money,
}: {
  totals: CartTotals;
  pricesIncludeTax: boolean;
  money: (minor: number) => string;
}) {
  const { t } = useTranslation();
  return (
    <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 text-sm">
      <dt className="text-neutral-600">{t('pos.subtotal')}</dt>
      <dd className="text-right tabular-nums">{money(totals.subtotalMinor)}</dd>
      {totals.discountMinor > 0 && (
        <>
          <dt className="text-neutral-600">{t('pos.discounts')}</dt>
          <dd className="text-right tabular-nums text-success-700">
            -{money(totals.discountMinor)}
          </dd>
        </>
      )}
      {totals.taxMinor > 0 && (
        <>
          <dt className="text-neutral-600">
            {pricesIncludeTax ? t('pos.taxIncluded') : t('pos.tax')}
          </dt>
          <dd className="text-right tabular-nums">{money(totals.taxMinor)}</dd>
        </>
      )}
      <dt className="pt-2 text-lg font-semibold text-neutral-900">{t('pos.total')}</dt>
      <dd
        className="pt-2 text-right text-2xl font-bold tabular-nums text-neutral-900"
        data-testid="cart-total"
      >
        {money(totals.totalMinor)}
      </dd>
    </dl>
  );
}

export function PaymentPanel({
  totalMinor,
  payments,
  currency,
  money,
  error,
  onChange,
  methods = PAYMENT_METHODS.filter((m) => m !== 'ACCOUNT'),
}: {
  /** Methods offered; ACCOUNT only when a customer with credit is attached. */
  methods?: readonly PaymentMethod[];
  totalMinor: number;
  payments: PaymentDraft[];
  currency: CurrencyCode;
  money: (minor: number) => string;
  error: string | null;
  onChange: (payments: PaymentDraft[]) => void;
}) {
  const { t } = useTranslation();
  const parsed = parsePayments(payments, currency);
  const paid = parsed?.reduce((sum, p) => sum + p.amountMinor, 0) ?? 0;
  const due = Math.max(0, totalMinor - paid);
  const change = Math.max(0, paid - totalMinor);
  const update = (key: string, patch: Partial<PaymentDraft>) =>
    onChange(payments.map((p) => (p.key === key ? { ...p, ...patch } : p)));

  return (
    <fieldset className="space-y-3">
      <legend className="text-sm font-semibold text-neutral-900">{t('pos.payments')}</legend>
      {payments.map((payment, index) => {
        const amountValid = payment.amount.trim() === '' || parseMoney(payment.amount, currency).ok;
        const others = payments
          .filter((p) => p.key !== payment.key)
          .reduce((sum, p) => {
            const value = parseMoney(p.amount || '0', currency);
            return sum + (value.ok ? value.minor : 0);
          }, 0);
        return (
          <div key={payment.key} className="space-y-2 rounded-md bg-neutral-50 p-3">
            <div className="flex items-end gap-2">
              <div className="w-36 shrink-0">
                <label
                  htmlFor={`method-${payment.key}`}
                  className="block text-xs font-medium text-neutral-700"
                >
                  {t('pos.method')}
                </label>
                <select
                  id={`method-${payment.key}`}
                  value={payment.method}
                  onChange={(e) => update(payment.key, { method: e.target.value as PaymentMethod })}
                  className="mt-1 min-h-11 w-full rounded-md border border-neutral-300 bg-white px-2 text-sm"
                >
                  {[...new Set([...methods, payment.method])].map((method) => (
                    <option key={method} value={method}>
                      {t(`paymentMethods.${method}`)}
                    </option>
                  ))}
                </select>
              </div>
              <div className="min-w-0 flex-1">
                <label
                  htmlFor={`amount-${payment.key}`}
                  className="block text-xs font-medium text-neutral-700"
                >
                  {t('pos.paymentAmount')} ({currency})
                </label>
                <input
                  id={`amount-${payment.key}`}
                  inputMode="decimal"
                  autoComplete="off"
                  value={payment.amount}
                  aria-invalid={amountValid ? undefined : true}
                  onChange={(e) => update(payment.key, { amount: e.target.value })}
                  className="mt-1 min-h-11 w-full rounded-md border border-neutral-300 px-3 text-right text-base tabular-nums focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-600/30"
                />
              </div>
              <button
                type="button"
                onClick={() =>
                  update(payment.key, {
                    amount: minorToDecimalString(Math.max(0, totalMinor - others), currency),
                  })
                }
                className="min-h-11 rounded-md px-3 text-sm font-medium text-brand-800 ring-1 ring-neutral-300 hover:bg-white"
              >
                {t('pos.exact')}
              </button>
              {payments.length > 1 && (
                <button
                  type="button"
                  aria-label={`${t('pos.removePayment')} ${index + 1}`}
                  onClick={() => onChange(payments.filter((p) => p.key !== payment.key))}
                  className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-md text-neutral-600 hover:bg-white"
                >
                  <X aria-hidden className="size-4" />
                </button>
              )}
            </div>
            {!amountValid && (
              <p className="text-xs text-danger-700">{t('validation.money.invalid')}</p>
            )}
            {payment.method !== 'CASH' && (
              <div>
                <label
                  htmlFor={`ref-${payment.key}`}
                  className="block text-xs font-medium text-neutral-700"
                >
                  {t('pos.reference')}
                </label>
                <input
                  id={`ref-${payment.key}`}
                  autoComplete="off"
                  maxLength={40}
                  value={payment.reference}
                  aria-describedby={`ref-${payment.key}-hint`}
                  onChange={(e) => update(payment.key, { reference: e.target.value })}
                  className="mt-1 min-h-11 w-full rounded-md border border-neutral-300 px-3 text-sm"
                />
                <p id={`ref-${payment.key}-hint`} className="mt-1 text-xs text-neutral-600">
                  {t('pos.referenceHint')}
                </p>
              </div>
            )}
          </div>
        );
      })}
      {payments.length < 10 && (
        <button
          type="button"
          onClick={() => onChange([...payments, newPayment('CARD')])}
          className="inline-flex min-h-11 items-center gap-1 text-sm font-medium text-brand-800 hover:underline"
        >
          <Plus aria-hidden className="size-4" />
          {t('pos.addPayment')}
        </button>
      )}
      <dl aria-live="polite" className="grid grid-cols-[1fr_auto] gap-x-4 text-sm">
        <dt className="text-neutral-600">{t('pos.due')}</dt>
        <dd className="text-right font-semibold tabular-nums" data-testid="amount-due">
          {money(due)}
        </dd>
        {change > 0 && (
          <>
            <dt className="text-neutral-600">{t('pos.change')}</dt>
            <dd
              className="text-right text-lg font-bold tabular-nums text-success-700"
              data-testid="change-due"
            >
              {money(change)}
            </dd>
          </>
        )}
      </dl>
      {error && (
        <p role="alert" className="text-sm text-danger-700">
          {t(error)}
        </p>
      )}
    </fieldset>
  );
}
