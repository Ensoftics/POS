import { refineLanguages, tenantSettingsFieldsSchema, type TenantSettings } from '@pos/contracts';
import { CURRENCIES, CURRENCY_CODES, isValidTimeZone } from '@pos/domain';
import { INTL_LOCALES, isSupportedLanguage, SUPPORTED_LANGUAGES } from '@pos/i18n';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';
import { CheckboxGroup, SelectField } from '../../components/ui';
import { useSettingsForm } from '../../lib/settings';
import { SettingsForm } from './SettingsForm';
import { useSettingsContext } from './SettingsLayout';

const schema = z
  .object({
    currency: tenantSettingsFieldsSchema.shape.currency.unwrap(),
    timezone: tenantSettingsFieldsSchema.shape.timezone.unwrap(),
    defaultLanguage: tenantSettingsFieldsSchema.shape.defaultLanguage.unwrap(),
    enabledLanguages: tenantSettingsFieldsSchema.shape.enabledLanguages.unwrap(),
  })
  .superRefine(refineLanguages);

const toValues = (s: TenantSettings) => ({
  currency: s.currency,
  timezone: s.timezone,
  defaultLanguage: s.defaultLanguage,
  enabledLanguages: s.enabledLanguages,
});

const FALLBACK_ZONES = [
  'Asia/Colombo',
  'Asia/Kolkata',
  'Asia/Dubai',
  'Asia/Singapore',
  'Europe/London',
  'UTC',
];

function timeZones(current: string): string[] {
  const zones =
    typeof Intl.supportedValuesOf === 'function'
      ? Intl.supportedValuesOf('timeZone')
      : FALLBACK_ZONES;
  return zones.includes(current) ? zones : [current, ...zones];
}

export function LocalizationSettingsPage() {
  const { t, i18n } = useTranslation();
  const settings = useSettingsContext();
  const { form, onSubmit, feedback, canEdit, saving } = useSettingsForm({
    schema,
    settings,
    toValues,
  });
  const { errors } = form.formState;
  const locale = isSupportedLanguage(i18n.resolvedLanguage)
    ? INTL_LOCALES[i18n.resolvedLanguage]
    : 'en-LK';

  const currency = form.watch('currency');
  const timezone = form.watch('timezone');
  const zones = useMemo(() => timeZones(settings.timezone), [settings.timezone]);

  const currencyExample = new Intl.NumberFormat(locale, { style: 'currency', currency }).format(
    1234.5,
  );
  const timeExample = isValidTimeZone(timezone)
    ? new Intl.DateTimeFormat(locale, { timeStyle: 'short', timeZone: timezone }).format(new Date())
    : '—';
  const languageOptions = SUPPORTED_LANGUAGES.map((language) => ({
    value: language,
    label: t(`language.${language}`, { lng: 'en' }),
  }));

  return (
    <SettingsForm onSubmit={onSubmit} canEdit={canEdit} saving={saving} feedback={feedback}>
      <div className="grid gap-5 md:grid-cols-2">
        <SelectField
          label={t('settings.localization.currency')}
          hint={t('settings.localization.currencyHint', { example: currencyExample })}
          error={errors.currency?.message}
          options={CURRENCY_CODES.map((code) => ({
            value: code,
            label: `${code} — ${CURRENCIES[code].name}`,
          }))}
          {...form.register('currency')}
        />
        <SelectField
          label={t('settings.localization.timezone')}
          hint={t('settings.localization.timezoneHint', { time: timeExample })}
          error={errors.timezone?.message}
          options={zones.map((zone) => ({ value: zone, label: zone.replaceAll('_', ' ') }))}
          {...form.register('timezone')}
        />
        <SelectField
          label={t('settings.localization.defaultLanguage')}
          hint={t('settings.localization.defaultLanguageHint')}
          error={errors.defaultLanguage?.message}
          options={languageOptions}
          {...form.register('defaultLanguage')}
        />
      </div>
      <CheckboxGroup
        legend={t('settings.localization.enabledLanguages')}
        error={errors.enabledLanguages?.message}
        options={languageOptions}
        inputProps={form.register('enabledLanguages')}
      />
    </SettingsForm>
  );
}
