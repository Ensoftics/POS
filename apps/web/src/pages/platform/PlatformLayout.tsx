import { isApiError } from '@pos/api-client';
import { INTL_LOCALES, isSupportedLanguage } from '@pos/i18n';
import { LogOut, ShieldCheck } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Navigate, NavLink, Outlet, useLocation } from 'react-router';
import { Button } from '../../components/ui';
import { platformApi, platformStore, usePlatformSession } from '../../lib/platform';

/** Field errors from a validation response, keyed by field path. */
export function fieldErrors(error: unknown): Record<string, string> {
  if (!isApiError(error)) return {};
  return Object.fromEntries(error.issues.map((issue) => [issue.path, issue.message]));
}

export function usePlatformFormat() {
  const { i18n } = useTranslation();
  const locale = isSupportedLanguage(i18n.resolvedLanguage)
    ? INTL_LOCALES[i18n.resolvedLanguage]
    : 'en-LK';
  return {
    date: (iso: string | null) =>
      iso ? new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(new Date(iso)) : '—',
    dateTime: (iso: string) =>
      new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(
        new Date(iso),
      ),
    money: (minor: number, currency = 'LKR') =>
      new Intl.NumberFormat(locale, { style: 'currency', currency }).format(minor / 100),
  };
}

const NAV = [
  { to: '/platform', key: 'overview', end: true },
  { to: '/platform/tenants', key: 'tenants', end: false },
  { to: '/platform/plans', key: 'plans', end: false },
  { to: '/platform/flags', key: 'flags', end: false },
  { to: '/platform/audit', key: 'audit', end: false },
] as const;

/** Shell of the platform console; signed-out visitors go to its own sign-in page. */
export function PlatformLayout() {
  const { t } = useTranslation();
  const { session } = usePlatformSession();
  const location = useLocation();
  const [signingOut, setSigningOut] = useState(false);
  if (!session)
    return <Navigate to="/platform/login" replace state={{ from: location.pathname }} />;

  const signOut = async () => {
    setSigningOut(true);
    await platformApi.logout().catch(() => undefined);
    platformStore.clear();
  };

  return (
    <div className="min-h-dvh bg-neutral-50">
      <header className="border-b border-neutral-800 bg-neutral-900 text-white">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
          <div className="flex items-center gap-2 font-semibold">
            <ShieldCheck aria-hidden className="size-5" />
            {t('platform.name')}
          </div>
          <nav aria-label={t('platform.name')} className="flex flex-wrap gap-1">
            {NAV.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={({ isActive }) =>
                  `flex min-h-10 items-center rounded-md px-3 text-sm font-medium ${isActive ? 'bg-white/15' : 'text-neutral-300 hover:bg-white/10'}`
                }
              >
                {t(`platform.nav.${item.key}`)}
              </NavLink>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-3 text-sm">
            <span className="hidden text-neutral-300 sm:inline">{session.user.email}</span>
            <Button variant="secondary" onClick={() => void signOut()} loading={signingOut}>
              <LogOut aria-hidden className="size-4" />
              {t('platform.nav.signOut')}
            </Button>
          </div>
        </div>
      </header>
      <main id="main" className="mx-auto max-w-7xl px-4 py-8">
        <Outlet />
      </main>
    </div>
  );
}
