import { useTranslation } from 'react-i18next';
import { Navigate, Outlet, useLocation } from 'react-router';
import { useAuth } from '../lib/auth-store';
import { Spinner } from './ui';

function FullPageSpinner() {
  const { t } = useTranslation();
  return (
    <div className="flex min-h-dvh items-center justify-center">
      <Spinner label={t('common.loading')} />
    </div>
  );
}

/** Requires a session; sends owners with an unfinished profile to onboarding. */
export function RequireAuth() {
  const auth = useAuth();
  const location = useLocation();

  if (auth.status === 'loading') return <FullPageSpinner />;
  if (auth.status === 'anonymous') {
    return (
      <Navigate to="/login" replace state={{ from: location.pathname, reason: auth.reason }} />
    );
  }

  const { tenant, permissions } = auth.context;
  const mustOnboard =
    tenant.onboardingStatus === 'PENDING' && permissions.includes('tenant.onboarding.complete');
  if (mustOnboard && location.pathname !== '/onboarding')
    return <Navigate to="/onboarding" replace />;
  return <Outlet />;
}

/** Sign-in pages: redirect away when already signed in. */
export function PublicOnly() {
  const auth = useAuth();
  if (auth.status === 'loading') return <FullPageSpinner />;
  if (auth.status === 'authenticated') return <Navigate to="/" replace />;
  return <Outlet />;
}
