import { isApiError } from '@pos/api-client';
import type { Customer } from '@pos/contracts';
import { type CurrencyCode, minorToDecimalString, parseMoney } from '@pos/domain';
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Send } from 'lucide-react';
import { type FormEvent, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
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
import { useMoney } from '../../lib/catalog';
import { errorMessage } from '../../lib/errors';

export const customersKey = (tenantId: string) => ['customers', tenantId] as const;

/** "Owes 1,200.00" / "Store credit 300.00" / "Nothing owed". */
export function useBalanceText() {
  const { t } = useTranslation();
  const { format: money } = useMoney();
  return (balance: number) =>
    balance > 0
      ? t('customers.owes', { amount: money(balance) })
      : balance < 0
        ? t('customers.storeCredit', { amount: money(-balance) })
        : t('customers.settled');
}

export function CustomersPage() {
  const { t } = useTranslation();
  const { tenant, permissions, features } = useAuthContext();
  const queryClient = useQueryClient();
  const balanceText = useBalanceText();
  const [text, setText] = useState('');
  const [q, setQ] = useState('');
  const [owing, setOwing] = useState(false);
  const [adding, setAdding] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => setQ(text.trim()), 250);
    return () => clearTimeout(timer);
  }, [text]);

  const customers = useInfiniteQuery({
    queryKey: [...customersKey(tenant.id), { q, owing }],
    queryFn: ({ pageParam }) =>
      api.customers.list({
        ...(q ? { q } : {}),
        ...(owing ? { owing: 'true' as const } : {}),
        cursor: pageParam,
        limit: 25,
      }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
  const items = customers.data?.pages.flatMap((page) => page.items) ?? [];

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-neutral-900">
            {t('customers.title')}
          </h1>
          <p className="mt-1 text-sm text-neutral-600">{t('customers.subtitle')}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {permissions.includes('customers.message') && (features ?? []).includes('messaging') && (
            <Link
              to="/customers/messages"
              className="inline-flex min-h-11 items-center gap-2 rounded-md border border-neutral-300 bg-white px-4 text-sm font-semibold text-neutral-800 hover:bg-neutral-50"
            >
              <Send aria-hidden className="size-4" />
              {t('messaging.title')}
            </Link>
          )}
          {permissions.includes('customers.manage') && !adding && (
            <Button onClick={() => setAdding(true)}>
              <Plus aria-hidden className="size-4" />
              {t('customers.add')}
            </Button>
          )}
        </div>
      </div>
      {notice && <Alert tone="success">{notice}</Alert>}
      {adding && (
        <Card title={t('customers.add')}>
          <CustomerForm
            onCancel={() => setAdding(false)}
            onSaved={async () => {
              setAdding(false);
              setNotice(t('customers.added'));
              await queryClient.invalidateQueries({ queryKey: customersKey(tenant.id) });
            }}
          />
        </Card>
      )}
      <Card>
        <div className="grid gap-4 sm:grid-cols-[1fr_auto] sm:items-end">
          <TextField
            label={t('customers.search')}
            type="search"
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
          <CheckboxField
            label={t('customers.owingOnly')}
            checked={owing}
            onChange={(e) => setOwing(e.target.checked)}
          />
        </div>
      </Card>
      {customers.isPending ? (
        <Skeleton className="h-24 w-full" />
      ) : customers.isError ? (
        <Alert tone="danger">{errorMessage(t, customers.error)}</Alert>
      ) : items.length === 0 ? (
        <Card>
          <p className="text-sm text-neutral-600">{t('customers.empty')}</p>
        </Card>
      ) : (
        <Card>
          <ul className="-mx-5 divide-y divide-neutral-100">
            {items.map((customer) => (
              <li
                key={customer.id}
                className="flex flex-wrap items-center justify-between gap-2 px-5 py-3"
              >
                <div>
                  <Link
                    to={`/customers/${customer.id}`}
                    className="font-medium text-brand-800 hover:underline"
                  >
                    {customer.name}
                  </Link>
                  {customer.status === 'ARCHIVED' && (
                    <Badge tone="warning">{t('customers.archived')}</Badge>
                  )}
                  <p className="text-xs text-neutral-600">
                    <span className="font-mono">{customer.number}</span>
                    {customer.phone ? ` · ${customer.phone}` : ''}
                  </p>
                </div>
                <span
                  className={`text-sm tabular-nums ${customer.balanceMinor > 0 ? 'font-semibold text-warning-700' : 'text-neutral-700'}`}
                >
                  {balanceText(customer.balanceMinor)}
                </span>
              </li>
            ))}
          </ul>
          {customers.hasNextPage && (
            <div className="mt-4 flex justify-center">
              <Button variant="secondary" onClick={() => void customers.fetchNextPage()}>
                {t('sales.loadMore')}
              </Button>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}

/** Add or edit a customer. The credit limit is shown only to those who may set it. */
export function CustomerForm({
  customer,
  initialName,
  initialPhone,
  onCancel,
  onSaved,
}: {
  customer?: Customer;
  initialName?: string;
  initialPhone?: string;
  onCancel: () => void;
  onSaved: (customer: Customer) => Promise<void> | void;
}) {
  const { t } = useTranslation();
  const { permissions } = useAuthContext();
  const { currency } = useMoney();
  const canCredit = permissions.includes('customers.credit');
  const [values, setValues] = useState({
    name: customer?.name ?? initialName ?? '',
    phone: customer?.phone ?? initialPhone ?? '',
    email: customer?.email ?? '',
    address: customer?.address ?? '',
    notes: customer?.notes ?? '',
    marketingConsent: customer?.marketingConsent ?? false,
    consentNote: '',
    creditLimit: customer
      ? minorToDecimalString(customer.creditLimitMinor, currency as CurrencyCode)
      : '',
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const set = (key: keyof typeof values) => (e: { target: { value: string } }) =>
    setValues({ ...values, [key]: e.target.value });
  const consentChanged = values.marketingConsent !== (customer?.marketingConsent ?? false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setFormError(null);
    const limit = values.creditLimit.trim()
      ? parseMoney(values.creditLimit, currency as CurrencyCode)
      : null;
    const next: Record<string, string> = {};
    if (!values.name.trim()) next.name = 'validation.required';
    if (limit && !limit.ok) next.creditLimit = `validation.money.${limit.issue}`;
    setErrors(next);
    if (Object.keys(next).length > 0) return;
    const body = {
      name: values.name,
      phone: values.phone,
      email: values.email,
      address: values.address,
      notes: values.notes,
      marketingConsent: values.marketingConsent,
      // The note goes into the consent history, so only when consent changes.
      ...(consentChanged && values.consentNote.trim() ? { consentNote: values.consentNote } : {}),
      ...(canCredit && limit?.ok ? { creditLimitMinor: limit.minor } : {}),
    };
    setSaving(true);
    try {
      const saved = customer
        ? await api.customers.update(customer.id, { version: customer.version, ...body })
        : await api.customers.create(body);
      await onSaved(saved);
    } catch (error) {
      if (isApiError(error) && error.issues.length > 0)
        setErrors(Object.fromEntries(error.issues.map((i) => [i.path, i.message])));
      else if (isApiError(error) && error.code === 'DUPLICATE_PHONE')
        setErrors({ phone: 'errors.DUPLICATE_PHONE' });
      else setFormError(errorMessage(t, error));
    } finally {
      setSaving(false);
    }
  };

  return (
    <form noValidate onSubmit={submit} className="space-y-4">
      {formError && <Alert tone="danger">{formError}</Alert>}
      <div className="grid gap-4 md:grid-cols-2">
        <TextField
          label={t('customers.name')}
          autoFocus
          maxLength={120}
          value={values.name}
          error={errors.name}
          onChange={set('name')}
        />
        <TextField
          label={t('customers.phone')}
          hint={t('customers.phoneHint')}
          optional
          type="tel"
          value={values.phone}
          error={errors.phone}
          onChange={set('phone')}
        />
        <TextField
          label={t('customers.email')}
          optional
          type="email"
          value={values.email}
          error={errors.email}
          onChange={set('email')}
        />
        <TextField
          label={t('customers.address')}
          optional
          value={values.address}
          error={errors.address}
          onChange={set('address')}
        />
        {canCredit && (
          <TextField
            label={`${t('customers.creditLimit')} (${currency})`}
            hint={t('customers.creditLimitHint')}
            inputMode="decimal"
            value={values.creditLimit}
            error={errors.creditLimit}
            onChange={set('creditLimit')}
          />
        )}
        <TextField
          label={t('customers.notes')}
          optional
          value={values.notes}
          error={errors.notes}
          onChange={set('notes')}
        />
      </div>
      <div>
        <CheckboxField
          label={t('customers.marketingConsent')}
          checked={values.marketingConsent}
          onChange={(e) => setValues({ ...values, marketingConsent: e.target.checked })}
        />
        <p className="ml-8 text-xs text-neutral-600">{t('customers.marketingConsentHint')}</p>
        {consentChanged && (
          <div className="ml-8 mt-2 max-w-md">
            <TextField
              label={t('messaging.consentNote')}
              hint={t('messaging.consentNoteHint')}
              optional
              maxLength={300}
              value={values.consentNote}
              error={errors.consentNote}
              onChange={set('consentNote')}
            />
          </div>
        )}
      </div>
      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={onCancel}>
          {t('customers.cancel')}
        </Button>
        <Button type="submit" loading={saving}>
          {t('customers.save')}
        </Button>
      </div>
    </form>
  );
}
