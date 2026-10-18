import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router';
import { AuthLayout } from '../components/AuthLayout';
import { Alert, Button, PasswordField, Skeleton, TextField } from '../components/ui';
import { api } from '../lib/api';
import { authStore } from '../lib/auth-store';
import { applyServerIssues, errorMessage } from '../lib/errors';

type FormValues = { fullName: string; password: string };

/** Reads the token once and strips it from the address bar so it does not linger in history. */
function useInviteToken(): string | null {
  const [token] = useState(() => {
    const value = new URLSearchParams(window.location.search).get('token');
    if (value) window.history.replaceState(window.history.state, '', window.location.pathname);
    return value;
  });
  return token;
}

/**
 * Public page behind the e-mailed invitation link. New people choose a name and
 * password; people who already have an account confirm with its password.
 */
export function AcceptInvitePage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const token = useInviteToken();
  const [formError, setFormError] = useState<string | null>(null);
  const preview = useQuery({
    queryKey: ['invitation', token],
    queryFn: () => api.auth.previewInvitation(token!),
    enabled: !!token,
    retry: false,
    staleTime: Infinity,
  });
  const form = useForm<FormValues>({ defaultValues: { fullName: '', password: '' } });
  const { errors, isSubmitting } = form.formState;

  if (!token || preview.isError) {
    return (
      <AuthLayout title={t('acceptInvite.title', { business: '' }).trim()}>
        <div className="space-y-5">
          <Alert tone="warning">
            {token ? errorMessage(t, preview.error) : t('acceptInvite.missingToken')}
          </Alert>
          <Link
            to="/login"
            className="block text-center text-sm font-medium text-brand-700 hover:underline"
          >
            {t('acceptInvite.signIn')}
          </Link>
        </div>
      </AuthLayout>
    );
  }

  if (preview.isPending) {
    return (
      <AuthLayout title={t('common.loading')}>
        <div className="space-y-4" aria-busy="true" aria-label={t('common.loading')}>
          <Skeleton className="h-11 w-full" />
          <Skeleton className="h-11 w-full" />
        </div>
      </AuthLayout>
    );
  }

  const invitation = preview.data;
  const existing = invitation.existingAccount;

  const onSubmit = form.handleSubmit(async (values) => {
    setFormError(null);
    if (!existing && values.fullName.trim().length === 0) {
      form.setError('fullName', { message: 'validation.required' });
      return;
    }
    if (values.password.length === 0) {
      form.setError('password', { message: 'validation.required' });
      return;
    }
    try {
      const session = await api.auth.acceptInvitation({
        token,
        password: values.password,
        ...(existing ? {} : { fullName: values.fullName.trim() }),
      });
      authStore.applySession(session);
      navigate('/', { replace: true });
    } catch (error) {
      if (!applyServerIssues(error, form.setError, ['fullName', 'password']))
        setFormError(errorMessage(t, error));
    }
  });

  return (
    <AuthLayout
      title={t('acceptInvite.title', { business: invitation.businessName })}
      subtitle={t('acceptInvite.subtitle', { role: t(`roles.${invitation.role}`) })}
    >
      <form noValidate onSubmit={onSubmit} className="space-y-5">
        {formError && <Alert tone="danger">{formError}</Alert>}
        <TextField
          label={t('acceptInvite.email')}
          value={invitation.email}
          readOnly
          autoComplete="username"
        />
        {existing ? (
          <p className="text-sm text-neutral-600">{t('acceptInvite.existingHint')}</p>
        ) : (
          <TextField
            label={t('acceptInvite.fullName')}
            autoComplete="name"
            autoFocus
            error={errors.fullName?.message}
            {...form.register('fullName')}
          />
        )}
        <PasswordField
          label={existing ? t('acceptInvite.existingPassword') : t('acceptInvite.password')}
          autoComplete={existing ? 'current-password' : 'new-password'}
          autoFocus={existing}
          hint={existing ? undefined : t('auth.register.passwordHint')}
          error={errors.password?.message}
          {...form.register('password')}
        />
        <Button type="submit" block loading={isSubmitting}>
          {t('acceptInvite.submit')}
        </Button>
      </form>
    </AuthLayout>
  );
}
