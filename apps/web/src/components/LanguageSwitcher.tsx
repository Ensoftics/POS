import { Languages } from 'lucide-react';
import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import { changeLanguage, type Language, SUPPORTED_LANGUAGES } from '../i18n';

/** `languages` limits the choice to those the business enabled (all languages before sign-in). */
export function LanguageSwitcher({
  languages = SUPPORTED_LANGUAGES,
  onDark = false,
}: {
  languages?: readonly Language[];
  /** Styles for the indigo app shell. */
  onDark?: boolean;
}) {
  const { t, i18n } = useTranslation();
  const id = useId();
  return (
    <div className="flex min-w-0 items-center gap-2">
      <Languages
        aria-hidden
        className={`size-4 shrink-0 ${onDark ? 'text-brand-200' : 'text-neutral-500'}`}
      />
      <label htmlFor={id} className="sr-only">
        {t('language.label')}
      </label>
      <select
        id={id}
        value={i18n.resolvedLanguage ?? 'en'}
        onChange={(event) => void changeLanguage(event.target.value as Language)}
        className={
          onDark
            ? 'min-h-9 w-full min-w-0 rounded-md border border-white/20 bg-brand-900 px-2 text-sm text-white'
            : 'min-h-9 rounded-md border border-neutral-300 bg-white px-2 text-sm'
        }
      >
        {SUPPORTED_LANGUAGES.filter(
          (language) => languages.includes(language) || language === i18n.resolvedLanguage,
        ).map((language) => (
          // Language names are shown in their own script regardless of the current UI language.
          <option key={language} value={language} lang={language}>
            {t(`language.${language}`, { lng: 'en' })}
          </option>
        ))}
      </select>
    </div>
  );
}
