import { isApiError } from '@pos/api-client';
import { checkoutSettingsInputSchema, type TaxRate, type TenantSettings } from '@pos/contracts';
import { APPROVAL_PIN_PATTERN, formatPercent, parsePercent } from '@pos/domain';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';
import {
  Alert,
  Badge,
  Button,
  Card,
  CheckboxField,
  Skeleton,
  TextField,
} from '../../components/ui';
import { api } from '../../lib/api';
import { useAuthContext } from '../../lib/auth-store';
import { errorMessage } from '../../lib/errors';
import { taxRatesKey, useTaxRates } from '../../lib/sales';
import { type Feedback, useSettingsForm } from '../../lib/settings';
import { LoyaltySettingsCard } from './LoyaltySettingsCard';
import { SettingsForm } from './SettingsForm';
import { useSettingsContext } from './SettingsLayout';

const schema = z.object({
  checkout: checkoutSettingsInputSchema.omit({ discountApprovalBp: true }).extend({
    /** Percent text; empty means discounts never need approval. */
    discountApproval: z.string().refine((v) => v.trim() === '' || parsePercent(v) !== null, {
      error: 'validation.percent.invalid',
    }),
  }),
});

const toValues = (s: TenantSettings) => ({
  checkout: {
    pricesIncludeTax: s.checkout.pricesIncludeTax,
    allowNegativeStock: s.checkout.allowNegativeStock,
    receiptFooter: s.checkout.receiptFooter ?? '',
    refundsRequireApproval: s.checkout.refundsRequireApproval,
    discountApproval:
      s.checkout.discountApprovalBp === null ? '' : formatPercent(s.checkout.discountApprovalBp),
  },
});

const toRequest = (values: z.output<typeof schema>) => {
  const { discountApproval, ...checkout } = values.checkout;
  return {
    checkout: {
      ...checkout,
      discountApprovalBp: discountApproval.trim() === '' ? null : parsePercent(discountApproval),
    },
  };
};

export function CheckoutSettingsPage() {
  const { t } = useTranslation();
  const settings = useSettingsContext();
  const { form, onSubmit, feedback, canEdit, saving } = useSettingsForm({
    schema,
    settings,
    toValues,
    toRequest,
  });
  const { errors } = form.formState;
  const { permissions } = useAuthContext();

  return (
    <div className="space-y-6">
      <TaxRatesCard canEdit={canEdit} />
      <section aria-labelledby="till-heading" className="space-y-3">
        <h2 id="till-heading" className="text-base font-semibold text-neutral-900">
          {t('checkoutSettings.till')}
        </h2>
        <SettingsForm onSubmit={onSubmit} canEdit={canEdit} saving={saving} feedback={feedback}>
          {(['pricesIncludeTax', 'allowNegativeStock'] as const).map((name) => (
            <div key={name}>
              <CheckboxField
                label={t(`checkoutSettings.${name}`)}
                {...form.register(`checkout.${name}`)}
              />
              <p className="ml-8 text-xs text-neutral-600">{t(`checkoutSettings.${name}Hint`)}</p>
            </div>
          ))}
          <TextField
            label={t('checkoutSettings.receiptFooter')}
            hint={t('checkoutSettings.receiptFooterHint')}
            optional
            maxLength={300}
            error={errors.checkout?.receiptFooter?.message}
            {...form.register('checkout.receiptFooter')}
          />
          <h3 className="pt-2 text-sm font-semibold text-neutral-900">
            {t('checkoutSettings.approvals')}
          </h3>
          <TextField
            label={t('checkoutSettings.discountApproval')}
            hint={t('checkoutSettings.discountApprovalHint')}
            optional
            inputMode="decimal"
            error={errors.checkout?.discountApproval?.message}
            {...form.register('checkout.discountApproval')}
          />
          <div>
            <CheckboxField
              label={t('checkoutSettings.refundsRequireApproval')}
              {...form.register('checkout.refundsRequireApproval')}
            />
            <p className="ml-8 text-xs text-neutral-600">
              {t('checkoutSettings.refundsRequireApprovalHint')}
            </p>
          </div>
        </SettingsForm>
      </section>
      <LoyaltySettingsCard settings={settings} />
      {permissions.includes('approvals.grant') && <ApprovalPinCard />}
    </div>
  );
}

