import { zodResolver } from '@hookform/resolvers/zod';
import { completeOnboardingRequestSchema } from '@pos/contracts';
import { BUSINESS_TYPES } from '@pos/domain';
import { Scissors, ShoppingBasket, Sparkles } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { Navigate, useNavigate } from 'react-router';
import { z } from 'zod';
import { AuthLayout } from '../components/AuthLayout';
import { Alert, Button, TextField } from '../components/ui';
import { api, signOut } from '../lib/api';
import { authStore, useAuthContext } from '../lib/auth-store';
import { applyServerIssues, errorMessage } from '../lib/errors';

const ICONS = { COSMETICS: Sparkles, TEXTILE: Scissors, GENERAL_RETAIL: ShoppingBasket } as const;

// An empty phone input means "not provided".
const formSchema = completeOnboardingRequestSchema.extend({
  contactPhone: z.preprocess(
    (value) => (value === '' ? undefined : value),
    completeOnboardingRequestSchema.shape.contactPhone,
  ),
});
type FormInput = z.input<typeof formSchema>;
type FormOutput = z.output<typeof formSchema>;

export function OnboardingPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { tenant, permissions } = useAuthContext();
  const [formError, setFormError] = useState<string | null>(null);
  const form = useForm<FormInput, unknown, FormOutput>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      businessName: tenant.name,
      businessType: tenant.businessType ?? undefined,
      contactPhone: tenant.contactPhone ?? '',
    },
  });
  const { errors, isSubmitting } = form.formState;
  const selectedType = form.watch('businessType');

  if (!permissions.includes('tenant.onboarding.complete')) {
    if (tenant.onboardingStatus === 'COMPLETED') return <Navigate to="/" replace />;
    return (
      <AuthLayout title={t('onboarding.title')}>
        <div className="space-y-5">
          <Alert tone="info">{t('onboarding.notOwner')}</Alert>
          <Button variant="secondary" block onClick={() => void signOut()}>
            {t('common.signOut')}
          </Button>
        </div>
      </AuthLayout>
    );
  }

  const onSubmit = form.handleSubmit(async (values) => {
    setFormError(null);
    try {
      authStore.updateTenant(await api.tenant.completeOnboarding(values));
      navigate('/', { replace: true });
    } catch (error) {
      if (
        !applyServerIssues(error, form.setError, ['businessName', 'businessType', 'contactPhone'])
      ) {
        setFormError(errorMessage(t, error));
      }
    }
  });

  return (
    <AuthLayout title={t('onboarding.title')} subtitle={t('onboarding.subtitle')}>
      <form noValidate onSubmit={onSubmit} className="space-y-6">
        {formError && <Alert tone="danger">{formError}</Alert>}
        <TextField
          label={t('onboarding.businessName')}
          autoComplete="organization"
          error={errors.businessName?.message}
          {...form.register('businessName')}
        />

        <fieldset aria-describedby={errors.businessType ? 'business-type-error' : undefined}>
          <legend className="mb-2 text-sm font-medium text-neutral-800">
            {t('onboarding.businessType')}
          </legend>
          <div className="space-y-2">
            {BUSINESS_TYPES.map((type) => {
              const Icon = ICONS[type];
              const checked = selectedType === type;
              return (
                <label
                  key={type}
                  className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-brand-600 ${checked ? 'border-brand-600 bg-brand-50' : 'border-neutral-300 hover:bg-neutral-50'}`}
                >
                  <input
                    type="radio"
                    value={type}
                    className="sr-only"
                    {...form.register('businessType')}
                  />
                  <Icon
                    aria-hidden
                    className={`mt-0.5 size-5 shrink-0 ${checked ? 'text-brand-700' : 'text-neutral-500'}`}
                  />
                  <span>
                    <span className="block text-sm font-semibold text-neutral-900">
                      {t(`businessTypes.${type}.label`)}
                    </span>
                    <span className="block text-xs text-neutral-600">
                      {t(`businessTypes.${type}.description`)}
                    </span>
                  </span>
                </label>
              );
            })}
          </div>
          {errors.businessType?.message && (
            <p id="business-type-error" className="mt-1.5 text-sm text-danger-700">
              {t(errors.businessType.message)}
            </p>
          )}
        </fieldset>

        <TextField
          label={t('onboarding.contactPhone')}
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          optional
          hint={t('onboarding.contactPhoneHint')}
          error={errors.contactPhone?.message}
          {...form.register('contactPhone')}
        />
        <Button type="submit" block loading={isSubmitting}>
          {t('onboarding.submit')}
        </Button>
      </form>
    </AuthLayout>
  );
}
