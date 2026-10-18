import { isSupportedLanguage, resources } from '@pos/i18n';
import { getLocales } from 'expo-localization';
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

/**
 * Shared translations from @pos/i18n (the same keys as the web app). Sinhala and
 * Tamil are drafts pending native-speaker review; missing keys fall back to English.
 */
const deviceLanguage = getLocales()[0]?.languageCode;

void i18n.use(initReactI18next).init({
  resources,
  lng: isSupportedLanguage(deviceLanguage) ? deviceLanguage : 'en',
  fallbackLng: 'en',
  interpolation: { escapeValue: false },
});

export default i18n;
