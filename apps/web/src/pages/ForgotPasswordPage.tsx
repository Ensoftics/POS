import { zodResolver } from '@hookform/resolvers/zod';
import { forgotPasswordRequestSchema } from '@pos/contracts';
import { MailCheck } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import type { z } from 'zod';
import { AuthLayout } from '../components/AuthLayout';
import { Alert, Button, TextField } from '../components/ui';
import { api } from '../lib/api';
import { errorMessage } from '../lib/errors';

type FormInput = z.input<typeof forgotPasswordRequestSchema>;
type FormOutput = z.output<typeof forgotPasswordRequestSchema>;

export function ForgotPasswordPage() {
  const { t } = useTranslation();
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const form = useForm<FormInput, unknown, FormOutput>({
    resolver: zodResolver(forgotPasswordRequestSchema),
  });

  const onSubmit = form.handleSubmit(async (values) => {
    setFormError(null);
    try {
      await api.auth.forgotPassword(values);
      setSentTo(values.email);
    } catch (error) {
      setFormError(errorMessage(t, error));
    }
  });

  if (sentTo) {
    return (
      <AuthLayout title={t('auth.forgot.sentTitle')}>
        <div className="space-y-6">
          <div className="flex items-start gap-3 text-neutral-700">
            <MailCheck aria-hidden className="mt-0.5 size-6 shrink-0 text-brand-700" />
            <p role="status">{t('auth.forgot.sent', { email: sentTo })}</p>
          </div>
          <Link
            to="/login"
            className="block text-center text-sm font-medium text-brand-700 hover:underline"
          >
            {t('auth.forgot.backToLogin')}
          </Link>
        </div>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout title={t('auth.forgot.title')} subtitle={t('auth.forgot.subtitle')}>
      <form noValidate onSubmit={onSubmit} className="space-y-5">
        {formError && <Alert tone="danger">{formError}</Alert>}
        <TextField
          label={t('auth.login.email')}
          type="email"
          inputMode="email"
          autoComplete="email"
          autoFocus
          error={form.formState.errors.email?.message}
          {...form.register('email')}
        />
        <Button type="submit" block loading={form.formState.isSubmitting}>
          {t('auth.forgot.submit')}
        </Button>
        <Link
          to="/login"
          className="block text-center text-sm font-medium text-brand-700 hover:underline"
        >
          {t('auth.forgot.backToLogin')}
        </Link>
      </form>
    </AuthLayout>
  );
}