function TaxRatesCard({ canEdit }: { canEdit: boolean }) {
  const { t } = useTranslation();
  const { tenant } = useAuthContext();
  const queryClient = useQueryClient();
  const rates = useTaxRates();
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const refresh = () => queryClient.invalidateQueries({ queryKey: taxRatesKey(tenant.id) });

  const act = async (
    rate: TaxRate,
    patch: { isDefault?: boolean; status?: 'ACTIVE' | 'ARCHIVED' },
  ) => {
    setFeedback(null);
    try {
      await api.taxRates.update(rate.id, { version: rate.version, ...patch });
      setFeedback({ tone: 'success', message: t('checkoutSettings.rateSaved') });
    } catch (error) {
      setFeedback({ tone: 'danger', message: errorMessage(t, error) });
    }
    await refresh();
  };

  return (
    <Card title={t('checkoutSettings.taxRates')}>
      <div className="space-y-4">
        <p className="text-sm text-neutral-600">{t('checkoutSettings.taxRatesHint')}</p>
        {feedback && <Alert tone={feedback.tone}>{feedback.message}</Alert>}
        {rates.isPending ? (
          <Skeleton className="h-16 w-full" />
        ) : rates.isError ? (
          <Alert tone="danger">{errorMessage(t, rates.error)}</Alert>
        ) : rates.data.items.length === 0 ? (
          <p className="text-sm text-neutral-600">{t('checkoutSettings.noTaxRates')}</p>
        ) : (
          <ul className="-mx-5 divide-y divide-neutral-100">
            {rates.data.items.map((rate) => (
              <li key={rate.id} className="px-5 py-3">
                {editing === rate.id ? (
                  <RateForm
                    rate={rate}
                    onCancel={() => setEditing(null)}
                    onSaved={async () => {
                      setEditing(null);
                      setFeedback({ tone: 'success', message: t('checkoutSettings.rateSaved') });
                      await refresh();
                    }}
                  />
                ) : (
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex flex-wrap items-center gap-2 text-sm">
                      <span className="font-medium text-neutral-900">{rate.name}</span>
                      <span className="tabular-nums text-neutral-700">
                        {formatPercent(rate.rateBp)}%
                      </span>
                      {rate.isDefault && (
                        <Badge tone="success">{t('checkoutSettings.default')}</Badge>
                      )}
                      {rate.status === 'ARCHIVED' && (
                        <Badge tone="warning">{t('checkoutSettings.archived')}</Badge>
                      )}
                    </div>
                    {canEdit && (
                      <div className="flex flex-wrap gap-2">
                        {rate.status === 'ACTIVE' && !rate.isDefault && (
                          <Button
                            variant="ghost"
                            aria-label={`${t('checkoutSettings.makeDefault')}: ${rate.name}`}
                            onClick={() => void act(rate, { isDefault: true })}
                          >
                            {t('checkoutSettings.makeDefault')}
                          </Button>
                        )}
                        <Button
                          variant="ghost"
                          aria-label={`${t('checkoutSettings.edit')}: ${rate.name}`}
                          onClick={() => setEditing(rate.id)}
                        >
                          {t('checkoutSettings.edit')}
                        </Button>
                        <Button
                          variant="ghost"
                          aria-label={`${
                            rate.status === 'ACTIVE'
                              ? t('checkoutSettings.archive')
                              : t('checkoutSettings.restore')
                          }: ${rate.name}`}
                          onClick={() =>
                            void act(rate, {
                              status: rate.status === 'ACTIVE' ? 'ARCHIVED' : 'ACTIVE',
                            })
                          }
                        >
                          {rate.status === 'ACTIVE'
                            ? t('checkoutSettings.archive')
                            : t('checkoutSettings.restore')}
                        </Button>
                      </div>
                    )}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
        {canEdit &&
          (adding ? (
            <div className="rounded-md border border-neutral-200 p-4">
              <RateForm
                onCancel={() => setAdding(false)}
                onSaved={async () => {
                  setAdding(false);
                  setFeedback({ tone: 'success', message: t('checkoutSettings.rateAdded') });
                  await refresh();
                }}
              />
            </div>
          ) : (
            <Button variant="secondary" onClick={() => setAdding(true)}>
              <Plus aria-hidden className="size-4" />
              {t('checkoutSettings.addRate')}
            </Button>
          ))}
      </div>
    </Card>
  );
}

function RateForm({
  rate,
  onCancel,
  onSaved,
}: {
  rate?: TaxRate;
  onCancel: () => void;
  onSaved: () => Promise<void>;
}) {
  const { t } = useTranslation();
  const [name, setName] = useState(rate?.name ?? '');
  const [percent, setPercent] = useState(rate ? formatPercent(rate.rateBp) : '');
  const [isDefault, setIsDefault] = useState(rate?.isDefault ?? false);
  const [errors, setErrors] = useState<{ name?: string; rate?: string; form?: string }>({});
  const [saving, setSaving] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const rateBp = parsePercent(percent);
    const next = {
      ...(name.trim() ? {} : { name: 'validation.required' }),
      ...(rateBp === null ? { rate: 'validation.percent.invalid' } : {}),
    };
    setErrors(next);
    if (Object.keys(next).length > 0 || rateBp === null) return;
    setSaving(true);
    try {
      if (rate)
        await api.taxRates.update(rate.id, { version: rate.version, name, rateBp, isDefault });
      else await api.taxRates.create({ name, rateBp, isDefault });
      await onSaved();
    } catch (error) {
      if (isApiError(error) && error.issues.some((i) => i.path === 'name'))
        setErrors({ name: error.issues.find((i) => i.path === 'name')!.message });
      else setErrors({ form: errorMessage(t, error) });
    } finally {
      setSaving(false);
    }
  };

  return (
    <form noValidate onSubmit={submit} className="space-y-4">
      {errors.form && <Alert tone="danger">{errors.form}</Alert>}
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField
          label={t('checkoutSettings.name')}
          placeholder={t('checkoutSettings.namePlaceholder')}
          autoFocus
          maxLength={60}
          value={name}
          error={errors.name}
          onChange={(e) => setName(e.target.value)}
        />
        <TextField
          label={t('checkoutSettings.rate')}
          inputMode="decimal"
          value={percent}
          error={errors.rate}
          onChange={(e) => setPercent(e.target.value)}
        />
      </div>
      <CheckboxField
        label={t('checkoutSettings.isDefault')}
        checked={isDefault}
        onChange={(e) => setIsDefault(e.target.checked)}
      />
      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={onCancel}>
          {t('checkoutSettings.cancel')}
        </Button>
        <Button type="submit" loading={saving}>
          {t('checkoutSettings.save')}
        </Button>
      </div>
    </form>
  );
}

/** A manager's own approval PIN, entered on cashiers' screens to approve actions. */
function ApprovalPinCard() {
  const { t } = useTranslation();
  const status = useQuery({ queryKey: ['approval-pin'], queryFn: () => api.approvals.pinStatus() });
  const [password, setPassword] = useState('');
  const [pin, setPin] = useState('');
  const [errors, setErrors] = useState<{ pin?: string; password?: string; form?: string }>({});
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSaved(false);
    const next = {
      ...(APPROVAL_PIN_PATTERN.test(pin) ? {} : { pin: 'validation.pin.invalid' }),
      ...(password ? {} : { password: 'validation.required' }),
    };
    setErrors(next);
    if (Object.keys(next).length > 0) return;
    setSaving(true);
    try {
      await api.approvals.setPin({ currentPassword: password, pin });
      setSaved(true);
      setPassword('');
      setPin('');
      await status.refetch();
    } catch (error) {
      if (isApiError(error) && error.issues.some((i) => i.path === 'currentPassword'))
        setErrors({ password: 'validation.password.incorrect' });
      else setErrors({ form: errorMessage(t, error) });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card title={t('checkoutSettings.pinTitle')}>
      <form noValidate onSubmit={submit} className="max-w-md space-y-4">
        <p className="text-sm text-neutral-600">{t('checkoutSettings.pinHint')}</p>
        {status.isSuccess && (
          <Alert tone={status.data.hasPin ? 'success' : 'warning'}>
            {status.data.hasPin ? t('checkoutSettings.pinIsSet') : t('checkoutSettings.pinNotSet')}
          </Alert>
        )}
        {saved && <Alert tone="success">{t('checkoutSettings.pinSaved')}</Alert>}
        {errors.form && <Alert tone="danger">{errors.form}</Alert>}
        <TextField
          label={t('checkoutSettings.pin')}
          type="password"
          inputMode="numeric"
          autoComplete="off"
          maxLength={8}
          value={pin}
          error={errors.pin}
          onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
        />
        <TextField
          label={t('checkoutSettings.currentPassword')}
          type="password"
          autoComplete="current-password"
          value={password}
          error={errors.password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <Button type="submit" loading={saving}>
          {t('checkoutSettings.pinSave')}
        </Button>
      </form>
    </Card>
  );
}
