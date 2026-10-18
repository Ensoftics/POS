import {
  isSupportedLanguage,
  resources,
  SUPPORTED_LANGUAGES,
  type SupportedLanguage,
} from '@pos/i18n';
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

export { SUPPORTED_LANGUAGES };
export type Language = SupportedLanguage;

const STORAGE_KEY = 'pos.language';

/** The language this browser's user explicitly chose, if any. */
function storedLanguage(): Language | null {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return isSupportedLanguage(stored) ? stored : null;
  } catch {
    // Storage can be unavailable (private mode).
    return null;
  }
}

void i18n.use(initReactI18next).init({
  resources,
  lng: storedLanguage() ?? 'en',
  fallbackLng: 'en',
  supportedLngs: SUPPORTED_LANGUAGES,
  interpolation: { escapeValue: false }, // React escapes output.
  returnNull: false,
});

function applyDocumentLanguage(language: string) {
  document.documentElement.lang = language;
}
applyDocumentLanguage(i18n.language);

/** Explicit user choice: applied and remembered on this device. */
export async function changeLanguage(language: Language): Promise<void> {
  await i18n.changeLanguage(language);
  applyDocumentLanguage(language);
  try {
    localStorage.setItem(STORAGE_KEY, language);
  } catch {
    // Non-fatal.
  }
}

/**
 * Business default from settings: applied only when the user has not chosen a
 * language on this device, and never stored as their choice.
 */
export async function applyBusinessDefaultLanguage(language: Language): Promise<void> {
  if (storedLanguage() || i18n.language === language) return;
  await i18n.changeLanguage(language);
  applyDocumentLanguage(language);
}

export default i18n;
