/**
 * Barcodes are stored exactly as scanned. Numeric codes of GTIN lengths
 * (EAN-8, UPC-A, EAN-13, GTIN-14) must carry a valid check digit, which catches
 * most typing mistakes; anything else is treated as an internal Code 128 value.
 */
export const BARCODE_PATTERN = /^[A-Za-z0-9\-.$/+%]{3,48}$/;
const GTIN_LENGTHS = new Set([8, 12, 13, 14]);

export type BarcodeIssue = 'invalid' | 'checksum';

export function normaliseBarcode(value: string): string {
  return value.trim();
}

export function gtinCheckDigitValid(code: string): boolean {
  const digits = [...code].map(Number);
  const check = digits.pop()!;
  // Weights alternate 3,1,... starting from the digit next to the check digit.
  const sum = digits
    .reverse()
    .reduce((total, digit, index) => total + digit * (index % 2 === 0 ? 3 : 1), 0);
  return (10 - (sum % 10)) % 10 === check;
}

export function checkBarcode(value: string): BarcodeIssue | null {
  if (!BARCODE_PATTERN.test(value)) return 'invalid';
  if (/^\d+$/.test(value) && GTIN_LENGTHS.has(value.length) && !gtinCheckDigitValid(value)) {
    return 'checksum';
  }
  return null;
}
