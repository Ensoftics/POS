import type { PlatformFeatureFlag, TenantFeature } from '@pos/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Badge, Button, Card, SelectField, Skeleton, TextField } from '../../components/ui';
import { errorMessage } from '../../lib/errors';
import { platformApi } from '../../lib/platform';
import { fieldErrors } from './PlatformLayout';

/** Feature flag defaults for every business. */
export function PlatformFlagsPage() {
  const { t } = useTranslation();
  const flags = useQuery({ queryKey: ['platform', 'flags'], queryFn: () => platformApi.flags() });
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold tracking-tight text-neutral-900">
        {t('platform.flags.title')}
      </h1>
      <p className="max-w-3xl text-sm text-neutral-600">{t('platform.flags.intro')}</p>
      {flags.isPending ? (
        <Skeleton className="h-32 w-full" />
      ) : flags.isError ? (
        <Alert tone="danger">{errorMessage(t, flags.error)}</Alert>
      ) : (
        <Card>
          <ul className="divide-y divide-neutral-200">
            {flags.data.items.map((flag) => (
              <FlagRow key={flag.key} flag={flag} />
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}

function FlagRow({ flag }: { flag: PlatformFeatureFlag }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const toggle = useMutation({
    mutationFn: () =>
      platformApi.updateFlag(flag.key, {
        defaultEnabled: !flag.defaultEnabled,
        version: flag.version,
      }),
    onSuccess: (list) => queryClient.setQueryData(['platform', 'flags'], list),
  });
  return (
    <li className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="space-y-1">
        <p className="flex flex-wrap items-center gap-2 font-mono text-sm font-medium">
          {flag.key}
          <Badge tone={flag.defaultEnabled ? 'success' : 'neutral'}>
            {flag.defaultEnabled ? t('platform.flags.on') : t('platform.flags.off')}
          </Badge>
        </p>
        <p className="text-sm text-neutral-600">{flag.description}</p>
        <p className="text-xs text-neutral-500">
          {t('platform.flags.overrides', { count: flag.overrides })}
        </p>
        {toggle.isError && <Alert tone="danger">{errorMessage(t, toggle.error)}</Alert>}
      </div>
      <Button
        variant="secondary"
        loading={toggle.isPending}
        aria-label={`${flag.defaultEnabled ? t('platform.flags.turnOff') : t('platform.flags.turnOn')}: ${flag.key}`}
        onClick={() => toggle.mutate()}
      >
        {flag.defaultEnabled ? t('platform.flags.turnOff') : t('platform.flags.turnOn')}
      </Button>
    </li>
  );
}

/** A business's flags on its detail page: follow the default, or force on or off. */
export function TenantFeatures({
  tenantId,
  features,
}: {
  tenantId: string;
  features: TenantFeature[];
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [reason, setReason] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const set = useMutation({
    mutationFn: ({ key, value }: { key: string; value: string }) =>
      platformApi.setTenantFlag(tenantId, key, {
        enabled: value === 'default' ? null : value === 'on',
        reason,
      }),
    onMutate: () => setErrors({}),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['platform', 'tenant', tenantId] }),
    onError: (error) => setErrors(fieldErrors(error)),
  });
  return (
    <Card title={t('platform.flags.business')}>
      <div className="space-y-3">
        <TextField
          label={t('platform.flags.reason')}
          value={reason}
          error={errors.reason}
          onChange={(e) => setReason(e.target.value)}
        />
        {set.isError && Object.keys(errors).length === 0 && (
          <Alert tone="danger">{errorMessage(t, set.error)}</Alert>
        )}
        {features.map((feature) => (
          <SelectField
            key={feature.key}
            label={feature.key}
            hint={feature.overridden ? t('platform.flags.overridden') : t('platform.flags.default')}
            value={feature.overridden ? (feature.enabled ? 'on' : 'off') : 'default'}
            disabled={set.isPending}
            onChange={(e) => set.mutate({ key: feature.key, value: e.target.value })}
            options={[
              {
                value: 'default',
                label: `${t('platform.flags.useDefault')}${feature.overridden ? '' : ` (${feature.enabled ? t('platform.flags.on') : t('platform.flags.off')})`}`,
              },
              { value: 'on', label: t('platform.flags.on') },
              { value: 'off', label: t('platform.flags.off') },
            ]}
          />
        ))}
      </div>
    </Card>
  );
}
