import { useInfiniteQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { Alert, Button, Card, Skeleton } from '../../components/ui';
import { errorMessage } from '../../lib/errors';
import { platformApi } from '../../lib/platform';
import { usePlatformFormat } from './PlatformLayout';

export function PlatformAuditPage() {
  const { t } = useTranslation();
  const { dateTime } = usePlatformFormat();
  const log = useInfiniteQuery({
    queryKey: ['platform', 'audit'],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => platformApi.audit(pageParam ? { cursor: pageParam } : {}),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
  const rows = log.data?.pages.flatMap((p) => p.items) ?? [];

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold tracking-tight text-neutral-900">
        {t('platform.audit.title')}
      </h1>
      {log.isPending ? (
        <Skeleton className="h-40 w-full" />
      ) : log.isError ? (
        <Alert tone="danger">{errorMessage(t, log.error)}</Alert>
      ) : (
        <Card>
          <div className="-mx-5 overflow-x-auto px-5">
            <table className="w-full min-w-[720px] text-left text-sm">
              <thead className="text-xs text-neutral-600">
                <tr>
                  <th scope="col" className="py-2 pr-3 font-medium">
                    {t('platform.audit.when')}
                  </th>
                  <th scope="col" className="py-2 pr-3 font-medium">
                    {t('platform.audit.who')}
                  </th>
                  <th scope="col" className="py-2 pr-3 font-medium">
                    {t('platform.audit.action')}
                  </th>
                  <th scope="col" className="py-2 pr-3 font-medium">
                    {t('platform.audit.business')}
                  </th>
                  <th scope="col" className="py-2 font-medium">
                    {t('platform.audit.details')}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-200 align-top">
                {rows.map((row) => (
                  <tr key={row.id}>
                    <td className="whitespace-nowrap py-2 pr-3">{dateTime(row.createdAt)}</td>
                    <td className="py-2 pr-3">{row.actorEmail ?? t('platform.audit.cli')}</td>
                    <td className="py-2 pr-3 font-mono text-xs">{row.action}</td>
                    <td className="py-2 pr-3">
                      {row.tenantId ? (
                        <Link
                          className="text-brand-700 hover:underline"
                          to={`/platform/tenants/${row.tenantId}`}
                        >
                          {row.tenantName ?? row.tenantId}
                        </Link>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className="max-w-md break-words py-2 font-mono text-xs text-neutral-600">
                      {row.metadata ? JSON.stringify(row.metadata) : ''}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {log.hasNextPage && (
            <div className="mt-4">
              <Button
                variant="secondary"
                loading={log.isFetchingNextPage}
                onClick={() => void log.fetchNextPage()}
              >
                {t('platform.audit.more')}
              </Button>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
