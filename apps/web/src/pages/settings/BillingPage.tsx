import type { BillingInvoice, BillingOverview, CheckoutResponse, Plan } from '@pos/contracts';
import { type CurrencyCode, daysLeft, formatMoney, PLAN_RESOURCES } from '@pos/domain';
import { INTL_LOCALES, isSupportedLanguage } from '@pos/i18n';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ShieldCheck } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';
import { Alert, Badge, Button, Card, Skeleton } from '../../components/ui';
import { api } from '../../lib/api';
import { authStore, useAuthContext } from '../../lib/auth-store';
import { errorMessage } from '../../lib/errors';

const POLL_MS = 3_000;
const POLL_LIMIT = 40;

/** Sends the browser to the provider's hosted checkout with a form POST. */
export function submitCheckout(redirect: CheckoutResponse['redirect']): void {
  const form = document.createElement('form');
  form.method = 'POST';
  form.action = redirect.url;
  form.style.display = 'none';
  for (const [name, value] of Object.entries(redirect.fields)) {
    const input = document.createElement('input');
    input.type = 'hidden';
    input.name = name;
    input.value = value;
    form.appendChild(input);
  }
  document.body.appendChild(form);
  form.submit();
}

function useFormatters() {
  const { i18n } = useTranslation();
  const locale = isSupportedLanguage(i18n.resolvedLanguage)
    ? INTL_LOCALES[i18n.resolvedLanguage]
    : 'en-LK';
  const dateFormat = new Intl.DateTimeFormat(locale, { dateStyle: 'medium' });
  return {
    money: (minor: number, currency: string) =>
      formatMoney(minor, currency as CurrencyCode, locale),
    date: (iso: string) => dateFormat.format(new Date(iso)),
  };
}

/** Settings › Plan & billing (owners). */
export function BillingPage() {
  const { t } = useTranslation();
  const { tenant, permissions } = useAuthContext();
  const queryClient = useQueryClient();
  const [params] = useSearchParams();
  const returning = params.get('checkout') === 'return' ? params.get('invoice') : null;
  const cancelledCheckout = params.get('checkout') === 'cancelled';
  const [polls, setPolls] = useState(0);
  const key = ['billing', tenant.id] as const;

  const overview = useQuery({
    queryKey: key,
    queryFn: () => api.billing.overview(),
    enabled: permissions.includes('billing.manage'),
    // After returning from the provider, wait for its notification to arrive.
    refetchInterval: (query) => {
      if (!returning || polls >= POLL_LIMIT) return false;
      const paid = query.state.data?.invoices.some(
        (i) => i.id === returning && i.status === 'PAID',
      );
      return paid ? false : POLL_MS;
    },
  });
  const paidNow =
    !!returning && !!overview.data?.invoices.some((i) => i.id === returning && i.status === 'PAID');

  useEffect(() => {
    if (returning && overview.dataUpdatedAt) setPolls((n) => n + 1);
  }, [returning, overview.dataUpdatedAt]);

  // Once paid, refresh the session context so banners and read-only mode clear.
  useEffect(() => {
    if (!paidNow) return;
    void api.auth.me().then((context) => authStore.updateContext(context));
  }, [paidNow]);

  if (!permissions.includes('billing.manage'))
    return <Alert tone="warning">{t('errors.FORBIDDEN')}</Alert>;

  if (overview.isPending)
    return (
      <Card>
        <div className="space-y-3" aria-busy="true" aria-label={t('common.loading')}>
          <Skeleton className="h-6 w-1/3" />
          <Skeleton className="h-24 w-full" />
        </div>
      </Card>
    );
  if (overview.isError)
    return (
      <Alert
        tone="danger"
        action={
          <Button variant="secondary" onClick={() => void overview.refetch()}>
            {t('common.retry')}
          </Button>
        }
      >
        {errorMessage(t, overview.error)}
      </Alert>
    );

  const data = overview.data;
  return (
    <div className="space-y-4">
      <p className="text-sm text-neutral-600">{t('billing.intro')}</p>
      {returning &&
        (paidNow ? (
          <Alert tone="success">{t('billing.confirmed')}</Alert>
        ) : (
          <Alert tone="info">{t('billing.confirming')}</Alert>
        ))}
      {cancelledCheckout && <Alert tone="warning">{t('billing.checkoutCancelled')}</Alert>}
      <SubscriptionCard
        data={data}
        onChanged={() => queryClient.invalidateQueries({ queryKey: key })}
      />
      <PlansCard data={data} />
      <InvoicesCard invoices={data.invoices} />
    </div>
  );
}

