/**
 * Supported currencies with ISO 4217 minor units. Amounts are always stored in
 * integer minor units; `minorUnits` drives rounding and display. LKR is the default.
 */
export const CURRENCIES = {
  LKR: { minorUnits: 2, name: 'Sri Lankan rupee' },
  INR: { minorUnits: 2, name: 'Indian rupee' },
  MVR: { minorUnits: 2, name: 'Maldivian rufiyaa' },
  USD: { minorUnits: 2, name: 'US dollar' },
  EUR: { minorUnits: 2, name: 'Euro' },
  GBP: { minorUnits: 2, name: 'Pound sterling' },
  AED: { minorUnits: 2, name: 'UAE dirham' },
  AUD: { minorUnits: 2, name: 'Australian dollar' },
  SGD: { minorUnits: 2, name: 'Singapore dollar' },
  JPY: { minorUnits: 0, name: 'Japanese yen' },
} as const;

export type CurrencyCode = keyof typeof CURRENCIES;
export const CURRENCY_CODES = Object.keys(CURRENCIES) as [CurrencyCode, ...CurrencyCode[]];
export const DEFAULT_CURRENCY: CurrencyCode = 'LKR';

export function isCurrencyCode(value: unknown): value is CurrencyCode {
  return typeof value === 'string' && value in CURRENCIES;
}
