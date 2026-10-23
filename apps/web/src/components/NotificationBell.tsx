import { Bell } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { NavLink } from 'react-router';
import { useUnreadCount } from '../lib/notifications';

/** Header link to the notifications page with the unread count. */
export function NotificationBell({
  onNavigate,
  onDark = false,
}: {
  onNavigate?: () => void;
  /** Styles for the indigo app shell. */
  onDark?: boolean;
}) {
  const { t } = useTranslation();
  const unread = useUnreadCount().data?.unread ?? 0;
  return (
    <NavLink
      to="/notifications"
      onClick={onNavigate}
      aria-label={unread ? t('nav.notificationsUnread', { count: unread }) : t('nav.notifications')}
      className={({ isActive }) =>
        `relative flex size-11 shrink-0 items-center justify-center rounded-md ${
          onDark
            ? isActive
              ? 'bg-white/15 text-white'
              : 'text-brand-100 hover:bg-white/10 hover:text-white'
            : isActive
              ? 'bg-brand-50 text-brand-800'
              : 'text-neutral-700 hover:bg-neutral-100'
        }`
      }
    >
      <Bell aria-hidden className="size-5" />
      {unread > 0 && (
        <span
          aria-hidden
          className="absolute right-1 top-1 min-w-5 rounded-full bg-danger-600 px-1 text-center text-xs font-semibold leading-5 text-white"
        >
          {unread > 99 ? '99+' : unread}
        </span>
      )}
    </NavLink>
  );
}
