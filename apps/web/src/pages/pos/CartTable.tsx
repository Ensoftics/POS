import {
  type Cart,
  type CartTotals,
  type CurrencyCode,
  parseQuantity,
  removeLine,
  setLineDiscount,
  setLineQuantity,
} from '@pos/domain';
import { Percent, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { DiscountInput } from './DiscountInput';

export function CartTable({
  cart,
  totals,
  currency,
  money,
  allowFraction,
  canDiscount,
  lineErrors,
  onChange,
}: {
  cart: Cart;
  totals: CartTotals;
  currency: CurrencyCode;
  money: (minor: number) => string;
  allowFraction: boolean;
  canDiscount: boolean;
  lineErrors: Record<number, string>;
  onChange: (cart: Cart) => void;
}) {
  const { t } = useTranslation();
  const [discounting, setDiscounting] = useState<string | null>(null);

  if (cart.lines.length === 0) {
    return (
      <p className="rounded-md border border-dashed border-neutral-300 p-8 text-center text-sm text-neutral-600">
        {t('pos.emptyCart')}
      </p>
    );
  }

  return (
    <ul className="divide-y divide-neutral-100 rounded-md bg-white ring-1 ring-neutral-200">
      {cart.lines.map((line, index) => {
        const lineTotals = totals.lines[index];
        const quantity = parseQuantity(line.quantity, { allowFraction });
        const quantityError = !quantity.ok ? t(`validation.quantity.${quantity.issue}`) : null;
        const name = line.variantLabel
          ? `${line.productName} (${line.variantLabel})`
          : line.productName;
        return (
          <li key={line.key} className="space-y-2 p-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate font-medium text-neutral-900">{line.productName}</p>
                <p className="text-xs text-neutral-600">
                  {line.variantLabel && `${line.variantLabel} · `}
                  <span className="font-mono">{line.sku}</span> · {money(line.unitPriceMinor)}
                  {line.unit !== 'piece' && ` / ${t(`settings.profile.units.${line.unit}`)}`}
                </p>
              </div>
              <p className="shrink-0 text-right font-semibold tabular-nums text-neutral-900">
                {lineTotals ? money(lineTotals.grossMinor - lineTotals.lineDiscountMinor) : '—'}
                {lineTotals && lineTotals.lineDiscountMinor > 0 && (
                  <span className="block text-xs font-normal text-success-700">
                    -{money(lineTotals.lineDiscountMinor)}
                  </span>
                )}
              </p>
            </div>
            <div className="flex flex-wrap items-end gap-2">
              <div className="w-28">
                <label htmlFor={`qty-${line.key}`} className="sr-only">
                  {t('pos.quantityFor', { name })}
                </label>
                <input
                  id={`qty-${line.key}`}
                  inputMode={allowFraction ? 'decimal' : 'numeric'}
                  autoComplete="off"
                  value={line.quantity}
                  aria-invalid={quantityError ? true : undefined}
                  aria-describedby={quantityError ? `qty-${line.key}-error` : undefined}
                  onChange={(event) =>
                    onChange(setLineQuantity(cart, line.key, event.target.value))
                  }
                  className="min-h-11 w-full rounded-md border border-neutral-300 px-3 text-right text-base tabular-nums focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-600/30"
                />
              </div>
              {canDiscount && (
                <button
                  type="button"
                  aria-expanded={discounting === line.key}
                  aria-label={t('pos.lineDiscountFor', { name })}
                  onClick={() => setDiscounting(discounting === line.key ? null : line.key)}
                  className={`inline-flex min-h-11 min-w-11 items-center justify-center rounded-md ring-1 ${
                    line.discount
                      ? 'bg-success-50 text-success-700 ring-success-600/30'
                      : 'text-neutral-700 ring-neutral-300 hover:bg-neutral-100'
                  }`}
                >
                  <Percent aria-hidden className="size-4" />
                </button>
              )}
              <button
                type="button"
                aria-label={t('pos.remove', { name })}
                onClick={() => onChange(removeLine(cart, line.key))}
                className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-md text-danger-700 ring-1 ring-neutral-300 hover:bg-danger-50"
              >
                <Trash2 aria-hidden className="size-4" />
              </button>
            </div>
            {quantityError && (
              <p id={`qty-${line.key}-error`} className="text-xs text-danger-700">
                {quantityError}
              </p>
            )}
            {discounting === line.key && canDiscount && (
              <div className="max-w-xs">
                <DiscountInput
                  label={t('pos.lineDiscountFor', { name })}
                  value={line.discount}
                  currency={currency}
                  onChange={(discount) => onChange(setLineDiscount(cart, line.key, discount))}
                />
              </div>
            )}
            {lineErrors[index] && <p className="text-xs text-danger-700">{t(lineErrors[index])}</p>}
          </li>
        );
      })}
    </ul>
  );
}
