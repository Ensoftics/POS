import type { PlatformPlan } from '@pos/contracts';
import { PLAN_RESOURCES } from '@pos/domain';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Alert,
  Badge,
  Button,
  Card,
  CheckboxField,
  Skeleton,
  TextField,
} from '../../components/ui';
import { errorMessage } from '../../lib/errors';
import { platformApi } from '../../lib/platform';
import { fieldErrors, usePlatformFormat } from './PlatformLayout';

type Draft = {
  code: string;
  name: string;
  monthly: string;
  yearly: string;
  branches: string;
  registers: string;
  staff: string;
  devices: string;
  isPublic: boolean;
};

const toDraft = (plan?: PlatformPlan): Draft => ({
  code: plan?.code ?? '',
  name: plan?.name ?? '',
  monthly: plan ? String(plan.priceMonthlyMinor / 100) : '',
  yearly: plan ? String(plan.priceYearlyMinor / 100) : '',
  branches: String(plan?.limits.branches ?? 1),
  registers: String(plan?.limits.registers ?? 1),
  staff: String(plan?.limits.staff ?? 1),
  devices: String(plan?.limits.devices ?? 0),
  isPublic: plan?.isPublic ?? false,
});
const minor = (value: string) => Math.round(Number(value || '0') * 100);

export function PlatformPlansPage() {
  const { t } = useTranslation();
  const { money } = usePlatformFormat();
  const plans = useQuery({ queryKey: ['platform', 'plans'], queryFn: () => platformApi.plans() });
  const [editing, setEditing] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight text-neutral-900">
          {t('platform.plans.title')}
        </h1>
        {editing === null && (
          <Button onClick={() => setEditing('')}>{t('platform.plans.create')}</Button>
        )}
      </div>
      <p className="max-w-3xl text-sm text-neutral-600">{t('platform.plans.intro')}</p>
      {notice && <Alert tone="success">{notice}</Alert>}
      {editing === '' && (
        <Card title={t('platform.plans.create')}>
          <PlanForm
            onDone={() => {
              setEditing(null);
              setNotice(t('platform.plans.saved'));
            }}
            onCancel={() => setEditing(null)}
          />
        </Card>
      )}
      {plans.isPending ? (
        <Skeleton className="h-40 w-full" />
      ) : plans.isError ? (
        <Alert tone="danger">{errorMessage(t, plans.error)}</Alert>
      ) : (
        <ul className="grid gap-4 lg:grid-cols-2">
          {plans.data.items.map((plan) => (
            <li
              key={plan.code}
              className="rounded-lg bg-white p-5 shadow-sm ring-1 ring-neutral-200"
            >
              {editing === plan.code ? (
                <PlanForm
                  plan={plan}
                  onDone={() => {
                    setEditing(null);
                    setNotice(t('platform.plans.saved'));
                  }}
                  onCancel={() => setEditing(null)}
                />
              ) : (
                <div className="space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-base font-semibold">{plan.name}</h2>
                    <Badge>{plan.code}</Badge>
                    <Badge tone={plan.isPublic ? 'success' : 'neutral'}>
                      {plan.isPublic ? t('platform.plans.public') : t('platform.plans.hidden')}
                    </Badge>
                  </div>
                  <p className="text-sm tabular-nums">
                    {t('billing.perMonth', { price: money(plan.priceMonthlyMinor, plan.currency) })}{' '}
                    · {t('billing.perYear', { price: money(plan.priceYearlyMinor, plan.currency) })}
                  </p>
                  <p className="text-sm text-neutral-600">
                    {t('billing.includes', { ...plan.limits })}
                  </p>
                  <p className="text-xs text-neutral-500">
                    {t('platform.plans.subscribers', { count: plan.subscribers })}
                  </p>
                  {editing === null && (
                    <Button
                      variant="secondary"
                      aria-label={`${t('platform.plans.edit')}: ${plan.name}`}
                      onClick={() => {
                        setNotice(null);
                        setEditing(plan.code);
                      }}
                    >
                      {t('platform.plans.edit')}
                    </Button>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function PlanForm({
  plan,
  onDone,
  onCancel,
}: {
  plan?: PlatformPlan;
  onDone: () => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<Draft>(toDraft(plan));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const set = (key: keyof Draft) => (event: React.ChangeEvent<HTMLInputElement>) =>
    setDraft({ ...draft, [key]: key === 'isPublic' ? event.target.checked : event.target.value });
  const limits = {
    branches: Number(draft.branches),
    registers: Number(draft.registers),
    staff: Number(draft.staff),
    devices: Number(draft.devices),
  };
  const save = useMutation({
    mutationFn: () =>
      plan
        ? platformApi.updatePlan(plan.code, {
            version: plan.version,
            name: draft.name,
            priceMonthlyMinor: minor(draft.monthly),
            priceYearlyMinor: minor(draft.yearly),
            limits,
            isPublic: draft.isPublic,
          })
        : platformApi.createPlan({
            code: draft.code,
            name: draft.name,
            priceMonthlyMinor: minor(draft.monthly),
            priceYearlyMinor: minor(draft.yearly),
            limits,
            isPublic: draft.isPublic,
          }),
    onMutate: () => setErrors({}),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['platform', 'plans'] });
      onDone();
    },
    onError: (error) => setErrors(fieldErrors(error)),
  });
  const submit = (event: FormEvent) => {
    event.preventDefault();
    save.mutate();
  };

  return (
    <form
      noValidate
      onSubmit={submit}
      className="space-y-3"
      aria-label={plan?.name ?? t('platform.plans.create')}
    >
      {save.isError && Object.keys(errors).length === 0 && (
        <Alert tone="danger">{errorMessage(t, save.error)}</Alert>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        {!plan && (
          <TextField
            label={t('platform.plans.code')}
            className="uppercase"
            value={draft.code}
            error={errors.code}
            onChange={set('code')}
          />
        )}
        <TextField
          label={t('platform.plans.name')}
          value={draft.name}
          error={errors.name}
          onChange={set('name')}
        />
        <TextField
          label={t('platform.plans.monthly')}
          inputMode="decimal"
          value={draft.monthly}
          error={errors.priceMonthlyMinor}
          onChange={set('monthly')}
        />
        <TextField
          label={t('platform.plans.yearly')}
          inputMode="decimal"
          value={draft.yearly}
          error={errors.priceYearlyMinor}
          onChange={set('yearly')}
        />
        {PLAN_RESOURCES.map((resource) => (
          <TextField
            key={resource}
            label={t(`platform.plans.${resource}`)}
            inputMode="numeric"
            value={draft[resource]}
            error={errors[`limits.${resource}`]}
            onChange={set(resource)}
          />
        ))}
      </div>
      <CheckboxField
        label={t('platform.plans.public')}
        checked={draft.isPublic}
        onChange={set('isPublic')}
      />
      <div className="flex gap-2">
        <Button type="submit" loading={save.isPending}>
          {t('platform.plans.save')}
        </Button>
        <Button type="button" variant="secondary" onClick={onCancel}>
          {t('platform.plans.cancel')}
        </Button>
      </div>
    </form>
  );
}
