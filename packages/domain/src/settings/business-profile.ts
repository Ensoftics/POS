import type { BusinessType } from '../tenancy/business-type';

/**
 * Industry behaviour switches. Every tenant uses the same product and inventory
 * model; the profile only decides which optional fields and rules are active.
 * Presets seed the profile at onboarding and owners can adjust it afterwards.
 */
export const VARIANT_ATTRIBUTES = [
  'brand',
  'shade',
  'colour',
  'size',
  'design',
  'material',
  'flavour',
] as const;
export type VariantAttribute = (typeof VARIANT_ATTRIBUTES)[number];

export const UNIT_CODES = [
  'piece',
  'pack',
  'metre',
  'kilogram',
  'gram',
  'litre',
  'millilitre',
  'dozen',
] as const;
export type UnitCode = (typeof UNIT_CODES)[number];

export interface BusinessProfile {
  /** Record a batch/lot number when receiving stock (cosmetics). */
  trackBatchNumbers: boolean;
  /** Record expiry dates and warn before selling expired stock (cosmetics). */
  trackExpiryDates: boolean;
  /** Allow quantities such as 2.5 metres or 0.75 kg (textiles, weighed goods). */
  allowFractionalQuantities: boolean;
  /** Attributes offered when creating product variants. */
  variantAttributes: VariantAttribute[];
  /** Units offered by default when creating products. */
  defaultUnits: UnitCode[];
}

export const BUSINESS_PROFILE_PRESETS: Record<BusinessType, BusinessProfile> = {
  COSMETICS: {
    trackBatchNumbers: true,
    trackExpiryDates: true,
    allowFractionalQuantities: false,
    variantAttributes: ['brand', 'shade', 'size'],
    defaultUnits: ['piece', 'pack', 'millilitre', 'gram'],
  },
  TEXTILE: {
    trackBatchNumbers: false,
    trackExpiryDates: false,
    allowFractionalQuantities: true,
    variantAttributes: ['colour', 'size', 'design', 'material'],
    defaultUnits: ['piece', 'metre', 'pack'],
  },
  GENERAL_RETAIL: {
    trackBatchNumbers: false,
    trackExpiryDates: false,
    allowFractionalQuantities: true,
    variantAttributes: ['brand', 'size', 'flavour'],
    defaultUnits: ['piece', 'pack', 'kilogram', 'litre', 'dozen'],
  },
};

/** Profile for tenants that have not chosen an industry yet. */
export const NEUTRAL_PROFILE: BusinessProfile = {
  trackBatchNumbers: false,
  trackExpiryDates: false,
  allowFractionalQuantities: false,
  variantAttributes: [],
  defaultUnits: ['piece'],
};

export function profileFor(type: BusinessType | null | undefined): BusinessProfile {
  return type ? BUSINESS_PROFILE_PRESETS[type] : NEUTRAL_PROFILE;
}
