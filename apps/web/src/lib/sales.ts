import type { Branch, Product, Variant } from '@pos/contracts';
import type { CartItem } from '@pos/domain';
import { useQuery } from '@tanstack/react-query';
import { INTL_LOCALES, isSupportedLanguage } from '@pos/i18n';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from './api';
import { useAuthContext } from './auth-store';
import { useActiveBranches } from './inventory';
import { useSettings } from './settings';

export const taxRatesKey = (tenantId: string) => ['tax-rates', tenantId] as const;
export const salesKey = (tenantId: string) => ['sales', tenantId] as const;
export const shiftKey = (tenantId: string, registerId: string | null) =>
  ['shift', tenantId, registerId] as const;

export function useTaxRates() {
  const { tenant } = useAuthContext();
  return useQuery({ queryKey: taxRatesKey(tenant.id), queryFn: () => api.taxRates.list() });
}

export function toCartItem(product: Product, variant: Variant): CartItem {
  return {
    variantId: variant.id,
    productName: product.name,
    sku: variant.sku,
    variantLabel: Object.values(variant.attributes).join(' / '),
    unit: product.unit,
    unitPriceMinor: variant.priceMinor,
    taxRateId: product.taxRateId,
  };
}

export interface SelectedRegister {
  branch: Branch;
  registerId: string;
  registerName: string;
}

/**
 * The register this browser sells from, remembered per business. Archived
 * registers or branches drop out automatically because only active ones are offered.
 */
export function useSelectedRegister(): {
  selected: SelectedRegister | null;
  choose: (registerId: string | null) => void;
  options: Array<{ branch: Branch; registerId: string; label: string }>;
  isPending: boolean;
} {
  const { tenant } = useAuthContext();
  const branches = useActiveBranches();
  const storageKey = `pos.web.register.${tenant.id}`;
  const [stored, setStored] = useState<string | null>(() => {
    try {
      return localStorage.getItem(storageKey);
    } catch {
      return null;
    }
  });
  const options = (branches.data ?? []).flatMap((branch) =>
    branch.registers
      .filter((register) => register.status === 'ACTIVE')
      .map((register) => ({
        branch,
        registerId: register.id,
        label: `${branch.name} › ${register.name}`,
        registerName: register.name,
      })),
  );
  const match = options.find((option) => option.registerId === stored) ?? null;
  // A single register needs no choice.
  const effective = match ?? (options.length === 1 ? options[0]! : null);

  useEffect(() => {
    if (branches.isSuccess && stored && !match) setStored(null);
  }, [branches.isSuccess, stored, match]);

  const choose = (registerId: string | null) => {
    setStored(registerId);
    try {
      if (registerId) localStorage.setItem(storageKey, registerId);
      else localStorage.removeItem(storageKey);
    } catch {
      // Non-fatal: the choice is simply not remembered.
    }
  };

  return {
    selected: effective
      ? {
          branch: effective.branch,
          registerId: effective.registerId,
          registerName: effective.registerName,
        }
      : null,
    choose,
    options,
    isPending: branches.isPending,
  };
}

/** Formats instants as date and time in the business's timezone and the UI language. */
export function useBusinessDateTime(timeZone?: string): (iso: string) => string {
  const { i18n } = useTranslation();
  const settings = useSettings();
  const locale = isSupportedLanguage(i18n.resolvedLanguage)
    ? INTL_LOCALES[i18n.resolvedLanguage]
    : 'en-LK';
  const zone = timeZone ?? settings.data?.timezone;
  const format = new Intl.DateTimeFormat(locale, {
    dateStyle: 'medium',
    timeStyle: 'short',
    ...(zone ? { timeZone: zone } : {}),
  });
  return (iso: string) => format.format(new Date(iso));
}

/** The current user's open shift on this browser's register, if any. */
export function useMyOpenShift() {
  const { tenant, user, permissions } = useAuthContext();
  const register = useSelectedRegister();
  const registerId = register.selected?.registerId ?? null;
  const shift = useQuery({
    queryKey: shiftKey(tenant.id, registerId),
    queryFn: () => api.shifts.current(registerId!),
    enabled: !!registerId,
  });
  const current = shift.data?.shift ?? null;
  const mine =
    current && (current.openedById === user.id || permissions.includes('shifts.manage'))
      ? current
      : null;
  return { shift: mine, isPending: register.isPending || (!!registerId && shift.isPending) };
}
