import type { PlatformTenantDetail } from '@pos/contracts';
import { PLAN_RESOURCES } from '@pos/domain';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft } from 'lucide-react';
import { type FormEvent, type ReactNode, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router';
import { Alert, Badge, Button, Card, SelectField, Skeleton, TextField } from '../../components/ui';
import { errorMessage } from '../../lib/errors';
import { platformApi } from '../../lib/platform';
import { TenantFeatures } from './PlatformFlagsPage';
import { fieldErrors, usePlatformFormat } from './PlatformLayout';

export function PlatformTenantPage() {
  const { t } = useTranslation();
  const { id = '' } = useParams();
  const { date, dateTime, money } = usePlatformFormat();
  const detail = useQuery({
    queryKey: ['platform', 'tenant', id],
    queryFn: () => platformApi.tenant(id),
  });

  if (detail.isPending) return <Skeleton className="h-64 w-full" />;
  if (detail.isError) return <Alert tone="danger">{errorMessage(t, detail.error)}</Alert>;
  const d = detail.data;
  const sub = d.subscription;

  return (
    <div className="space-y-4">
      <Link
        to="/platform/tenants"
        className="inline-flex items-center gap-1 text-sm text-brand-700 hover:underline"
      >
        <ArrowLeft aria-hidden className="size-4" />
        {t('platform.tenant.back')}
      </Link>
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-2xl font-semibold tracking-tight text-neutral-900">{d.name}</h1>
        <Badge tone={d.status === 'ACTIVE' ? 'success' : 'warning'}>
          {t(`platform.tenants.status.${d.status}`)}
        </Badge>
        {sub && (
          <Badge>
            {sub.planName} · {t(`billing.status.${sub.status}`)}
          </Badge>
        )}
      </div>
      <p className="text-sm text-neutral-600">
        {d.slug} · {t('platform.tenants.created')} {date(d.createdAt)}
        {sub?.trialEndsAt && ` · ${t('billing.status.TRIALING')} → ${date(sub.trialEndsAt)}`}
        {sub?.currentPeriodEnd &&
          ` · ${t('billing.paidUntil', { date: date(sub.currentPeriodEnd) })}`}
      </p>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title={t('platform.tenant.owners')}>
          <ul className="space-y-2 text-sm">
            {d.owners.map((o) => (
              <li key={o.email}>
                <span className="font-medium">{o.fullName}</span> · {o.email}{' '}
                <Badge tone={o.emailVerified ? 'success' : 'warning'}>
                  {o.emailVerified
                    ? t('platform.tenant.verified')
                    : t('platform.tenant.unverified')}
                </Badge>
              </li>
            ))}
          </ul>
        </Card>
        <Card title={t('platform.tenant.usage')}>
          <dl className="grid grid-cols-2 gap-3 text-sm">
            {PLAN_RESOURCES.map((r) => (
              <div key={r}>
                <dt className="text-neutral-600">{t(`billing.resources.${r}`)}</dt>
                <dd className="font-medium tabular-nums">
                  {d.usage[r]} / {d.limits?.[r] ?? '—'}
                </dd>
              </div>
            ))}
          </dl>
        </Card>
      </div>

      <TenantFeatures tenantId={d.id} features={d.features} />

      {d.status === 'CLOSED' ? (
        <Alert tone="warning">{t('platform.tenant.closed')}</Alert>
      ) : (
        <SupportActions tenant={d} />
      )}

      <Card title={t('platform.tenant.invoices')}>
        {d.invoices.length === 0 ? (
          <p className="text-sm text-neutral-600">{t('platform.tenant.none')}</p>
        ) : (
          <ul className="divide-y divide-neutral-200 text-sm">
            {d.invoices.map((i) => (
              <li key={i.id} className="flex flex-wrap justify-between gap-2 py-2">
                <span>
                  {i.number} · {i.planName} · {date(i.createdAt)}
                </span>
                <span className="tabular-nums">
                  {money(i.totalMinor, i.currency)} · {t(`billing.invoiceStatus.${i.status}`)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Card title={t('platform.tenant.payments')}>
        {d.payments.length === 0 ? (
          <p className="text-sm text-neutral-600">{t('platform.tenant.none')}</p>
        ) : (
          <ul className="divide-y divide-neutral-200 text-sm">
            {d.payments.map((p, index) => (
              <li key={index} className="flex flex-wrap justify-between gap-2 py-2">
                <span>
                  {dateTime(p.createdAt)} · {p.provider} {p.method ? `· ${p.method}` : ''}
                </span>
                <span className="tabular-nums">
                  {money(p.amountMinor, p.currency)} · {p.outcome}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

/** One support action: a small form with a reason, refreshing the business after it runs. */
function ActionForm({
  title,
  hint,
  submitLabel,
  danger,
  children,
  onSubmit,
}: {
  title: string;
  hint?: string;
  submitLabel: string;
  danger?: boolean;
  children: (errors: Record<string, string>) => ReactNode;
  onSubmit: () => Promise<unknown>;
}) {
  const { t } = useTranslation();
  const { id = '' } = useParams();
  const queryClient = useQueryClient();
  const [errors, setErrors] = useState<Record<string, string>>({});
  const action = useMutation({
    mutationFn: onSubmit,
    onMutate: () => setErrors({}),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['platform', 'tenant', id] }),
    onError: (error) => setErrors(fieldErrors(error)),
  });
  const submit = (event: FormEvent) => {
    event.preventDefault();
    action.mutate();
  };
  return (
    <form
      noValidate
      onSubmit={submit}
      aria-label={title}
      className="space-y-3 rounded-md border border-neutral-200 p-4"
    >
      <h3 className="font-medium text-neutral-900">{title}</h3>
      {hint && <p className="text-xs text-neutral-600">{hint}</p>}
      {children(errors)}
      {action.isError && Object.keys(errors).length === 0 && (
        <Alert tone="danger">{errorMessage(t, action.error)}</Alert>
      )}
      {action.isSuccess && <Alert tone="success">{t('platform.tenant.done')}</Alert>}
      <Button type="submit" variant={danger ? 'danger' : 'secondary'} loading={action.isPending}>
        {submitLabel}
      </Button>
    </form>
  );
}

function ReasonField({
  value,
  onChange,
  error,
}: {
  value: string;
  onChange: (v: string) => void;
  error?: string;
}) {
  const { t } = useTranslation();
  return (
    <TextField
      label={t('platform.tenant.reason')}
      value={value}
      error={error}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

function SupportActions({ tenant }: { tenant: PlatformTenantDetail }) {
  const { t } = useTranslation();
  const plans = useQuery({ queryKey: ['platform', 'plans'], queryFn: () => platformApi.plans() });
  const planOptions = (plans.data?.items ?? []).map((p) => ({ value: p.code, label: p.name }));
  const [statusReason, setStatusReason] = useState('');
  const [closeReason, setCloseReason] = useState('');
  const [confirmSlug, setConfirmSlug] = useState('');
  const [days, setDays] = useState('14');
  const [extendReason, setExtendReason] = useState('');
  const [planCode, setPlanCode] = useState(tenant.subscription?.planCode ?? 'GROWTH');
  const [planReason, setPlanReason] = useState('');
  const [payPlan, setPayPlan] = useState(tenant.subscription?.planCode ?? 'GROWTH');
  const [interval, setInterval] = useState<'MONTH' | 'YEAR'>('MONTH');
  const [amount, setAmount] = useState('');
  const [reference, setReference] = useState('');
  const [payReason, setPayReason] = useState('');
  const suspended = tenant.status === 'SUSPENDED';

  return (
    <Card title={t('platform.tenant.actions')}>
      <p className="mb-4 text-sm text-neutral-600">{t('platform.tenant.actionsHint')}</p>
      <div className="grid gap-4 lg:grid-cols-2">
        <ActionForm
          title={suspended ? t('platform.tenant.reinstate') : t('platform.tenant.suspend')}
          hint={suspended ? undefined : t('platform.tenant.suspendHint')}
          submitLabel={suspended ? t('platform.tenant.reinstate') : t('platform.tenant.suspend')}
          danger={!suspended}
          onSubmit={() =>
            suspended
              ? platformApi.reinstate(tenant.id, { reason: statusReason })
              : platformApi.suspend(tenant.id, { reason: statusReason })
          }
        >
          {(errors) => (
            <ReasonField value={statusReason} onChange={setStatusReason} error={errors.reason} />
          )}
        </ActionForm>

        <ActionForm
          title={t('platform.tenant.extend')}
          submitLabel={t('platform.tenant.extend')}
          onSubmit={() =>
            platformApi.extend(tenant.id, { days: Number(days), reason: extendReason })
          }
        >
          {(errors) => (
            <>
              <TextField
                label={t('platform.tenant.days')}
                inputMode="numeric"
                value={days}
                error={errors.days}
                onChange={(e) => setDays(e.target.value.replace(/\D/g, ''))}
              />
              <ReasonField value={extendReason} onChange={setExtendReason} error={errors.reason} />
            </>
          )}
        </ActionForm>

        <ActionForm
          title={t('platform.tenant.changePlan')}
          submitLabel={t('platform.tenant.changePlan')}
          onSubmit={() => platformApi.changePlan(tenant.id, { planCode, reason: planReason })}
        >
          {(errors) => (
            <>
              <SelectField
                label={t('platform.tenants.plan')}
                value={planCode}
                error={errors.planCode}
                options={planOptions}
                onChange={(e) => setPlanCode(e.target.value)}
              />
              <ReasonField value={planReason} onChange={setPlanReason} error={errors.reason} />
            </>
          )}
        </ActionForm>

        <ActionForm
          title={t('platform.tenant.recordPayment')}
          submitLabel={t('platform.tenant.recordPayment')}
          onSubmit={() =>
            platformApi.recordPayment(tenant.id, {
              planCode: payPlan,
              interval,
              amountMinor: Math.round(Number(amount || '0') * 100),
              reference,
              reason: payReason,
            })
          }
        >
          {(errors) => (
            <>
              <SelectField
                label={t('platform.tenants.plan')}
                value={payPlan}
                error={errors.planCode}
                options={planOptions}
                onChange={(e) => setPayPlan(e.target.value)}
              />
              <SelectField
                label={t('platform.tenant.interval')}
                value={interval}
                options={[
                  { value: 'MONTH', label: t('billing.monthly') },
                  { value: 'YEAR', label: t('billing.yearly') },
                ]}
                onChange={(e) => setInterval(e.target.value as 'MONTH' | 'YEAR')}
              />
              <TextField
                label={t('platform.tenant.amount')}
                inputMode="decimal"
                value={amount}
                error={errors.amountMinor}
                onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ''))}
              />
              <TextField
                label={t('platform.tenant.reference')}
                value={reference}
                error={errors.reference}
                onChange={(e) => setReference(e.target.value)}
              />
              <ReasonField value={payReason} onChange={setPayReason} error={errors.reason} />
            </>
          )}
        </ActionForm>

        <ActionForm
          title={t('platform.tenant.close')}
          hint={t('platform.tenant.closeHint', { slug: tenant.slug })}
          submitLabel={t('platform.tenant.close')}
          danger
          onSubmit={() => platformApi.close(tenant.id, { reason: closeReason, confirmSlug })}
        >
          {(errors) => (
            <>
              <ReasonField value={closeReason} onChange={setCloseReason} error={errors.reason} />
              <TextField
                label={t('platform.tenant.confirmSlug')}
                value={confirmSlug}
                error={errors.confirmSlug}
                onChange={(e) => setConfirmSlug(e.target.value)}
              />
            </>
          )}
        </ActionForm>
      </div>
    </Card>
  );
}
