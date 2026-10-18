import { zodResolver } from '@hookform/resolvers/zod';
import { newPasswordSchema } from '@pos/contracts';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router';
import { z } from 'zod';
import { AuthLayout } from '../components/AuthLayout';
import { Alert, Button, PasswordField } from '../components/ui';
import { api } from '../lib/api';
import { authStore } from '../lib/auth-store';
import { applyServerIssues, errorMessage } from '../lib/errors';

const formSchema = z
  .object({
    password: newPasswordSchema,
    confirm: z.string().min(1, { error: 'validation.required' }),
  })
  .refine((value) => value.password === value.confirm, {
    path: ['confirm'],
    message: 'auth.reset.mismatch',
  });
type FormValues = z.infer<typeof formSchema>;

/** Reads the token once and strips it from the address bar so it does not linger in history. */
function useResetToken(): string | null {
  const [token] = useState(() => {
    const value = new URLSearchParams(window.location.search).get('token');
    if (value) window.history.replaceState(window.history.state, '', window.location.pathname);
    return value;
  });
  return token;
}

export function ResetPasswordPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const token = useResetToken();
  const [formError, setFormError] = useState<string | null>(null);
  const form = useForm<FormValues>({ resolver: zodResolver(formSchema) });
  const { errors, isSubmitting } = form.formState;

  const onSubmit = form.handleSubmit(async ({ password }) => {
    if (!token) return;
    setFormError(null);
    try {
      await api.auth.resetPassword({ token, password });
      // The server revoked every session, including this browser's.
      authStore.clear('password_reset');
      navigate('/login', { replace: true, state: { reason: 'password_reset' } });
    } catch (error) {
      if (!applyServerIssues(error, form.setError, ['password']))
        setFormError(errorMessage(t, error));
    }
  });

  if (!token) {
    return (
      <AuthLayout title={t('auth.reset.title')}>
        <div className="space-y-5">
          <Alert tone="warning">{t('auth.reset.missingToken')}</Alert>
          <Link
            to="/forgot-password"
            className="block text-center text-sm font-medium text-brand-700 hover:underline"
          >
            {t('auth.reset.requestNew')}
          </Link>
        </div>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout title={t('auth.reset.title')} subtitle={t('auth.reset.subtitle')}>
      <form noValidate onSubmit={onSubmit} className="space-y-5">
        {formError && (
          <Alert tone="danger">
            {formError}{' '}
            <Link to="/forgot-password" className="font-semibold underline">
              {t('auth.reset.requestNew')}
            </Link>
          </Alert>
        )}
        <PasswordField
          label={t('auth.reset.password')}
          autoComplete="new-password"
          autoFocus
          hint={t('auth.register.passwordHint')}
          error={errors.password?.message}
          {...form.register('password')}
        />
        <PasswordField
          label={t('auth.reset.confirm')}
          autoComplete="new-password"
          error={errors.confirm?.message}
          {...form.register('confirm')}
        />
        <Button type="submit" block loading={isSubmitting}>
          {t('auth.reset.submit')}
        </Button>
      </form>
    </AuthLayout>
  );
}
