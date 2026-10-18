import { CURRENCIES, type CurrencyCode } from '../settings/currency';

/**
 * Money is always an integer number of minor units (cents, cents of a rupee).
 * Parsing works on strings so no binary floating point is ever involved.
 * The limit keeps values exactly representable as JS numbers and in BIGINT columns.
 */
export const MAX_MINOR_UNITS = 999_999_999_999; // 9,999,999,999.99 in a 2-decimal currency

export type MoneyParseIssue = 'invalid' | 'too_many_decimals' | 'negative' | 'too_large';

export type MoneyParseResult = { ok: true; minor: number } | { ok: false; issue: MoneyParseIssue };

/**
 * Parses user input such as "1,250.5" or "1250.50" into minor units.
 * Grouping commas and spaces are ignored; the decimal separator is ".".
 */
export function parseMoney(input: string, currency: CurrencyCode): MoneyParseResult {
  const digits = CURRENCIES[currency].minorUnits;
  const text = input.trim().replace(/[,\s]/g, '');
  if (text.startsWith('-')) return { ok: false, issue: 'negative' };
  const match = /^(\d+)(?:\.(\d*))?$/.exec(text);
  if (!match) return { ok: false, issue: 'invalid' };
  const [, whole = '0', fraction = ''] = match;
  if (fraction.length > digits) return { ok: false, issue: 'too_many_decimals' };
  const minorText = `${whole}${fraction.padEnd(digits, '0')}`.replace(/^0+(?=\d)/, '');
  if (minorText.length > String(MAX_MINOR_UNITS).length || Number(minorText) > MAX_MINOR_UNITS) {
    return { ok: false, issue: 'too_large' };
  }
  return { ok: true, minor: Number(minorText) };
}

/** Plain decimal string for editing and CSV, e.g. 125050 LKR -> "1250.50". */
export function minorToDecimalString(minor: number, currency: CurrencyCode): string {
  const digits = CURRENCIES[currency].minorUnits;
  if (!Number.isSafeInteger(minor))
    throw new RangeError('Money must be a safe integer of minor units');
  const sign = minor < 0 ? '-' : '';
  const text = String(Math.abs(minor)).padStart(digits + 1, '0');
  if (digits === 0) return sign + text;
  return `${sign}${text.slice(0, -digits)}.${text.slice(-digits)}`;
}

/** Localised display, e.g. "Rs 1,250.50" / "LKR 1,250.50" depending on locale data. */
export function formatMoney(minor: number, currency: CurrencyCode, locale = 'en-LK'): string {
  const digits = CURRENCIES[currency].minorUnits;
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(Number(minorToDecimalString(minor, currency)));
}
