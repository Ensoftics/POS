/**
 * Customer rules shared by the API and clients.
 *
 * A customer's account balance is what they owe the shop in minor units:
 * positive = they owe (sales on account), negative = the shop owes them (store
 * credit from refunds or overpayments).
 */

/** Dialling codes for countries the product is offered in; extend as markets are added. */
const COUNTRY_CODES: Record<string, string> = { LK: '94', IN: '91', MV: '960' };

/**
 * Normalises a phone number to E.164 (+94771234567) so the same customer is found
 * however the number was typed. National numbers starting with 0 are read in the
 * business's country. Returns null when it cannot be a phone number.
 */
export function normalisePhone(input: string, country = 'LK'): string | null {
  const raw = input.trim();
  if (!/^\+?[0-9 ()\-.]{6,24}$/.test(raw)) return null;
  const digits = raw.replace(/\D/g, '');
  let e164: string;
  if (raw.startsWith('+')) e164 = digits;
  else if (raw.startsWith('00')) e164 = digits.slice(2);
  else {
    const code = COUNTRY_CODES[country];
    if (!code) return null;
    if (digits.startsWith('0')) e164 = code + digits.slice(1);
    else if (digits.startsWith(code) && digits.length > code.length + 7) e164 = digits;
    else e164 = code + digits;
  }
  if (e164.length < 8 || e164.length > 15 || e164.startsWith('0')) return null;
  // Sri Lankan numbers have nine digits after the country code.
  if (e164.startsWith('94') && e164.length !== 11) return null;
  return `+${e164}`;
}

/** How much more may be sold on account: limit minus what is owed (store credit adds to it). */
export function availableCredit(creditLimitMinor: number, balanceMinor: number): number {
  return Math.max(0, creditLimitMinor - balanceMinor);
}

export const CUSTOMER_ENTRY_TYPES = ['CHARGE', 'PAYMENT', 'REFUND'] as const;
export type CustomerEntryType = (typeof CUSTOMER_ENTRY_TYPES)[number];

export interface StatementEntry {
  /** Signed: positive increases what the customer owes. */
  amountMinor: number;
}

/** Running balances for a statement, starting from the opening balance. */
export function runningBalances(openingMinor: number, entries: StatementEntry[]): number[] {
  let balance = openingMinor;
  return entries.map((entry) => (balance += entry.amountMinor));
}
