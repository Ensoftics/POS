import type { Customer } from '@pos/contracts';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Alert, Badge, Card, Skeleton } from '../../components/ui';
import { api } from '../../lib/api';
import { errorMessage } from '../../lib/errors';

/** Whether the customer agreed to messages, and every change with who recorded it and how. */
export function ConsentCard({ customer }: { customer: Customer }) {
  const { t, i18n } = useTranslation();
  const history = useQuery({
    // The version changes with every edit, so the history refreshes after one.
    queryKey: ['consents', customer.id, customer.version],
    queryFn: () => api.customers.consents(customer.id),
  });
  const when = new Intl.DateTimeFormat(i18n.resolvedLanguage, {
    dateStyle: 'medium',
    timeStyle: 'short',
  });

  return (
    <Card title={t('messaging.consentTitle')}>
      <div className="space-y-3">
        <p className="flex flex-wrap items-center gap-2 text-sm">
          <Badge tone={customer.marketingConsent ? 'success' : 'neutral'}>
            {customer.marketingConsent ? t('messaging.agreed') : t('messaging.notAgreed')}
          </Badge>
          {customer.marketingConsentAt && (
            <span className="text-neutral-600">
              {t('messaging.since', { date: when.format(new Date(customer.marketingConsentAt)) })}
            </span>
          )}
        </p>
        {history.isPending ? (
          <Skeleton className="h-12 w-full" />
        ) : history.isError ? (
          <Alert tone="danger">{errorMessage(t, history.error)}</Alert>
        ) : history.data.items.length === 0 ? (
          <p className="text-sm text-neutral-600">{t('messaging.noHistory')}</p>
        ) : (
          <ul className="divide-y divide-neutral-200 text-sm" aria-label={t('messaging.history')}>
            {history.data.items.map((event) => (
              <li key={event.id} className="py-2">
                <span className="font-medium">
                  {event.granted ? t('messaging.events.granted') : t('messaging.events.withdrawn')}
                </span>{' '}
                <span className="text-neutral-600">
                  · {when.format(new Date(event.createdAt))} ·{' '}
                  {event.source === 'UNSUBSCRIBE_LINK'
                    ? t('messaging.events.byLink')
                    : t('messaging.events.byStaff', {
                        name: event.actorName ?? t('messaging.events.someone'),
                      })}
                </span>
                {event.note && <div className="text-neutral-700">“{event.note}”</div>}
              </li>
            ))}
          </ul>
        )}
      </div>
    </Card>
  );
}
