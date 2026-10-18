import { zodResolver } from '@hookform/resolvers/zod';
import { registerRequestSchema } from '@pos/contracts';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router';
import type { z } from 'zod';
import { AuthLayout } from '../components/AuthLayout';
import { Alert, Button, CheckboxField, PasswordField, TextField } from '../components/ui';
import { api } from '../lib/api';
import { authStore } from '../lib/auth-store';
import { applyServerIssues, errorMessage } from '../lib/errors';

type FormInput = z.input<typeof registerRequestSchema>;
type FormOutput = z.output<typeof registerRequestSchema>;
const FIELDS = ['businessName', 'ownerFullName', 'email', 'password', 'acceptTerms'] as const;

export function RegisterPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [formError, setFormError] = useState<string | null>(null);
  const form = useForm<FormInput, unknown, FormOutput>({
    resolver: zodResolver(registerRequestSchema),
    defaultValues: { businessName: '', ownerFullName: '', email: '', password: '' },
  });
  const { errors, isSubmitting } = form.formState;

  const onSubmit = form.handleSubmit(async (values) => {
    setFormError(null);
    try {
      const session = await api.auth.register(values);
      authStore.applySession(session);
      navigate('/onboarding', { replace: true });
    } catch (error) {
      if (!applyServerIssues(error, form.setError, FIELDS)) setFormError(errorMessage(t, error));
    }
  });

  return (
    <AuthLayout title={t('auth.register.title')} subtitle={t('auth.register.subtitle')}>
      <form noValidate onSubmit={onSubmit} className="space-y-5">
        {formError && (
          <Alert tone="danger">
            {formError}{' '}
            <Link to="/login" className="font-semibold underline">
              {t('auth.register.signIn')}
            </Link>
          </Alert>
        )}
        <TextField
          label={t('auth.register.businessName')}
          autoComplete="organization"
          autoFocus
          error={errors.businessName?.message}
          {...form.register('businessName')}
        />
        <TextField
          label={t('auth.register.ownerFullName')}
          autoComplete="name"
          error={errors.ownerFullName?.message}
          {...form.register('ownerFullName')}
        />
        <TextField
          label={t('auth.register.email')}
          type="email"
          inputMode="email"
          autoComplete="email"
          error={errors.email?.message}
          {...form.register('email')}
        />
        <PasswordField
          label={t('auth.register.password')}
          autoComplete="new-password"
          hint={t('auth.register.passwordHint')}
          error={errors.password?.message}
          {...form.register('password')}
        />
        <CheckboxField
          label={t('auth.register.acceptTerms')}
          error={errors.acceptTerms?.message}
          {...form.register('acceptTerms')}
        />
        <Button type="submit" block loading={isSubmitting}>
          {t('auth.register.submit')}
        </Button>
        <p className="text-center text-sm text-neutral-600">
          {t('auth.register.haveAccount')}{' '}
          <Link to="/login" className="font-medium text-brand-700 hover:underline">
            {t('auth.register.signIn')}
          </Link>
        </p>
      </form>
    </AuthLayout>
  );
}
