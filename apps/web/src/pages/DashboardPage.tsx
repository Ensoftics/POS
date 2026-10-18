import { ShieldAlert } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Button, Card } from '../components/ui';
import { api } from '../lib/api';
import { authStore, useAuthContext } from '../lib/auth-store';
import { errorMessage } from '../lib/errors';
import { useSettings } from '../lib/settings';
import { BusinessOverview } from './reports/BusinessOverview';

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5 py-2 sm:flex-row sm:justify-between sm:gap-4">
      <dt className="text-sm text-neutral-600">{label}</dt>
      <dd className="break-all text-sm font-medium text-neutral-900 sm:text-right">{value}</dd>
    </div>
  );
}

export function DashboardPage() {
  const { t } = useTranslation();
  const { user, tenant, role, memberships, permissions } = useAuthContext();
  const settings = useSettings();
  const [signingOutAll, setSigningOutAll] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const otherBusinesses = memberships.filter(
    (membership) => membership.tenantId !== tenant.id,
  ).length;

  const signOutEverywhere = async () => {
    if (!window.confirm(t('dashboard.signOutAllConfirm'))) return;
    setSigningOutAll(true);
    setError(null);
    try {
      await api.auth.logoutAll();
      authStore.clear('signed_out');
    } catch (err) {
      setError(errorMessage(t, err));
      setSigningOutAll(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-neutral-900">
          {t('dashboard.greeting', { name: user.fullName })}
        </h1>
        <p className="mt-1 text-sm text-neutral-600">{t('dashboard.subtitle')}</p>
      </div>

      {tenant.onboardingStatus === 'PENDING' && (
        <Alert tone="info">{t('dashboard.onboardingPending')}</Alert>
      )}

      {permissions.includes('reports.view') && <BusinessOverview />}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card title={t('dashboard.business')}>
          <dl className="divide-y divide-neutral-100">
            <Detail label={t('onboarding.businessName')} value={tenant.name} />
            <Detail
              label={t('dashboard.businessType')}
              value={
                tenant.businessType
                  ? t(`businessTypes.${tenant.businessType}.label`)
                  : t('dashboard.notSet')
              }
            />
            <Detail
              label={t('dashboard.contactPhone')}
              value={tenant.contactPhone ?? t('dashboard.notSet')}
            />
            {settings.data && (
              <>
                <Detail
                  label={t('settings.localization.currency')}
                  value={settings.data.currency}
                />
                <Detail
                  label={t('settings.localization.timezone')}
                  value={settings.data.timezone.replaceAll('_', ' ')}
                />
              </>
            )}
            <Detail label={t('dashboard.workspaceId')} value={tenant.slug} />
          </dl>
        </Card>

        <Card title={t('dashboard.account')}>
          <dl className="divide-y divide-neutral-100">
            <Detail label={t('dashboard.email')} value={user.email} />
            <Detail label={t('dashboard.role')} value={t(`roles.${role}`)} />
          </dl>
          {otherBusinesses > 0 && (
            <p className="mt-3 text-sm text-neutral-600">
              {t('dashboard.otherBusinesses', { count: otherBusinesses })}
            </p>
          )}
        </Card>

        <Card title={t('dashboard.security')} className="lg:col-span-2">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-3">
              <ShieldAlert aria-hidden className="mt-0.5 size-5 shrink-0 text-warning-600" />
              <p className="text-sm text-neutral-700">{t('dashboard.signOutAllHint')}</p>
            </div>
            <Button
              variant="danger"
              onClick={() => void signOutEverywhere()}
              loading={signingOutAll}
            >
              {t('dashboard.signOutAll')}
            </Button>
          </div>
          {error && (
            <div className="mt-4">
              <Alert tone="danger">{error}</Alert>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
