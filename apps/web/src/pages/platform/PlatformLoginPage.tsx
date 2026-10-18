import { isApiError } from '@pos/api-client';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Navigate, useLocation, useNavigate } from 'react-router';
import { AuthLayout } from '../../components/AuthLayout';
import { Alert, Button, PasswordField, TextField } from '../../components/ui';
import { errorMessage } from '../../lib/errors';
import { platformApi, platformStore, usePlatformSession } from '../../lib/platform';
import { fieldErrors } from './PlatformLayout';

export function PlatformLoginPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const { session, ended } = usePlatformSession();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});
  if (session) return <Navigate to="/platform" replace />;

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setFields({});
    try {
      platformStore.set(await platformApi.login({ email, password, code }));
      const from = (location.state as { from?: string } | null)?.from;
      navigate(from?.startsWith('/platform') && from !== '/platform/login' ? from : '/platform', {
        replace: true,
      });
    } catch (err) {
      const issues = fieldErrors(err);
      if (Object.keys(issues).length) setFields(issues);
      else if (isApiError(err) && err.code === 'INVALID_CREDENTIALS')
        setError(t('platform.login.invalid'));
      else setError(errorMessage(t, err));
      setCode('');
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthLayout title={t('platform.login.title')} subtitle={t('platform.login.subtitle')}>
      <form noValidate onSubmit={(e) => void submit(e)} className="space-y-5">
        {ended && !error && <Alert tone="warning">{t('platform.login.ended')}</Alert>}
        {error && <Alert tone="danger">{error}</Alert>}
        <TextField
          label={t('platform.login.email')}
          type="email"
          autoComplete="username"
          autoFocus
          value={email}
          error={fields.email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <PasswordField
          label={t('platform.login.password')}
          autoComplete="current-password"
          value={password}
          error={fields.password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <TextField
          label={t('platform.login.code')}
          hint={t('platform.login.codeHint')}
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={6}
          value={code}
          error={fields.code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
        />
        <Button type="submit" block loading={busy}>
          {t('platform.login.submit')}
        </Button>
      </form>
    </AuthLayout>
  );
}
