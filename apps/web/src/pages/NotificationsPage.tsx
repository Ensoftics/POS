import type { Notification } from '@pos/contracts';
import { INTL_LOCALES, isSupportedLanguage } from '@pos/i18n';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';
import { Alert, Badge, Button, Card, CheckboxField, Skeleton } from '../components/ui';
import { api } from '../lib/api';
import { useAuthContext } from '../lib/auth-store';
import { errorMessage } from '../lib/errors';
import { notificationsKey, notificationText } from '../lib/notifications';

export function NotificationsPage() {
  const { t, i18n } = useTranslation();
  const { tenant } = useAuthContext();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [unreadOnly, setUnreadOnly] = useState(false);
  const key = notificationsKey(tenant.id);
  const locale = isSupportedLanguage(i18n.resolvedLanguage)
    ? INTL_LOCALES[i18n.resolvedLanguage]
    : 'en-LK';
  const when = new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' });

  const list = useInfiniteQuery({
    queryKey: [...key, 'list', { unreadOnly }],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      api.notifications.list({
        ...(unreadOnly ? { unreadOnly: 'true' as const } : {}),
        ...(pageParam ? { cursor: pageParam } : {}),
      }),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
  const refresh = () => queryClient.invalidateQueries({ queryKey: key });
  const readAll = useMutation({
    mutationFn: () => api.notifications.markAllRead(),
    onSuccess: refresh,
  });
  const open = useMutation({
    mutationFn: (n: Notification) =>
      n.readAt ? Promise.resolve(n) : api.notifications.markRead(n.id),
    onSuccess: async (n) => {
      await refresh();
      if (n.link) navigate(n.link);
    },
  });
  const rows = list.data?.pages.flatMap((page) => page.items) ?? [];

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-neutral-900">
            {t('notifications.title')}
          </h1>
          <p className="mt-1 text-sm text-neutral-600">{t('notifications.subtitle')}</p>
        </div>
        <div className="flex flex-wrap items-center gap-4">
          <CheckboxField
            label={t('notifications.unreadOnly')}
            checked={unreadOnly}
            onChange={(e) => setUnreadOnly(e.target.checked)}
          />
          <Button variant="secondary" loading={readAll.isPending} onClick={() => readAll.mutate()}>
            {t('notifications.markAll')}
          </Button>
        </div>
      </div>

      {list.isPending ? (
        <Skeleton className="h-40 w-full" />
      ) : list.isError ? (
        <Alert tone="danger">{errorMessage(t, list.error)}</Alert>
      ) : rows.length === 0 ? (
        <Card>
          <p className="text-sm text-neutral-600">{t('notifications.empty')}</p>
        </Card>
      ) : (
        <Card>
          <ul className="divide-y divide-neutral-200">
            {rows.map((n) => {
              const text = notificationText(t, i18n.resolvedLanguage, n);
              return (
                <li
                  key={n.id}
                  className="flex flex-col gap-2 py-3 sm:flex-row sm:items-start sm:justify-between"
                >
                  <div className="min-w-0 space-y-0.5">
                    <p className="flex flex-wrap items-center gap-2 font-medium text-neutral-900">
                      {text.title}
                      {!n.readAt && <Badge tone="warning">{t('notifications.unread')}</Badge>}
                    </p>
                    <p className="text-sm text-neutral-700">{text.body}</p>
                    <p className="text-xs text-neutral-500">{when.format(new Date(n.createdAt))}</p>
                  </div>
                  {n.link && (
                    <Button
                      variant="secondary"
                      aria-label={`${t('notifications.open')}: ${text.title}`}
                      onClick={() => open.mutate(n)}
                    >
                      {t('notifications.open')}
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
          {list.hasNextPage && (
            <div className="mt-4">
              <Button
                variant="secondary"
                loading={list.isFetchingNextPage}
                onClick={() => void list.fetchNextPage()}
              >
                {t('notifications.more')}
              </Button>
            </div>
          )}
        </Card>
      )}

      <EmailPreference />
    </div>
  );
}

function EmailPreference() {
  const { t } = useTranslation();
  const { tenant } = useAuthContext();
  const queryClient = useQueryClient();
  const key = [...notificationsKey(tenant.id), 'preferences'];
  const prefs = useQuery({ queryKey: key, queryFn: () => api.notifications.preferences() });
  const save = useMutation({
    mutationFn: (emailDigest: boolean) => api.notifications.setPreferences({ emailDigest }),
    onSuccess: (next) => queryClient.setQueryData(key, next),
  });
  if (!prefs.data) return null;
  return (
    <Card>
      <CheckboxField
        label={t('notifications.emailDigest')}
        checked={prefs.data.emailDigest}
        disabled={save.isPending}
        onChange={(e) => save.mutate(e.target.checked)}
      />
      <p className="mt-2 text-xs text-neutral-600">{t('notifications.emailDigestHint')}</p>
      {save.isSuccess && (
        <p className="mt-2 text-sm text-success-700">{t('notifications.saved')}</p>
      )}
      {save.isError && <Alert tone="danger">{errorMessage(t, save.error)}</Alert>}
    </Card>
  );
}
