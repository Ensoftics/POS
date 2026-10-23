import { Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { PickedItem } from './ItemPicker';

export interface DocumentLine extends PickedItem {
  quantity: string;
  unitCost?: string;
  batchNumber?: string;
  expiryDate?: string;
}

interface Columns {
  unitCost?: { currency: string };
  batch?: boolean;
  expiry?: boolean;
  quantityHint?: string;
}

/**
 * Editable table of document lines. Errors use API paths such as
 * "lines.2.quantity" (unit cost errors arrive as "lines.N.unitCostMinor").
 */
export function DocumentLines({
  lines,
  onChange,
  columns = {},
  errors = {},
}: {
  lines: DocumentLine[];
  onChange: (lines: DocumentLine[]) => void;
  columns?: Columns;
  errors?: Record<string, string>;
}) {
  const { t } = useTranslation();
  const update = (index: number, patch: Partial<DocumentLine>) =>
    onChange(lines.map((line, i) => (i === index ? { ...line, ...patch } : line)));

  if (lines.length === 0) {
    return <p className="text-sm text-neutral-600">{t('inventory.lines.empty')}</p>;
  }

  const cell = (
    index: number,
    field: string,
    label: string,
    value: string,
    set: (value: string) => void,
    props: Record<string, unknown> = {},
  ) => {
    const error = errors[`lines.${index}.${field}`];
    const id = `line-${index}-${field}`;
    return (
      <div className="space-y-1">
        <label htmlFor={id} className="text-xs font-medium text-neutral-700 lg:sr-only">
          {label}
        </label>
        <input
          id={id}
          value={value}
          onChange={(event) => set(event.target.value)}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}-error` : undefined}
          aria-label={`${label}: ${lines[index]!.productName} ${lines[index]!.sku}`}
          className={`block min-h-11 w-full rounded-md border bg-white px-3 text-sm ${error ? 'border-danger-600' : 'border-neutral-300'}`}
          {...props}
        />
        {error && (
          <p id={`${id}-error`} className="text-xs text-danger-700">
            {t(error, { defaultValue: error })}
          </p>
        )}
      </div>
    );
  };

  const heading = (text: string | false | undefined) => (
    <span className="text-xs font-semibold text-neutral-600">{text || ''}</span>
  );

  return (
    <div>
      {/* Column headings on wide screens; on phones every input has its own label. */}
      <div
        aria-hidden
        className="hidden gap-3 border-b border-neutral-200 pb-2 lg:grid lg:grid-cols-[2fr_1fr_1fr_1fr_1fr_auto]"
      >
        {heading(t('inventory.lines.item'))}
        {heading(t('inventory.lines.quantity'))}
        {heading(
          columns.unitCost && `${t('inventory.lines.unitCost')} (${columns.unitCost.currency})`,
        )}
        {heading(columns.batch && t('inventory.lines.batch'))}
        {heading(columns.expiry && t('inventory.lines.expiry'))}
        <span className="w-11" />
      </div>
      <ol className="divide-y divide-neutral-100">
        {lines.map((line, index) => {
          const itemError = errors[`lines.${index}.variantId`];
          return (
            <li
              key={`${line.variantId}-${index}`}
              className="grid gap-3 py-3 lg:grid-cols-[2fr_1fr_1fr_1fr_1fr_auto] lg:items-start"
            >
              <div className="text-sm">
                <div className="font-medium text-neutral-900">{line.productName}</div>
                <div className="text-xs text-neutral-600">
                  <span className="font-mono">{line.sku}</span>
                  {line.variantLabel && ` · ${line.variantLabel}`}
                </div>
                {itemError && (
                  <p className="text-xs text-danger-700">
                    {t(itemError, { defaultValue: itemError })}
                  </p>
                )}
              </div>
              {cell(
                index,
                'quantity',
                `${t('inventory.lines.quantity')} (${t(`settings.profile.units.${line.unit}`, { defaultValue: line.unit })})`,
                line.quantity,
                (quantity) => update(index, { quantity }),
                {
                  inputMode: 'decimal',
                  placeholder: columns.quantityHint,
                },
              )}
              {columns.unitCost ? (
                cell(
                  index,
                  'unitCostMinor',
                  `${t('inventory.lines.unitCost')} (${columns.unitCost.currency})`,
                  line.unitCost ?? '',
                  (unitCost) => update(index, { unitCost }),
                  { inputMode: 'decimal' },
                )
              ) : (
                <span className="hidden lg:block" />
              )}
              {columns.batch ? (
                cell(
                  index,
                  'batchNumber',
                  t('inventory.lines.batch'),
                  line.batchNumber ?? '',
                  (batchNumber) => update(index, { batchNumber }),
                )
              ) : (
                <span className="hidden lg:block" />
              )}
              {columns.expiry ? (
                cell(
                  index,
                  'expiryDate',
                  t('inventory.lines.expiry'),
                  line.expiryDate ?? '',
                  (expiryDate) => update(index, { expiryDate }),
                  { type: 'date' },
                )
              ) : (
                <span className="hidden lg:block" />
              )}
              <button
                type="button"
                onClick={() => onChange(lines.filter((_, i) => i !== index))}
                aria-label={`${t('inventory.lines.remove')} ${line.productName} ${line.sku}`}
                className="flex size-11 items-center justify-center rounded-md text-neutral-500 hover:bg-neutral-100 hover:text-danger-700"
              >
                <Trash2 aria-hidden className="size-4" />
              </button>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
