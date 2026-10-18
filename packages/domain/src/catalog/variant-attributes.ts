import type { VariantAttribute } from '../settings/business-profile';

export type VariantAttributes = Partial<Record<VariantAttribute, string>>;

/**
 * Canonical key for a variant's attribute combination (sorted, case-insensitive),
 * used to stop two variants of one product having the same options.
 */
export function variantAttributesKey(attributes: VariantAttributes): string {
  return Object.entries(attributes)
    .filter(([, value]) => value !== undefined && value.trim() !== '')
    .map(([name, value]) => `${name}=${value!.trim().toLowerCase()}`)
    .sort()
    .join('|');
}

/** Attribute names used that the business has not enabled in its profile. */
export function disallowedAttributes(
  attributes: VariantAttributes,
  enabled: readonly VariantAttribute[],
): string[] {
  return Object.keys(attributes).filter((name) => !enabled.includes(name as VariantAttribute));
}
