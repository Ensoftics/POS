import type { Notification } from '@pos/contracts';
import { type CurrencyCode, formatMoney } from '@pos/domain';
import { INTL_LOCALES, isSupportedLanguage } from '@pos/i18n';
import { useQuery } from '@tanstack/react-query';
import type { TFunction } from 'i18next';
import { api } from './api';
import { useAuthContext } from './auth-store';

export const notificationsKey = (tenantId: string) => ['notifications', tenantId] as const;

/** Unread count for the bell; refreshed every minute and after reading. */
export function useUnreadCount() {
  const { tenant } = useAuthContext();
  return useQuery({
    queryKey: [...notificationsKey(tenant.id), 'unread'],
    queryFn: () => api.notifications.unreadCount(),
    refetchInterval: 60_000,
  });
}

/** Title and body of a notification in the reader's language. */
export function notificationText(
  t: TFunction,
  language: string | undefined,
  n: Notification,
): { title: string; body: string } {
  const d = n.data as Record<string, string | number | null>;
  const locale = isSupportedLanguage(language) ? INTL_LOCALES[language] : 'en-LK';
  switch (n.kind) {
    case 'INVENTORY_ALERT':
      return {
        title: t('notifications.kind.INVENTORY_ALERT.title', { branchName: d.branchName }),
        body: t('notifications.kind.INVENTORY_ALERT.body', {
          low: d.low,
          expiring: d.expiring,
          days: d.days,
        }),
      };
    case 'DAILY_SUMMARY': {
      const currency = (d.currency ?? 'LKR') as CurrencyCode;
      const body = t('notifications.kind.DAILY_SUMMARY.body', {
        amount: formatMoney(Number(d.salesMinor ?? 0), currency, locale),
        count: d.saleCount,
      });
      const refunds = Number(d.refundsMinor ?? 0);
      return {
        title: t('notifications.kind.DAILY_SUMMARY.title', { date: d.date }),
        body: refunds
          ? `${body} · ${t('notifications.kind.DAILY_SUMMARY.refunds', {
              amount: formatMoney(refunds, currency, locale),
            })}`
          : body,
      };
    }
    case 'SALE_CONFLICT':
      return {
        title: t('notifications.kind.SALE_CONFLICT.title'),
        body: t('notifications.kind.SALE_CONFLICT.body', { saleNumber: d.saleNumber }),
      };
    case 'SUBSCRIPTION':
      return {
        title: t('notifications.kind.SUBSCRIPTION.title', {
          status: t(`billing.status.${String(d.status)}`),
        }),
        body: t('notifications.kind.SUBSCRIPTION.body'),
      };
  }
}
