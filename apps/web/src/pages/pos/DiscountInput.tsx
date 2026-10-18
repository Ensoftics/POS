import {
  type CurrencyCode,
  type Discount,
  type DiscountKind,
  formatPercent,
  minorToDecimalString,
  parseMoney,
  parsePercent,
} from '@pos/domain';
import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';

const toText = (discount: Discount | null, currency: CurrencyCode) =>
  !discount
    ? ''
    : discount.kind === 'PERCENT'
      ? formatPercent(discount.value)
      : minorToDecimalString(discount.value, currency);

/**
 * Discount entry as a percentage or an amount. The value is applied as soon as it
 * parses; invalid text is shown as an error and leaves the previous discount.
 */
export function DiscountInput({
  label,
  value,
  currency,
  onChange,
  error,
}: {
  label: string;
  value: Discount | null;
  currency: CurrencyCode;
  onChange: (discount: Discount | null) => void;
  error?: string;
}) {
  const { t } = useTranslation();
  const id = useId();
  const [kind, setKind] = useState<DiscountKind>(value?.kind ?? 'PERCENT');
  const [text, setText] = useState(toText(value, currency));
  const [invalid, setInvalid] = useState(false);

  const apply = (nextKind: DiscountKind, nextText: string) => {
    if (nextText.trim() === '') {
      setInvalid(false);
      onChange(null);
      return;
    }
    if (nextKind === 'PERCENT') {
      const bp = parsePercent(nextText);
      setInvalid(bp === null);
      if (bp !== null) onChange({ kind: 'PERCENT', value: bp });
    } else {
      const parsed = parseMoney(nextText, currency);
      setInvalid(!parsed.ok);
      if (parsed.ok) onChange({ kind: 'AMOUNT', value: parsed.minor });
    }
  };

  const message = invalid
    ? t(kind === 'PERCENT' ? 'validation.percent.invalid' : 'validation.money.invalid')
    : error
      ? t(error)
      : null;

  return (
    <div>
      <label htmlFor={id} className="block text-xs font-medium text-neutral-700">
        {label}
      </label>
      <div className="mt-1 flex">
        <select
          aria-label={`${label}: ${t('pos.discount')}`}
          value={kind}
          onChange={(event) => {
            const next = event.target.value as DiscountKind;
            setKind(next);
            apply(next, text);
          }}
          className="min-h-11 rounded-l-md border border-r-0 border-neutral-300 bg-neutral-50 px-2 text-sm"
        >
          <option value="PERCENT">{t('pos.percent')}</option>
          <option value="AMOUNT">{currency}</option>
        </select>
        <input
          id={id}
          inputMode="decimal"
          autoComplete="off"
          value={text}
          placeholder="0"
          aria-invalid={message ? true : undefined}
          aria-describedby={message ? `${id}-error` : undefined}
          onChange={(event) => {
            setText(event.target.value);
            apply(kind, event.target.value);
          }}
          className="min-h-11 w-full min-w-0 rounded-r-md border border-neutral-300 px-3 text-right text-base tabular-nums focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-600/30"
        />
      </div>
      {message && (
        <p id={`${id}-error`} className="mt-1 text-xs text-danger-700">
          {message}
        </p>
      )}
    </div>
  );
}
