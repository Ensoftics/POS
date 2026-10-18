import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { AuthLayout } from '../components/AuthLayout';
import { Alert, Spinner } from '../components/ui';
import { api } from '../lib/api';
import { authStore, useAuth } from '../lib/auth-store';
import { errorMessage } from '../lib/errors';

/** Reads the token once and strips it from the address bar so it does not linger in history. */
function useVerifyToken(): string | null {
  const [token] = useState(() => {
    const value = new URLSearchParams(window.location.search).get('token');
    if (value) window.history.replaceState(window.history.state, '', window.location.pathname);
    return value;
  });
  return token;
}

/** Public page behind the e-mailed confirmation link; works signed in or out. */
export function VerifyEmailPage() {
  const { t } = useTranslation();
  const auth = useAuth();
  const token = useVerifyToken();
  const started = useRef(false);
  const [state, setState] = useState<
    { status: 'working' } | { status: 'done' } | { status: 'error'; message: string }
  >({ status: 'working' });

  useEffect(() => {
    if (!token || started.current) return;
    started.current = true;
    api.auth
      .verifyEmail(token)
      .then(() => {
        setState({ status: 'done' });
        // The session may still be loading (and could come back with the old state):
        // refresh the context now if signed in, or as soon as the session is ready.
        const refresh = () => {
          if (authStore.getState().status !== 'authenticated') return false;
          void api.auth.me().then((context) => authStore.updateContext(context));
          return true;
        };
        if (!refresh()) {
          const unsubscribe = authStore.subscribe(() => {
            if (refresh()) unsubscribe();
          });
        }
      })
      .catch((error: unknown) => setState({ status: 'error', message: errorMessage(t, error) }));
  }, [token, t]);

  const next = auth.status === 'authenticated' ? '/' : '/login';
  return (
    <AuthLayout title={t('verifyEmail.title')}>
      <div className="space-y-5">
        {!token ? (
          <Alert tone="warning">{t('verifyEmail.missingToken')}</Alert>
        ) : state.status === 'working' ? (
          <Spinner label={t('verifyEmail.verifying')} />
        ) : state.status === 'done' ? (
          <Alert tone="success">{t('verifyEmail.done')}</Alert>
        ) : (
          <Alert tone="danger">{state.message}</Alert>
        )}
        {state.status !== 'working' || !token ? (
          <Link
            to={next}
            className="block text-center text-sm font-medium text-brand-700 hover:underline"
          >
            {t('verifyEmail.continue')}
          </Link>
        ) : null}
      </div>
    </AuthLayout>
  );
}
