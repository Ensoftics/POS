import { isApiError } from '@pos/api-client';
import type { Variant, VariantInput } from '@pos/contracts';
import {
  type CurrencyCode,
  formatMoney,
  minorToDecimalString,
  parseMoney,
  type VariantAttribute,
} from '@pos/domain';
import { INTL_LOCALES, isSupportedLanguage } from '@pos/i18n';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';
import { api } from './api';
import { useAuthContext } from './auth-store';
import { useSettings } from './settings';

export const productsKey = (tenantId: string) => ['products', tenantId] as const;
export const categoriesKey = (tenantId: string) => ['categories', tenantId] as const;

export function useCategories() {
  const { tenant } = useAuthContext();
  return useQuery({ queryKey: categoriesKey(tenant.id), queryFn: () => api.categories.list() });
}

/** Currency of the business plus a formatter for the current UI language. */
export function useMoney() {
  const { i18n } = useTranslation();
  const settings = useSettings();
  const currency: CurrencyCode = settings.data?.currency ?? 'LKR';
  const locale = isSupportedLanguage(i18n.resolvedLanguage)
    ? INTL_LOCALES[i18n.resolvedLanguage]
    : 'en-LK';
  return {
    currency,
    ready: settings.isSuccess,
    format: (minor: number) => formatMoney(minor, currency, locale),
  };
}

/* Variant form ------------------------------------------------------------ */

/** Editable text form of a variant; converted to the API's integer money on submit. */
export interface VariantFormValues {
  sku: string;
  barcode: string;
  price: string;
  cost: string;
  packSize: string;
  reorderLevel: string;
  attributes: Partial<Record<VariantAttribute, string>>;
}

export const emptyVariant = (): VariantFormValues => ({
  sku: '',
  barcode: '',
  price: '',
  cost: '',
  packSize: '',
  reorderLevel: '',
  attributes: {},
});

export function variantToForm(variant: Variant, currency: CurrencyCode): VariantFormValues {
  return {
    sku: variant.sku,
    barcode: variant.barcode ?? '',
    price: minorToDecimalString(variant.priceMinor, currency),
    cost: variant.costMinor === null ? '' : minorToDecimalString(variant.costMinor, currency),
    packSize: variant.packSize?.toString() ?? '',
    reorderLevel: variant.reorderLevel ?? '',
    attributes: { ...variant.attributes },
  };
}

/** Client-side checks for the parts the contract cannot see (decimal text money). */
export function variantFormSchema(currency: CurrencyCode) {
  const money = (required: boolean) =>
    z.string().superRefine((value, ctx) => {
      if (!value.trim()) {
        if (required) ctx.addIssue({ code: 'custom', message: 'validation.required' });
        return;
      }
      const parsed = parseMoney(value, currency);
      if (!parsed.ok) ctx.addIssue({ code: 'custom', message: `validation.money.${parsed.issue}` });
    });
  return z.object({
    sku: z.string().trim().min(1, { error: 'validation.required' }),
    barcode: z.string(),
    price: money(true),
    cost: money(false),
    packSize: z.string().regex(/^(\d{1,5})?$/, { error: 'validation.import.pack_size' }),
    reorderLevel: z
      .string()
      .regex(/^(\d{1,9}(\.\d{1,3})?)?$/, { error: 'validation.quantity.invalid' }),
    attributes: z.record(z.string(), z.string().max(40, { error: 'validation.text.too_long' })),
  });
}

export function formToVariantInput(
  values: VariantFormValues,
  currency: CurrencyCode,
): VariantInput {
  const toMinor = (text: string) => {
    const parsed = parseMoney(text, currency);
    if (!parsed.ok) throw new Error('Money should have been validated before submit');
    return parsed.minor;
  };
  const attributes = Object.fromEntries(
    Object.entries(values.attributes).filter(([, value]) => value && value.trim() !== ''),
  );
  return {
    sku: values.sku,
    barcode: values.barcode,
    attributes,
    priceMinor: toMinor(values.price),
    costMinor: values.cost.trim() ? toMinor(values.cost) : null,
    packSize: values.packSize ? Number(values.packSize) : null,
    reorderLevel: values.reorderLevel.trim() || null,
  };
}

/** API field names -> form field names, so server errors land on the right input. */
export function formPathFor(apiPath: string): string {
  return apiPath.replace(/priceMinor$/, 'price').replace(/costMinor$/, 'cost');
}

export function serverIssues(error: unknown): Array<{ path: string; message: string }> {
  return isApiError(error) && error.code === 'VALIDATION_FAILED'
    ? error.issues.map((issue) => ({ path: formPathFor(issue.path), message: issue.message }))
    : [];
}

/** Saves text as a file in the browser (used for CSV exports and templates). */
export function downloadText(filename: string, text: string, type = 'text/csv;charset=utf-8') {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}
