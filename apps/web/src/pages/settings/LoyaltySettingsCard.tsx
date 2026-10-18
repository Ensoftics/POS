import type { TenantSettings } from '@pos/contracts';
import { type CurrencyCode, minorToDecimalString, parseMoney } from '@pos/domain';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';
import { Alert, CheckboxField, TextField } from '../../components/ui';
import { useAuthContext } from '../../lib/auth-store';
import { useSettingsForm } from '../../lib/settings';
import { SettingsForm } from './SettingsForm';

const DEFAULTS = {
  enabled: false,
  spendPerPointMinor: 10_000,
  pointValueMinor: 100,
  minRedeemPoints: 0,
};

function moneyField(currency: CurrencyCode) {
  return z.string().refine(
    (v) => {
      const parsed = parseMoney(v, currency);
      return parsed.ok && parsed.minor > 0;
    },
    { error: 'validation.loyalty.positive' },
  );
}

/** Settings › Taxes & checkout: the loyalty programme's switch and rates. */
export function LoyaltySettingsCard({ settings }: { settings: TenantSettings }) {
  const { t } = useTranslation();
  const { features } = useAuthContext();
  const currency = settings.currency;
  const schema = z.object({
    loyalty: z.object({
      enabled: z.boolean(),
      spend: moneyField(currency),
      value: moneyField(currency),
      minRedeem: z.string().regex(/^\d{1,7}$/, { error: 'validation.loyalty.min_points' }),
    }),
  });
  const { form, onSubmit, feedback, canEdit, saving } = useSettingsForm({
    schema,
    settings,
    toValues: (s) => {
      const loyalty = s.loyalty ?? DEFAULTS;
      return {
        loyalty: {
          enabled: loyalty.enabled,
          spend: minorToDecimalString(loyalty.spendPerPointMinor, s.currency),
          value: minorToDecimalString(loyalty.pointValueMinor, s.currency),
          minRedeem: String(loyalty.minRedeemPoints),
        },
      };
    },
    toRequest: (values) => {
      const minor = (text: string) => {
        const parsed = parseMoney(text, currency);
        return parsed.ok ? parsed.minor : 0;
      };
      return {
        loyalty: {
          enabled: values.loyalty.enabled,
          spendPerPointMinor: minor(values.loyalty.spend),
          pointValueMinor: minor(values.loyalty.value),
          minRedeemPoints: Number(values.loyalty.minRedeem),
        },
      };
    },
  });
  const { errors } = form.formState;

  return (
    <section aria-labelledby="loyalty-heading" className="space-y-3">
      <h2 id="loyalty-heading" className="text-base font-semibold text-neutral-900">
        {t('loyalty.title')}
      </h2>
      <p className="text-sm text-neutral-600">{t('loyalty.intro')}</p>
      {!(features ?? []).includes('loyalty') ? (
        <Alert tone="warning">{t('loyalty.flagOff')}</Alert>
      ) : (
        <SettingsForm onSubmit={onSubmit} canEdit={canEdit} saving={saving} feedback={feedback}>
          <CheckboxField label={t('loyalty.enabled')} {...form.register('loyalty.enabled')} />
          <div className="grid gap-4 md:grid-cols-3">
            <TextField
              label={t('loyalty.spendPerPoint')}
              hint={t('loyalty.spendPerPointHint')}
              inputMode="decimal"
              error={errors.loyalty?.spend?.message}
              {...form.register('loyalty.spend')}
            />
            <TextField
              label={t('loyalty.pointValue')}
              hint={t('loyalty.pointValueHint')}
              inputMode="decimal"
              error={errors.loyalty?.value?.message}
              {...form.register('loyalty.value')}
            />
            <TextField
              label={t('loyalty.minRedeem')}
              inputMode="numeric"
              error={errors.loyalty?.minRedeem?.message}
              {...form.register('loyalty.minRedeem')}
            />
          </div>
        </SettingsForm>
      )}
    </section>
  );
}
