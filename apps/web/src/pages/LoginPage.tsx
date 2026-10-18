import { zodResolver } from '@hookform/resolvers/zod';
import { isTenantSelection, loginRequestSchema, type MembershipSummary } from '@pos/contracts';
import { Building2 } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { Link, useLocation, useNavigate } from 'react-router';
import type { z } from 'zod';
import { AuthLayout } from '../components/AuthLayout';
import { Alert, Button, PasswordField, TextField } from '../components/ui';
import { api } from '../lib/api';
import { type AnonymousReason, authStore } from '../lib/auth-store';
import { applyServerIssues, errorMessage } from '../lib/errors';

const formSchema = loginRequestSchema.pick({ email: true, password: true });
type FormInput = z.input<typeof formSchema>;
type FormOutput = z.output<typeof formSchema>;

interface LocationState {
  from?: string;
  reason?: AnonymousReason;
}

export function LoginPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const state = (useLocation().state ?? {}) as LocationState;
  const [formError, setFormError] = useState<string | null>(null);
  const [choices, setChoices] = useState<MembershipSummary[] | null>(null);
  const [pendingTenant, setPendingTenant] = useState<string | null>(null);

  const form = useForm<FormInput, unknown, FormOutput>({ resolver: zodResolver(formSchema) });
  const { errors, isSubmitting } = form.formState;

  async function signIn(values: FormOutput, tenantId?: string) {
    setFormError(null);
    try {
      const result = await api.auth.login({ ...values, tenantId });
      if (isTenantSelection(result)) {
        setChoices(result.tenants);
        return;
      }
      authStore.applySession(result);
      const destination = state.from && state.from !== '/login' ? state.from : '/';
      navigate(destination, { replace: true });
    } catch (error) {
      if (!applyServerIssues(error, form.setError, ['email', 'password']))
        setFormError(errorMessage(t, error));
    }
  }

  const chooseTenant = async (tenantId: string) => {
    setPendingTenant(tenantId);
    await signIn(form.getValues() as FormOutput, tenantId);
    setPendingTenant(null);
  };

  if (choices) {
    return (
      <AuthLayout
        title={t('auth.login.chooseBusiness')}
        subtitle={t('auth.login.chooseBusinessHint')}
      >
        {formError && (
          <div className="mb-4">
            <Alert tone="danger">{formError}</Alert>
          </div>
        )}
        <ul className="space-y-2">
          {choices.map((choice) => (
            <li key={choice.tenantId}>
              <Button
                variant="secondary"
                block
                className="justify-start py-3 text-left"
                loading={pendingTenant === choice.tenantId}
                disabled={pendingTenant !== null}
                onClick={() => void chooseTenant(choice.tenantId)}
              >
                <Building2 aria-hidden className="size-5 text-brand-700" />
                <span className="flex flex-col">
                  <span>{choice.tenantName}</span>
                  <span className="text-xs font-normal text-neutral-600">
                    {t(`roles.${choice.role}`)}
                  </span>
                </span>
              </Button>
            </li>
          ))}
        </ul>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout title={t('auth.login.title')} subtitle={t('auth.login.subtitle')}>
      <form
        noValidate
        onSubmit={form.handleSubmit((values) => signIn(values))}
        className="space-y-5"
      >
        {state.reason === 'expired' && <Alert tone="warning">{t('auth.login.sessionEnded')}</Alert>}
        {state.reason === 'password_reset' && (
          <Alert tone="success">{t('auth.login.passwordReset')}</Alert>
        )}
        {formError && <Alert tone="danger">{formError}</Alert>}
        <TextField
          label={t('auth.login.email')}
          type="email"
          autoComplete="username"
          inputMode="email"
          autoFocus
          error={errors.email?.message}
          {...form.register('email')}
        />
        <PasswordField
          label={t('auth.login.password')}
          autoComplete="current-password"
          error={errors.password?.message}
          {...form.register('password')}
        />
        <div className="flex justify-end">
          <Link
            to="/forgot-password"
            className="text-sm font-medium text-brand-700 hover:underline"
          >
            {t('auth.login.forgot')}
          </Link>
        </div>
        <Button type="submit" block loading={isSubmitting}>
          {t('auth.login.submit')}
        </Button>
        <p className="text-center text-sm text-neutral-600">
          {t('auth.login.noAccount')}{' '}
          <Link to="/register" className="font-medium text-brand-700 hover:underline">
            {t('auth.login.register')}
          </Link>
        </p>
      </form>
    </AuthLayout>
  );
}
