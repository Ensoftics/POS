/**
 * Quantities (stock, reorder levels, fabric lengths) have up to 3 decimals and
 * travel as decimal strings to avoid floating point drift. Whole-number units
 * (pieces) reject fractions unless the business profile allows them.
 */
export const QUANTITY_DECIMALS = 3;
export const MAX_QUANTITY = 999_999_999;

export type QuantityIssue =
  'invalid' | 'too_many_decimals' | 'negative' | 'too_large' | 'fraction_not_allowed';

export function parseQuantity(
  input: string,
  options: { allowFraction: boolean },
): { ok: true; value: string } | { ok: false; issue: QuantityIssue } {
  const text = input.trim().replace(/,/g, '');
  if (text.startsWith('-')) return { ok: false, issue: 'negative' };
  const match = /^(\d+)(?:\.(\d*))?$/.exec(text);
  if (!match) return { ok: false, issue: 'invalid' };
  const whole = match[1]!.replace(/^0+(?=\d)/, '');
  const fraction = (match[2] ?? '').replace(/0+$/, '');
  if (fraction.length > QUANTITY_DECIMALS) return { ok: false, issue: 'too_many_decimals' };
  if (fraction && !options.allowFraction) return { ok: false, issue: 'fraction_not_allowed' };
  if (Number(whole) > MAX_QUANTITY) return { ok: false, issue: 'too_large' };
  return { ok: true, value: fraction ? `${whole}.${fraction}` : whole };
}