function SubscriptionCard({ data, onChanged }: { data: BillingOverview; onChanged: () => void }) {
  const { t } = useTranslation();
  const { date } = useFormatters();
  const [notice, setNotice] = useState<string | null>(null);
  const sub = data.subscription;
  const endDate = sub.status === 'TRIALING' ? sub.trialEndsAt : sub.currentPeriodEnd;
  const toggle = useMutation({
    mutationFn: () =>
      sub.cancelAtPeriodEnd ? api.billing.resume(sub.version) : api.billing.cancel(sub.version),
    onSuccess: (next) => {
      setNotice(
        next.cancelAtPeriodEnd
          ? t('billing.cancelScheduled', { date: endDate ? date(endDate) : '' })
          : t('billing.resumed'),
      );
      onChanged();
    },
  });
  const tone =
    sub.status === 'ACTIVE' || sub.status === 'TRIALING'
      ? 'success'
      : sub.status === 'PAST_DUE'
        ? 'warning'
        : 'neutral';
  const canChange = ['TRIALING', 'ACTIVE', 'PAST_DUE'].includes(sub.status);

  return (
    <Card title={t('billing.currentPlan')}>
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div className="space-y-1">
          <p className="flex flex-wrap items-center gap-2 text-lg font-semibold text-neutral-900">
            {sub.plan.name}
            <Badge tone={tone}>{t(`billing.status.${sub.status}`)}</Badge>
          </p>
          {sub.status === 'TRIALING' && sub.trialEndsAt && (
            <p className="text-sm text-neutral-700">
              {t('billing.trialEnds', {
                date: date(sub.trialEndsAt),
                days: daysLeft(new Date(sub.trialEndsAt), new Date()),
              })}
            </p>
          )}
          {sub.status === 'ACTIVE' && sub.currentPeriodEnd && (
            <p className="text-sm text-neutral-700">
              {t('billing.paidUntil', { date: date(sub.currentPeriodEnd) })}
            </p>
          )}
          {sub.status === 'PAST_DUE' && sub.graceEndsAt && (
            <p className="text-sm text-warning-700">
              {t('billing.graceUntil', { date: date(sub.graceEndsAt) })}
            </p>
          )}
          {(sub.status === 'SUSPENDED' || sub.status === 'CANCELLED') && (
            <p className="max-w-xl text-sm text-danger-700">{t('billing.readOnly')}</p>
          )}
          {sub.cancelAtPeriodEnd && endDate && canChange && (
            <p className="text-sm text-neutral-700">
              {t('billing.endsAt', { date: date(endDate) })}
            </p>
          )}
        </div>
        {canChange && (
          <Button
            variant="secondary"
            loading={toggle.isPending}
            onClick={() => {
              if (
                !sub.cancelAtPeriodEnd &&
                !window.confirm(t('billing.cancelConfirm', { date: endDate ? date(endDate) : '' }))
              )
                return;
              setNotice(null);
              toggle.mutate();
            }}
          >
            {sub.cancelAtPeriodEnd ? t('billing.resume') : t('billing.cancel')}
          </Button>
        )}
      </div>
      {notice && (
        <div className="mt-4">
          <Alert tone="success">{notice}</Alert>
        </div>
      )}
      {toggle.isError && (
        <div className="mt-4">
          <Alert tone="danger">{errorMessage(t, toggle.error)}</Alert>
        </div>
      )}

      <h3 className="mb-2 mt-6 text-sm font-semibold text-neutral-900">{t('billing.usage')}</h3>
      <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {PLAN_RESOURCES.map((resource) => {
          const used = data.usage[resource];
          const limit = sub.plan.limits[resource];
          const percent = Math.min(100, Math.round((used / Math.max(limit, 1)) * 100));
          return (
            <div key={resource} className="rounded-md border border-neutral-200 p-3">
              <dt className="text-xs text-neutral-600">{t(`billing.resources.${resource}`)}</dt>
              <dd className="text-sm font-medium text-neutral-900">
                {t('billing.usageOf', { used, limit })}
                <div
                  className="mt-2 h-1.5 rounded-full bg-neutral-100"
                  role="progressbar"
                  aria-label={t(`billing.resources.${resource}`)}
                  aria-valuemin={0}
                  aria-valuemax={limit}
                  aria-valuenow={used}
                >
                  <div
                    className={`h-1.5 rounded-full ${used >= limit ? 'bg-warning-600' : 'bg-brand-600'}`}
                    style={{ width: `${percent}%` }}
                  />
                </div>
              </dd>
            </div>
          );
        })}
      </dl>
    </Card>
  );
}

