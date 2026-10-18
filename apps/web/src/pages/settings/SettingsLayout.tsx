import type { TenantSettings } from '@pos/contracts';
import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { NavLink, Outlet, useLocation, useOutletContext } from 'react-router';
import { Alert, Button, Card, Skeleton } from '../../components/ui';
import { useAuthContext } from '../../lib/auth-store';
import { errorMessage } from '../../lib/errors';
import { useSettings } from '../../lib/settings';

const TABS = [
  { to: '/settings/business', key: 'business' },
  { to: '/settings/localization', key: 'localization' },
  { to: '/settings/profile', key: 'profile' },
  { to: '/settings/locations', key: 'locations' },
  { to: '/settings/checkout', key: 'checkout' },
  { to: '/settings/staff', key: 'staff', permission: 'staff.manage' },
  { to: '/settings/devices', key: 'devices', permission: 'staff.manage' },
  { to: '/settings/billing', key: 'billing', permission: 'billing.manage' },
] as const;

export function useSettingsContext(): TenantSettings {
  return useOutletContext<TenantSettings>();
}

export function SettingsLayout() {
  const { t } = useTranslation();
  const settings = useSettings();
  const { permissions } = useAuthContext();
  const { pathname } = useLocation();
  const tabs = TABS.filter((tab) => !('permission' in tab) || permissions.includes(tab.permission));
  const tabsRef = useRef<HTMLElement>(null);

  // On narrow screens the tab bar scrolls sideways; keep the current tab visible.
  useEffect(() => {
    const active = tabsRef.current?.querySelector<HTMLElement>('[aria-current="page"]');
    active?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  }, [pathname]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-neutral-900">
          {t('settings.title')}
        </h1>
        <p className="mt-1 text-sm text-neutral-600">{t('settings.subtitle')}</p>
      </div>

      <nav ref={tabsRef} aria-label={t('settings.title')} className="-mx-4 overflow-x-auto px-4">
        <ul className="flex min-w-max gap-1 border-b border-neutral-200">
          {tabs.map((tab) => (
            <li key={tab.to}>
              <NavLink
                to={tab.to}
                className={({ isActive }) =>
                  `-mb-px flex min-h-11 items-center border-b-2 px-3 text-sm font-medium ${
                    isActive
                      ? 'border-brand-700 text-brand-800'
                      : 'border-transparent text-neutral-600 hover:text-neutral-900'
                  }`
                }
              >
                {t(`settings.tabs.${tab.key}`)}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>

      {settings.isPending ? (
        <Card>
          <div className="space-y-4" aria-busy="true" aria-label={t('common.loading')}>
            {Array.from({ length: 4 }, (_, index) => (
              <Skeleton key={index} className="h-11 w-full" />
            ))}
          </div>
        </Card>
      ) : settings.isError ? (
        <Alert
          tone="danger"
          action={
            <Button variant="secondary" onClick={() => void settings.refetch()}>
              {t('common.retry')}
            </Button>
          }
        >
          {errorMessage(t, settings.error)}
        </Alert>
      ) : (
        <Outlet context={settings.data} />
      )}
    </div>
  );
}
