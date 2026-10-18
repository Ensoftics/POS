import { useInfiniteQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Alert, Button, Card, Skeleton } from '../components/ui';
import { api } from '../lib/api';
import { useAuthContext } from '../lib/auth-store';
import { errorMessage } from '../lib/errors';

const PAGE_SIZE = 25;
const LOCALES: Record<string, string> = { en: 'en-LK', si: 'si-LK', ta: 'ta-LK' };

export function AuditLogPage() {
  const { t, i18n } = useTranslation();
  const { tenant, permissions } = useAuthContext();
  const allowed = permissions.includes('audit.read');

  const query = useInfiniteQuery({
    queryKey: ['audit-logs', tenant.id],
    queryFn: ({ pageParam }) => api.audit.list({ cursor: pageParam, limit: PAGE_SIZE }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    enabled: allowed,
  });

  const formatter = new Intl.DateTimeFormat(LOCALES[i18n.resolvedLanguage ?? 'en'] ?? 'en-LK', {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
  const items = query.data?.pages.flatMap((page) => page.items) ?? [];
  const loadMoreError = query.isFetchNextPageError ? query.error : null;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-neutral-900">
          {t('audit.title')}
        </h1>
        <p className="mt-1 text-sm text-neutral-600">{t('audit.subtitle')}</p>
      </div>

      {!allowed ? (
        <Alert tone="warning">{t('audit.forbidden')}</Alert>
      ) : query.isPending ? (
        <Card>
          <div className="space-y-3" aria-busy="true" aria-label={t('common.loading')}>
            {Array.from({ length: 5 }, (_, index) => (
              <Skeleton key={index} className="h-6 w-full" />
            ))}
          </div>
        </Card>
      ) : query.isError ? (
        <Alert
          tone="danger"
          action={
            <Button variant="secondary" onClick={() => void query.refetch()}>
              {t('common.retry')}
            </Button>
          }
        >
          {errorMessage(t, query.error)}
        </Alert>
      ) : items.length === 0 ? (
        <Card>
          <p className="text-sm text-neutral-600">{t('audit.empty')}</p>
        </Card>
      ) : (
        <Card>
          <div className="-mx-5 overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead className="border-b border-neutral-200 text-neutral-600">
                <tr>
                  <th scope="col" className="px-5 py-2 font-medium">
                    {t('audit.time')}
                  </th>
                  <th scope="col" className="px-5 py-2 font-medium">
                    {t('audit.action')}
                  </th>
                  <th scope="col" className="px-5 py-2 font-medium">
                    {t('audit.actor')}
                  </th>
                  <th scope="col" className="px-5 py-2 font-medium">
                    {t('audit.ip')}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100">
                {items.map((item) => (
                  <tr key={item.id}>
                    <td className="whitespace-nowrap px-5 py-2.5 text-neutral-700">
                      <time dateTime={item.createdAt}>
                        {formatter.format(new Date(item.createdAt))}
                      </time>
                    </td>
                    <td className="px-5 py-2.5 font-medium text-neutral-900">
                      {t(`audit.actions.${item.action}`, { defaultValue: item.action })}
                    </td>
                    <td className="px-5 py-2.5 text-neutral-700">
                      {item.actorName ?? t('audit.system')}
                    </td>
                    <td className="whitespace-nowrap px-5 py-2.5 font-mono text-xs text-neutral-600">
                      {item.ip ?? '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {query.hasNextPage && (
            <div className="mt-4 flex justify-center">
              <Button
                variant="secondary"
                onClick={() => void query.fetchNextPage()}
                loading={query.isFetchingNextPage}
              >
                {t('audit.loadMore')}
              </Button>
            </div>
          )}
          {loadMoreError && (
            <div className="mt-4">
              <Alert tone="danger">{errorMessage(t, loadMoreError)}</Alert>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
