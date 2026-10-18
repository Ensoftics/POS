import { en, type PartialTranslation, type Translation } from './locales/en';
import { si } from './locales/si';
import { ta } from './locales/ta';

export type { PartialTranslation, Translation };

export const SUPPORTED_LANGUAGES = ['en', 'si', 'ta'] as const;
export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number];

/** i18next resources. English is complete; Sinhala and Tamil are drafts that fall back to English. */
export const resources = {
  en: { translation: en },
  si: { translation: si },
  ta: { translation: ta },
} as const;

/** Locale tags for Intl formatting (dates, numbers, currency) in Sri Lanka. */
export const INTL_LOCALES: Record<SupportedLanguage, string> = {
  en: 'en-LK',
  si: 'si-LK',
  ta: 'ta-LK',
};

export function isSupportedLanguage(value: unknown): value is SupportedLanguage {
  return typeof value === 'string' && (SUPPORTED_LANGUAGES as readonly string[]).includes(value);
}

export { en };
