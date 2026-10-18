export const LANGUAGES = ['en', 'si', 'ta'] as const;
export type Language = (typeof LANGUAGES)[number];

export const DEFAULT_TIMEZONE = 'Asia/Colombo';
export const DEFAULT_COUNTRY = 'LK';

/**
 * True when the runtime recognises the IANA timezone. Uses Intl so the server
 * and clients agree without shipping a timezone database.
 */
export function isValidTimeZone(timeZone: string): boolean {
  if (!/^[A-Za-z_]+(?:\/[A-Za-z0-9_+-]+)*$/.test(timeZone)) return false;
  try {
    new Intl.DateTimeFormat('en', { timeZone }).format(0);
    return true;
  } catch {
    return false;
  }
}
