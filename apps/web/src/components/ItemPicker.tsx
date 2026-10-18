import { isApiError } from '@pos/api-client';
import type { CatalogItem, Product, Variant } from '@pos/contracts';
import { useQuery } from '@tanstack/react-query';
import { ScanLine } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../lib/api';
import { errorMessage } from '../lib/errors';
import { ProductThumb } from './ProductThumb';

export interface PickedItem {
  variantId: string;
  productName: string;
  sku: string;
  variantLabel: string;
  unit: string;
  costMinor: number | null;
}

function toPicked(product: Product, variant: Variant): PickedItem {
  return {
    variantId: variant.id,
    productName: product.name,
    sku: variant.sku,
    variantLabel: Object.values(variant.attributes).join(' / '),
    unit: product.unit,
    costMinor: variant.costMinor,
  };
}

/** The device's copy of the catalogue, used when the server cannot be reached. */
export interface OfflineCatalog {
  findByCode(code: string): Promise<CatalogItem | null>;
  search(text: string, limit?: number): Promise<CatalogItem[]>;
  onPick(item: CatalogItem): void;
}

const unreachable = (error: unknown) => !isApiError(error) || error.isTransient;

/**
 * Adds items to a document. Barcode scanners (and typed SKUs) end with Enter and
 * add the exact match; typing a name shows matching variants to choose from.
 * With `offline`, lookups fall back to the local catalogue when the server is
 * unreachable, so a till keeps selling without a connection.
 */
export function ItemPicker({
  onPick,
  label,
  hint,
  autoFocus,
  offline,
}: {
  onPick: (item: PickedItem, product: Product, variant: Variant) => void;
  label?: string;
  hint?: string;
  autoFocus?: boolean;
  offline?: OfflineCatalog;
}) {
  const { t } = useTranslation();
  const id = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [text, setText] = useState('');
  const [query, setQuery] = useState('');
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => setQuery(text.trim()), 250);
    return () => clearTimeout(timer);
  }, [text]);

  const results = useQuery({
    queryKey: ['item-picker', query, !!offline],
    queryFn: async (): Promise<{ online: Product[]; local: CatalogItem[] }> => {
      try {
        return { online: (await api.products.list({ q: query, limit: 8 })).items, local: [] };
      } catch (error) {
        if (!offline || !unreachable(error)) throw error;
        return { online: [], local: await offline.search(query, 8) };
      }
    },
    enabled: query.length >= 2,
    retry: false,
  });

  const pick = (product: Product, variant: Variant) => {
    onPick(toPicked(product, variant), product, variant);
    setText('');
    setQuery('');
    setMessage(null);
    // Ready for the next scan.
    inputRef.current?.focus();
  };

  const lookUp = async () => {
    const code = text.trim();
    if (!code) return;
    // Clear now, not when the lookup returns: a scanner may already be sending the next code.
    setText('');
    setQuery('');
    setMessage(null);
    try {
      const { product, variant } = await api.products.lookup(code);
      onPick(toPicked(product, variant), product, variant);
    } catch (error) {
      if (offline && unreachable(error)) {
        const local = await offline.findByCode(code);
        if (local) return offline.onPick(local);
      }
      // Give the code back for correction unless something new was typed meanwhile.
      setText((current) => (current === '' ? code : current));
      setMessage(
        (isApiError(error) && error.code === 'NOT_FOUND') || (offline && unreachable(error))
          ? t('inventory.lines.noMatch', { code })
          : errorMessage(t, error),
      );
    }
  };

  const pickLocal = (item: CatalogItem) => {
    offline?.onPick(item);
    setText('');
    setQuery('');
    setMessage(null);
    inputRef.current?.focus();
  };

  const options =
    query.length >= 2
      ? [
          ...(results.data?.online ?? []).flatMap((product) =>
            product.variants
              .filter((v) => v.status === 'ACTIVE')
              .map((variant) => ({
                key: variant.id,
                name: product.name,
                label: Object.values(variant.attributes).join(' / '),
                sku: variant.sku,
                imageUrl: product.images?.[0]?.thumbUrl,
                choose: () => pick(product, variant),
              })),
          ),
          ...(results.data?.local ?? []).map((item) => ({
            key: item.variantId,
            name: item.productName,
            label: item.variantLabel,
            sku: item.sku,
            imageUrl: item.imageUrl,
            choose: () => pickLocal(item),
          })),
        ]
      : [];

  return (
    <div className="space-y-2">
      <label htmlFor={id} className="block text-sm font-medium text-neutral-800">
        {label ?? t('inventory.lines.add')}
      </label>
      <div className="relative">
        <ScanLine
          aria-hidden
          className="pointer-events-none absolute left-3 top-3 size-5 text-neutral-400"
        />
        <input
          id={id}
          ref={inputRef}
          type="search"
          autoFocus={autoFocus}
          autoComplete="off"
          aria-describedby={`${id}-hint`}
          value={text}
          onChange={(event) => {
            setText(event.target.value);
            setMessage(null);
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              void lookUp();
            }
          }}
          className="block min-h-11 w-full rounded-md border border-neutral-300 bg-white pl-10 pr-3 text-base focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-600/30"
        />
      </div>
      <p id={`${id}-hint`} className="text-xs text-neutral-600">
        {hint ?? t('inventory.lines.addHint')}
      </p>
      <div aria-live="polite">
        {message && <p className="text-sm text-warning-700">{message}</p>}
      </div>
      {options.length > 0 && (
        <ul className="divide-y divide-neutral-100 rounded-md border border-neutral-200 bg-white">
          {options.map((option) => (
            <li key={option.key}>
              <button
                type="button"
                onClick={option.choose}
                className="flex min-h-11 w-full items-center justify-between gap-3 px-3 text-left text-sm hover:bg-neutral-50"
              >
                <span className="flex min-w-0 items-center gap-3 py-1">
                  <ProductThumb url={option.imageUrl} size="sm" />
                  <span>
                    <span className="font-medium text-neutral-900">{option.name}</span>
                    {option.label && <span className="text-neutral-600"> — {option.label}</span>}
                  </span>
                </span>
                <span className="font-mono text-xs text-neutral-600">{option.sku}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
