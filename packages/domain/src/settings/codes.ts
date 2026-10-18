/**
 * Short identifiers for branches and registers (printed on receipts and used in
 * receipt numbers, e.g. COL-01-000123). Upper-case letters, digits and dashes.
 */
export const LOCATION_CODE_PATTERN = /^[A-Z0-9](?:[A-Z0-9-]{0,10}[A-Z0-9])?$/;

export function normaliseLocationCode(value: string): string {
  return value.trim().toUpperCase().replace(/\s+/g, '-');
}

export const MAIN_BRANCH_CODE = 'MAIN';
export const FIRST_REGISTER_CODE = 'R1';
