import { businessProfileSchema, type TenantSettings } from '@pos/contracts';
import { BUSINESS_PROFILE_PRESETS, UNIT_CODES, VARIANT_ATTRIBUTES } from '@pos/domain';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';
import { Button, CheckboxField, CheckboxGroup } from '../../components/ui';
import { useAuthContext } from '../../lib/auth-store';
import { useSettingsForm } from '../../lib/settings';
import { SettingsForm } from './SettingsForm';
import { useSettingsContext } from './SettingsLayout';

const schema = z.object({ profile: businessProfileSchema });
const toValues = (s: TenantSettings) => ({ profile: s.profile });

export function ProfileSettingsPage() {
  const { t } = useTranslation();
  const { tenant } = useAuthContext();
  const settings = useSettingsContext();
  const { form, onSubmit, feedback, canEdit, saving } = useSettingsForm({
    schema,
    settings,
    toValues,
  });
  const errors = form.formState.errors.profile;
  const preset = tenant.businessType ? BUSINESS_PROFILE_PRESETS[tenant.businessType] : null;

  const switches = ['trackBatchNumbers', 'trackExpiryDates', 'allowFractionalQuantities'] as const;

  return (
    <SettingsForm onSubmit={onSubmit} canEdit={canEdit} saving={saving} feedback={feedback}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <p className="text-sm text-neutral-600">{t('settings.profile.intro')}</p>
        {preset && tenant.businessType && (
          <Button
            variant="secondary"
            onClick={() => form.reset({ profile: preset }, { keepDefaultValues: true })}
          >
            {t('settings.profile.applyPreset', {
              type: t(`businessTypes.${tenant.businessType}.label`),
            })}
          </Button>
        )}
      </div>

      <div className="space-y-4">
        {switches.map((name) => (
          <div key={name}>
            <CheckboxField
              label={t(`settings.profile.${name}`)}
              {...form.register(`profile.${name}`)}
            />
            <p className="ml-8 text-xs text-neutral-600">{t(`settings.profile.${name}Hint`)}</p>
          </div>
        ))}
      </div>

      <CheckboxGroup
        legend={t('settings.profile.variantAttributes')}
        hint={t('settings.profile.variantAttributesHint')}
        error={errors?.variantAttributes?.message}
        options={VARIANT_ATTRIBUTES.map((value) => ({
          value,
          label: t(`settings.profile.attributes.${value}`),
        }))}
        inputProps={form.register('profile.variantAttributes')}
      />
      <CheckboxGroup
        legend={t('settings.profile.defaultUnits')}
        hint={t('settings.profile.defaultUnitsHint')}
        error={errors?.defaultUnits?.message}
        options={UNIT_CODES.map((value) => ({
          value,
          label: t(`settings.profile.units.${value}`),
        }))}
        inputProps={form.register('profile.defaultUnits')}
      />
    </SettingsForm>
  );
}
