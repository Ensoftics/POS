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

type NavItem = { to: string; label: string; icon: typeof Store; visible: boolean };

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

  const canSell = permissions.includes('sales.create');

  // Groups follow the shop's day: overview, the counter, stock, then the books and setup.
  const groups: NavItem[][] = [
    [{ to: '/', label: t('nav.dashboard'), icon: LayoutDashboard, visible: true }],
    [
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
    ],
    [
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
    ],
    [
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
    ],
  ]
    .map((group) => group.filter((link) => link.visible))
    .filter((group) => group.length > 0);

  const handleSignOut = async () => {
    setSigningOut(true);
    await signOut().finally(() => setSigningOut(false));
  };

  const closeMenu = () => setMenuOpen(false);

  /** Shared by the desktop sidebar and the mobile drawer. */
  const navigation = (
    <nav aria-label={t('nav.main')} className="flex flex-col gap-4">
      {canSell && (
        <NavLink
          to="/pos"
          onClick={closeMenu}
          className={({ isActive }) =>
            `flex min-h-12 items-center gap-2.5 rounded-md bg-accent-500 px-3 text-base font-semibold text-brand-900 hover:bg-accent-400 ${isActive ? 'ring-2 ring-white/70 ring-offset-2 ring-offset-brand-800' : ''}`
          }
        >
          <ShoppingCart aria-hidden className="size-5" />
          {t('nav.sell')}
        </NavLink>
      )}
      {groups.map((group, index) => (
        <ul key={index} className="flex flex-col gap-0.5">
          {group.map(({ to, label, icon: Icon }) => (
            <li key={to}>
              <NavLink
                to={to}
                end={to === '/'}
                onClick={closeMenu}
                className={({ isActive }) =>
                  `flex min-h-10 items-center gap-2.5 rounded-md px-3 text-sm ${isActive ? 'bg-white/12 font-semibold text-white' : 'text-brand-100 hover:bg-white/6 hover:text-white'}`
                }
              >
                <Icon aria-hidden className="size-4 shrink-0" />
                {label}
              </NavLink>
            </li>
          ))}
        </ul>
      ))}
    </nav>
  );

  const account = (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1 text-sm leading-tight">
          <div className="truncate font-medium text-white">{user.fullName}</div>
          <div className="truncate text-brand-200">{t(`roles.${role}`)}</div>
        </div>
        <NotificationBell onDark onNavigate={closeMenu} />
      </div>
      <LanguageSwitcher languages={enabledLanguages} onDark />
      <button
        type="button"
        onClick={() => void handleSignOut()}
        disabled={signingOut}
        aria-busy={signingOut || undefined}
        className="flex min-h-10 w-full items-center gap-2.5 rounded-md px-3 text-sm font-medium text-brand-100 hover:bg-white/6 hover:text-white disabled:opacity-60"
      >
        <LogOut aria-hidden className="size-4" />
        {t('common.signOut')}
      </button>
    </div>
  );

  const tenantName = (
    <div className="flex min-w-0 items-start gap-2.5">
      <Store aria-hidden className="mt-0.5 size-5 shrink-0 text-accent-400" />
      <span className="min-w-0 font-semibold leading-snug text-white [overflow-wrap:anywhere]">
        {tenant.name}
      </span>
    </div>
  );

  return (
    <div className="min-h-dvh xl:pl-64">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded focus:bg-white focus:px-3 focus:py-2"
      >
        {t('common.skipToContent')}
      </a>

      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 flex-col bg-brand-800 xl:flex">
        <div className="px-5 pb-6 pt-6">{tenantName}</div>
        <div className="flex-1 overflow-y-auto px-3 pb-6">{navigation}</div>
        <div className="border-t border-white/10 px-3 py-4">{account}</div>
      </aside>

      <header className="sticky top-0 z-30 bg-brand-800 xl:hidden">
        <div className="flex h-14 items-center gap-2 px-4">
          <div className="min-w-0 flex-1 [&_span]:truncate">{tenantName}</div>
          {!menuOpen && <NotificationBell onDark />}
          <button
            type="button"
            className="flex size-11 items-center justify-center rounded-md text-white hover:bg-white/10"
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
            className="max-h-[calc(100dvh-3.5rem)] space-y-6 overflow-y-auto border-t border-white/10 px-4 py-4"
          >
            {navigation}
            <div className="border-t border-white/10 pt-4">{account}</div>
          </div>
        )}
      </header>

      <main id="main" className="mx-auto max-w-6xl px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
        <AccountBanners />
        <Outlet />
      </main>
    </div>
  );
}
