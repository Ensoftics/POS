/**
 * Industry profile chosen during onboarding. It selects default product
 * attributes and modules, but every tenant shares the same core data model.
 */
export const BUSINESS_TYPES = ['COSMETICS', 'TEXTILE', 'GENERAL_RETAIL'] as const;
export type BusinessType = (typeof BUSINESS_TYPES)[number];
