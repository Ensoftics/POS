import type { Notification } from '@pos/contracts';
import { type CurrencyCode, formatMoney } from '@pos/domain';
import type { TFunction } from 'i18next';

/** Title and body of a notification in the reader's language (same wording as the web app). */
export function notificationText(t: TFunction, n: Notification): { title: string; body: string } {
  const d = n.data as Record<string, string | number | null>;
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
    case 'DAILY_SUMMARY':
      return {
        title: t('notifications.kind.DAILY_SUMMARY.title', { date: d.date }),
        body: t('notifications.kind.DAILY_SUMMARY.body', {
          amount: formatMoney(Number(d.salesMinor ?? 0), (d.currency ?? 'LKR') as CurrencyCode),
          count: d.saleCount,
        }),
      };
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
