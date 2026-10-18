import { tenantSettingsFieldsSchema, type TenantSettings } from '@pos/contracts';
import { useTranslation } from 'react-i18next';
import { TextField } from '../../components/ui';
import { useSettingsForm } from '../../lib/settings';
import { SettingsForm } from './SettingsForm';
import { useSettingsContext } from './SettingsLayout';

const schema = tenantSettingsFieldsSchema.pick({
  legalName: true,
  taxRegistrationNumber: true,
  addressLine1: true,
  addressLine2: true,
  city: true,
  postalCode: true,
  country: true,
});

const toValues = (s: TenantSettings) => ({
  legalName: s.legalName ?? '',
  taxRegistrationNumber: s.taxRegistrationNumber ?? '',
  addressLine1: s.addressLine1 ?? '',
  addressLine2: s.addressLine2 ?? '',
  city: s.city ?? '',
  postalCode: s.postalCode ?? '',
  country: s.country,
});

export function BusinessSettingsPage() {
  const { t } = useTranslation();
  const settings = useSettingsContext();
  const { form, onSubmit, feedback, canEdit, saving } = useSettingsForm({
    schema,
    settings,
    toValues,
  });
  const { errors } = form.formState;

  return (
    <SettingsForm onSubmit={onSubmit} canEdit={canEdit} saving={saving} feedback={feedback}>
      <TextField
        label={t('settings.business.legalName')}
        hint={t('settings.business.legalNameHint')}
        optional
        autoComplete="organization"
        error={errors.legalName?.message}
        {...form.register('legalName')}
      />
      <TextField
        label={t('settings.business.taxRegistrationNumber')}
        optional
        error={errors.taxRegistrationNumber?.message}
        {...form.register('taxRegistrationNumber')}
      />
      <div className="grid gap-5 md:grid-cols-2">
        <TextField
          label={t('settings.business.addressLine1')}
          optional
          autoComplete="address-line1"
          error={errors.addressLine1?.message}
          {...form.register('addressLine1')}
        />
        <TextField
          label={t('settings.business.addressLine2')}
          optional
          autoComplete="address-line2"
          error={errors.addressLine2?.message}
          {...form.register('addressLine2')}
        />
        <TextField
          label={t('settings.business.city')}
          optional
          autoComplete="address-level2"
          error={errors.city?.message}
          {...form.register('city')}
        />
        <TextField
          label={t('settings.business.postalCode')}
          optional
          autoComplete="postal-code"
          error={errors.postalCode?.message}
          {...form.register('postalCode')}
        />
        <TextField
          label={t('settings.business.country')}
          hint={t('settings.business.countryHint')}
          autoComplete="country"
          maxLength={2}
          className="uppercase"
          error={errors.country?.message}
          {...form.register('country')}
        />
      </div>
    </SettingsForm>
  );
}
