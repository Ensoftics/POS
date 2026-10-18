import type { Device } from '@pos/contracts';
import { INTL_LOCALES, isSupportedLanguage } from '@pos/i18n';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Smartphone } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Badge, Button, Card, Skeleton } from '../../components/ui';
import { api } from '../../lib/api';
import { useAuthContext } from '../../lib/auth-store';
import { errorMessage } from '../../lib/errors';

const devicesKey = (tenantId: string) => ['devices', tenantId] as const;

/** Settings › Devices: Android tills and blocking a lost or stolen one. */
export function DevicesPage() {
  const { t } = useTranslation();
  const { tenant, permissions } = useAuthContext();
  const [notice, setNotice] = useState<string | null>(null);
  const devices = useQuery({
    queryKey: devicesKey(tenant.id),
    queryFn: () => api.devices.list(),
    enabled: permissions.includes('staff.manage'),
  });

  if (!permissions.includes('staff.manage'))
    return <Alert tone="warning">{t('errors.FORBIDDEN')}</Alert>;

  return (
    <div className="space-y-4">
      <p className="max-w-2xl text-sm text-neutral-600">{t('devices.intro')}</p>
      {notice && <Alert tone="success">{notice}</Alert>}
      {devices.isPending ? (
        <Card>
          <div className="space-y-3" aria-busy="true" aria-label={t('common.loading')}>
            <Skeleton className="h-16 w-full" />
          </div>
        </Card>
      ) : devices.isError ? (
        <Alert
          tone="danger"
          action={
            <Button variant="secondary" onClick={() => void devices.refetch()}>
              {t('common.retry')}
            </Button>
          }
        >
          {errorMessage(t, devices.error)}
        </Alert>
      ) : devices.data.items.length === 0 ? (
        <Card>
          <p className="text-sm text-neutral-600">{t('devices.empty')}</p>
        </Card>
      ) : (
        <Card>
          <ul className="divide-y divide-neutral-200">
            {devices.data.items.map((device) => (
              <li key={device.id} className="py-3 first:pt-0 last:pb-0">
                <DeviceRow device={device} onNotice={setNotice} />
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}

function DeviceRow({ device, onNotice }: { device: Device; onNotice: (m: string) => void }) {
  const { t, i18n } = useTranslation();
  const { tenant } = useAuthContext();
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const locale = isSupportedLanguage(i18n.resolvedLanguage)
    ? INTL_LOCALES[i18n.resolvedLanguage]
    : 'en-LK';
  const date = new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' });

  const toggle = useMutation({
    mutationFn: () =>
      device.revoked ? api.devices.restore(device.id) : api.devices.revoke(device.id),
    onSuccess: () => {
      onNotice(
        t(device.revoked ? 'devices.allowedNotice' : 'devices.blockedNotice', {
          name: device.name,
        }),
      );
      return queryClient.invalidateQueries({ queryKey: devicesKey(tenant.id) });
    },
    onError: (err) => setError(errorMessage(t, err)),
  });

  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
      <div className="flex gap-3">
        <Smartphone aria-hidden className="mt-0.5 size-5 shrink-0 text-neutral-500" />
        <div className="space-y-1">
          <p className="flex flex-wrap items-center gap-2 font-medium text-neutral-900">
            {device.name}
            <Badge tone={device.revoked ? 'warning' : 'success'}>
              {device.revoked ? t('devices.blocked') : t('devices.active')}
            </Badge>
          </p>
          <p className="text-sm text-neutral-700">
            {t('devices.register', { branch: device.branchName, register: device.registerName })}
          </p>
          <p className="text-xs text-neutral-500">
            {t('devices.lastSeen', { date: date.format(new Date(device.lastSeenAt)) })}
            {device.registeredByName && (
              <> · {t('devices.addedBy', { name: device.registeredByName })}</>
            )}
          </p>
          {error && <Alert tone="danger">{error}</Alert>}
        </div>
      </div>
      <Button
        variant="secondary"
        loading={toggle.isPending}
        aria-label={`${device.revoked ? t('devices.allow') : t('devices.block')}: ${device.name}`}
        onClick={() => {
          if (!device.revoked && !window.confirm(t('devices.blockConfirm', { name: device.name })))
            return;
          setError(null);
          toggle.mutate();
        }}
      >
        {device.revoked ? t('devices.allow') : t('devices.block')}
      </Button>
    </div>
  );
}
