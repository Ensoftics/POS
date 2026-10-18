import {
  BarChart3,
  Boxes,
  LayoutDashboard,
  LogOut,
  Menu,
  Package,
  Receipt,
  ScrollText,
  Settings,
  ShoppingCart,
  Store,
  Truck,
  Users,
  X,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { NavLink, Outlet } from 'react-router';
import { signOut } from '../lib/api';
import { applyBusinessDefaultLanguage } from '../i18n';
import { useAuthContext } from '../lib/auth-store';
import { useSettings } from '../lib/settings';
import { AccountBanners } from './AccountBanners';
import { NotificationBell } from './NotificationBell';
import { LanguageSwitcher } from './LanguageSwitcher';
import { Button } from './ui';

export function AppShell() {
  const { t } = useTranslation();
  const { user, tenant, role, permissions } = useAuthContext();
  const [menuOpen, setMenuOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const settings = useSettings();
  const defaultLanguage = settings.data?.defaultLanguage;
  const enabledLanguages = settings.data?.enabledLanguages;

  useEffect(() => {
    if (defaultLanguage) void applyBusinessDefaultLanguage(defaultLanguage);
  }, [defaultLanguage]);

  const links = [
    { to: '/', label: t('nav.dashboard'), icon: LayoutDashboard, visible: true },
    {
      to: '/pos',
      label: t('nav.sell'),
      icon: ShoppingCart,
      visible: permissions.includes('sales.create'),
    },
    {
      to: '/sales',
      label: t('nav.sales'),
      icon: Receipt,
      visible: permissions.includes('sales.read'),
    },
    {
      to: '/customers',
      label: t('nav.customers'),
      icon: Users,
      visible: permissions.includes('customers.read'),
    },
    {
      to: '/products',
      label: t('nav.products'),
      icon: Package,
      visible: permissions.includes('products.read'),
    },
    {
      to: '/inventory',
      label: t('nav.inventory'),
      icon: Boxes,
      visible: permissions.includes('inventory.read'),
    },
    {
      to: '/purchasing/orders',
      label: t('nav.purchasing'),
      icon: Truck,
      visible: permissions.includes('purchasing.manage'),
    },
    {
      to: '/reports',
      label: t('nav.reports'),
      icon: BarChart3,
      visible: permissions.includes('reports.view'),
    },
    {
      to: '/activity',
      label: t('nav.auditLog'),
      icon: ScrollText,
      visible: permissions.includes('audit.read'),
    },
    {
      to: '/settings',
      label: t('nav.settings'),
      icon: Settings,
      visible: permissions.includes('settings.read'),
    },
  ].filter((link) => link.visible);

  const handleSignOut = async () => {
    setSigningOut(true);
    await signOut().finally(() => setSigningOut(false));
  };

  return (
    <div className="min-h-dvh">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded focus:bg-white focus:px-3 focus:py-2"
      >
        {t('common.skipToContent')}
      </a>
      <header className="sticky top-0 z-30 border-b border-neutral-200 bg-white">
        <div className="mx-auto flex h-16 max-w-7xl items-center gap-3 px-4">
          <div className="flex min-w-0 items-center gap-2 font-semibold text-brand-800">
            <Store aria-hidden className="size-6 shrink-0" />
            <span className="truncate">{tenant.name}</span>
          </div>
          <nav aria-label={t('nav.main')} className="ml-2 hidden gap-0.5 lg:flex">
            {links.map(({ to, label, icon: Icon }) => (
              <NavLink
                key={to}
                to={to}
                end={to === '/'}
                className={({ isActive }) =>
                  `flex min-h-10 items-center gap-1.5 whitespace-nowrap rounded-md px-2.5 text-sm font-medium ${isActive ? 'bg-brand-50 text-brand-800' : 'text-neutral-700 hover:bg-neutral-100'}`
                }
              >
                <Icon aria-hidden className="size-4" />
                {label}
              </NavLink>
            ))}
          </nav>
          <div className="ml-auto hidden items-center gap-3 lg:flex">
            <NotificationBell />
            <LanguageSwitcher languages={enabledLanguages} />
            <div className="hidden whitespace-nowrap text-right text-sm leading-tight 2xl:block">
              <div className="font-medium text-neutral-900">{user.fullName}</div>
              <div className="text-neutral-600">{t(`roles.${role}`)}</div>
            </div>
            <Button
              variant="secondary"
              className="whitespace-nowrap"
              onClick={handleSignOut}
              loading={signingOut}
            >
              <LogOut aria-hidden className="size-4" />
              {t('common.signOut')}
            </Button>
          </div>
          <div className="ml-auto lg:hidden">
            <NotificationBell onNavigate={() => setMenuOpen(false)} />
          </div>
          <button
            type="button"
            className="flex size-11 items-center justify-center rounded-md lg:hidden"
            aria-expanded={menuOpen}
            aria-controls="mobile-menu"
            aria-label={menuOpen ? t('nav.closeMenu') : t('nav.openMenu')}
            onClick={() => setMenuOpen((open) => !open)}
          >
            {menuOpen ? <X aria-hidden /> : <Menu aria-hidden />}
          </button>
        </div>
        {menuOpen && (
          <div
            id="mobile-menu"
            className="space-y-3 border-t border-neutral-200 px-4 py-4 lg:hidden"
          >
            <nav aria-label={t('nav.main')} className="flex flex-col gap-1">
              {links.map(({ to, label, icon: Icon }) => (
                <NavLink
                  key={to}
                  to={to}
                  end={to === '/'}
                  onClick={() => setMenuOpen(false)}
                  className="flex min-h-11 items-center gap-2 rounded-md px-3 text-sm font-medium text-neutral-800 hover:bg-neutral-100"
                >
                  <Icon aria-hidden className="size-4" />
                  {label}
                </NavLink>
              ))}
            </nav>
            <LanguageSwitcher languages={enabledLanguages} />
            <Button variant="secondary" block onClick={handleSignOut} loading={signingOut}>
              <LogOut aria-hidden className="size-4" />
              {t('common.signOut')}
            </Button>
          </div>
        )}
      </header>
      <main id="main" className="mx-auto max-w-7xl px-4 py-8">
        <AccountBanners />
        <Outlet />
      </main>
    </div>
  );
}