function PlansCard({ data }: { data: BillingOverview }) {
  const { t } = useTranslation();
  const { money } = useFormatters();
  const [interval, setInterval] = useState<'MONTH' | 'YEAR'>(data.subscription.interval);
  const [error, setError] = useState<string | null>(null);
  const checkout = useMutation({
    mutationFn: (plan: Plan) => api.billing.checkout({ planCode: plan.code, interval }),
    onSuccess: (result) => submitCheckout(result.redirect),
    onError: (err) => setError(errorMessage(t, err)),
  });
  const blocked = !data.paymentsAvailable
    ? t('billing.unavailable')
    : !data.emailVerified
      ? t('billing.verifyFirst')
      : null;

  return (
    <Card title={t('billing.plans')}>
      <fieldset className="mb-4 flex flex-wrap items-center gap-2">
        <legend className="sr-only">{t('billing.interval')}</legend>
        {(['MONTH', 'YEAR'] as const).map((value) => (
          <label
            key={value}
            className="flex min-h-11 cursor-pointer items-center gap-2 rounded-md border border-neutral-300 px-3 text-sm has-[:checked]:border-brand-600 has-[:checked]:bg-brand-50"
          >
            <input
              type="radio"
              name="interval"
              value={value}
              checked={interval === value}
              onChange={() => setInterval(value)}
              className="accent-brand-700"
            />
            {value === 'MONTH' ? t('billing.monthly') : t('billing.yearly')}
          </label>
        ))}
      </fieldset>
      {blocked && (
        <div className="mb-4">
          <Alert tone="warning">{blocked}</Alert>
        </div>
      )}
      {error && (
        <div className="mb-4">
          <Alert tone="danger">{error}</Alert>
        </div>
      )}
      {checkout.isSuccess && (
        <div className="mb-4">
          <Alert tone="info">{t('billing.redirecting')}</Alert>
        </div>
      )}
      <ul className="grid gap-4 md:grid-cols-3">
        {data.plans.map((plan) => {
          const current = plan.code === data.subscription.plan.code;
          const price = interval === 'YEAR' ? plan.priceYearlyMinor : plan.priceMonthlyMinor;
          return (
            <li
              key={plan.code}
              className={`flex flex-col gap-3 rounded-lg border p-4 ${current ? 'border-brand-600' : 'border-neutral-200'}`}
            >
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-base font-semibold text-neutral-900">{plan.name}</h3>
                {current && <Badge tone="success">{t('billing.current')}</Badge>}
              </div>
              <p className="text-lg font-semibold tabular-nums text-neutral-900">
                {interval === 'YEAR'
                  ? t('billing.perYear', { price: money(price, plan.currency) })
                  : t('billing.perMonth', { price: money(price, plan.currency) })}
              </p>
              <p className="text-sm text-neutral-600">
                {t('billing.includes', { ...plan.limits })}
              </p>
              <Button
                className="mt-auto"
                variant={current ? 'primary' : 'secondary'}
                disabled={!!blocked || checkout.isPending}
                loading={checkout.isPending && checkout.variables?.code === plan.code}
                onClick={() => {
                  setError(null);
                  checkout.mutate(plan);
                }}
              >
                {t('billing.pay', { plan: plan.name })}
              </Button>
            </li>
          );
        })}
      </ul>
      <p className="mt-4 flex items-center gap-2 text-xs text-neutral-600">
        <ShieldCheck aria-hidden className="size-4" />
        {t('billing.secure')}
      </p>
    </Card>
  );
}

function InvoicesCard({ invoices }: { invoices: BillingInvoice[] }) {
  const { t } = useTranslation();
  const { money, date } = useFormatters();
  return (
    <Card title={t('billing.invoices')}>
      {invoices.length === 0 ? (
        <p className="text-sm text-neutral-600">{t('billing.noInvoices')}</p>
      ) : (
        <div className="-mx-5 overflow-x-auto px-5">
          <table className="w-full min-w-[560px] text-left text-sm">
            <thead className="text-xs text-neutral-600">
              <tr>
                <th scope="col" className="py-2 pr-3 font-medium">
                  {t('billing.column.number')}
                </th>
                <th scope="col" className="py-2 pr-3 font-medium">
                  {t('billing.column.plan')}
                </th>
                <th scope="col" className="py-2 pr-3 font-medium">
                  {t('billing.column.period')}
                </th>
                <th scope="col" className="py-2 pr-3 text-right font-medium">
                  {t('billing.column.total')}
                </th>
                <th scope="col" className="py-2 font-medium">
                  {t('billing.column.status')}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-200">
              {invoices.map((invoice) => (
                <tr key={invoice.id}>
                  <td className="py-2 pr-3 font-medium">{invoice.number}</td>
                  <td className="py-2 pr-3">{invoice.planName}</td>
                  <td className="py-2 pr-3">
                    {invoice.periodStart && invoice.periodEnd
                      ? `${date(invoice.periodStart)} – ${date(invoice.periodEnd)}`
                      : '—'}
                  </td>
                  <td className="py-2 pr-3 text-right tabular-nums">
                    {money(invoice.totalMinor, invoice.currency)}
                  </td>
                  <td className="py-2">
                    <Badge tone={invoice.status === 'PAID' ? 'success' : 'neutral'}>
                      {t(`billing.invoiceStatus.${invoice.status}`)}
                    </Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
