import { COLLECTION_METHODS, type Customer } from '@pos/contracts';
import { type CurrencyCode, parseMoney } from '@pos/domain';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Printer, Wallet } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router';
import { Alert, Button, Card, SelectField, Skeleton, TextField } from '../../components/ui';
import { api } from '../../lib/api';
import { useAuthContext } from '../../lib/auth-store';
import { loyaltyRules } from '../../lib/loyalty';
import { useSettings } from '../../lib/settings';
import { ConsentCard } from './ConsentCard';
import { LoyaltyCard } from './LoyaltyCard';
import { useMoney } from '../../lib/catalog';
import { errorMessage } from '../../lib/errors';
import { newDocumentId } from '../../lib/inventory';
import { useBusinessDateTime, useMyOpenShift } from '../../lib/sales';
import { CustomerForm, customersKey, useBalanceText } from './CustomersPage';

export function CustomerDetailPage() {
  const { t } = useTranslation();
  const { id = '' } = useParams();
  const { tenant, permissions, features } = useAuthContext();
  const settings = useSettings();
  const loyaltyOn = !!loyaltyRules(settings.data, features);
  const queryClient = useQueryClient();
  const { format: money } = useMoney();
  const balanceText = useBalanceText();
  const customer = useQuery({ queryKey: ['customer', id], queryFn: () => api.customers.get(id) });
  const [mode, setMode] = useState<'view' | 'edit' | 'collect'>('view');
  const [notice, setNotice] = useState<string | null>(null);

  const refresh = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['customer', id] }),
      queryClient.invalidateQueries({ queryKey: ['statement', id] }),
      queryClient.invalidateQueries({ queryKey: customersKey(tenant.id) }),
    ]);
  };

  if (customer.isPending) return <Skeleton className="h-64 w-full" />;
  if (customer.isError) return <Alert tone="danger">{errorMessage(t, customer.error)}</Alert>;
  const c = customer.data;

  return (
    <div className="space-y-6">
      <Link
        to="/customers"
        className="inline-flex min-h-11 items-center gap-1 text-sm font-medium text-brand-800 hover:underline"
      >
        <ArrowLeft aria-hidden className="size-4" />
        {t('customers.back')}
      </Link>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-neutral-900">{c.name}</h1>
          <p className="text-sm text-neutral-600">
            <span className="font-mono">{c.number}</span>
            {c.phone ? ` · ${c.phone}` : ''}
            {c.email ? ` · ${c.email}` : ''}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {permissions.includes('customers.collect') && mode === 'view' && (
            <Button onClick={() => setMode('collect')}>
              <Wallet aria-hidden className="size-4" />
              {t('customers.collect')}
            </Button>
          )}
          {permissions.includes('customers.manage') && mode === 'view' && (
            <Button variant="secondary" onClick={() => setMode('edit')}>
              {t('customers.edit')}
            </Button>
          )}
        </div>
      </div>
      {notice && <Alert tone="success">{notice}</Alert>}
      <Card>
        <dl className="grid gap-4 sm:grid-cols-3">
          <div>
            <dt className="text-xs font-medium text-neutral-600">{t('customers.balance')}</dt>
            <dd
              className={`text-xl font-semibold tabular-nums ${c.balanceMinor > 0 ? 'text-warning-700' : ''}`}
              data-testid="customer-balance"
            >
              {balanceText(c.balanceMinor)}
            </dd>
          </div>
          <div>
            <dt className="text-xs font-medium text-neutral-600">{t('customers.creditLimit')}</dt>
            <dd className="text-xl tabular-nums">{money(c.creditLimitMinor)}</dd>
          </div>
          <div>
            <dt className="text-xs font-medium text-neutral-600">{t('pos.customer.label')}</dt>
            <dd className="text-sm">
              {t('customers.available', { amount: money(c.availableCreditMinor) })}
            </dd>
          </div>
        </dl>
      </Card>
      {mode === 'edit' && (
        <Card title={t('customers.edit')}>
          <CustomerForm
            customer={c}
            onCancel={() => setMode('view')}
            onSaved={async () => {
              setMode('view');
              setNotice(t('customers.saved'));
              await refresh();
            }}
          />
        </Card>
      )}
      {mode === 'collect' && (
        <CollectPayment
          customer={c}
          onCancel={() => setMode('view')}
          onDone={async (message) => {
            setMode('view');
            setNotice(message);
            await refresh();
          }}
        />
      )}
      <StatementCard customerId={c.id} />
      {loyaltyOn && <LoyaltyCard customerId={c.id} />}
      <ConsentCard customer={c} />
      <PurchaseHistory customerId={c.id} />
    </div>
  );
}

function CollectPayment({
  customer,
  onCancel,
  onDone,
}: {
  customer: Customer;
  onCancel: () => void;
  onDone: (message: string) => Promise<void>;
}) {
  const { t } = useTranslation();
  const { currency, format: money } = useMoney();
  // Wait for the shift to load before deciding cash cannot be taken.
  const { shift, isPending: shiftLoading } = useMyOpenShift();
  const [id] = useState(newDocumentId);
  const [method, setMethod] = useState<(typeof COLLECTION_METHODS)[number]>('CASH');
  const [amount, setAmount] = useState('');
  const [reference, setReference] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const parsed = parseMoney(amount, currency as CurrencyCode);
    if (!parsed.ok || parsed.minor === 0) return setError(t('validation.payment.amount_positive'));
    if (method === 'CASH' && !shift) return setError(t('customers.needShift'));
    setSaving(true);
    setError(null);
    try {
      const payment = await api.customers.collect(customer.id, {
        id,
        method,
        amountMinor: parsed.minor,
        reference: reference || null,
        ...(shift ? { shiftId: shift.id } : {}),
      });
      await onDone(
        t('customers.collected', {
          number: payment.number,
          balance: money(payment.balanceAfterMinor),
        }),
      );
    } catch (e) {
      setError(errorMessage(t, e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card title={t('customers.collectTitle', { name: customer.name })}>
      <form noValidate onSubmit={submit} className="grid max-w-xl gap-4 sm:grid-cols-2">
        {error && (
          <div className="sm:col-span-2">
            <Alert tone="danger">{error}</Alert>
          </div>
        )}
        <SelectField
          label={t('customers.collectMethod')}
          value={method}
          onChange={(e) => setMethod(e.target.value as typeof method)}
          options={COLLECTION_METHODS.map((m) => ({ value: m, label: t(`paymentMethods.${m}`) }))}
        />
        <TextField
          label={`${t('customers.collectAmount')} (${currency})`}
          inputMode="decimal"
          autoFocus
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
        />
        {method !== 'CASH' && (
          <TextField
            label={t('customers.collectReference')}
            hint={t('pos.referenceHint')}
            optional
            maxLength={40}
            value={reference}
            onChange={(e) => setReference(e.target.value)}
          />
        )}
        <div className="flex gap-2 sm:col-span-2">
          <Button variant="secondary" onClick={onCancel}>
            {t('customers.cancel')}
          </Button>
          <Button type="submit" loading={saving || shiftLoading}>
            {t('customers.collectSubmit')}
          </Button>
        </div>
      </form>
    </Card>
  );
}

function StatementCard({ customerId }: { customerId: string }) {
  const { t } = useTranslation();
  const { format: money } = useMoney();
  const dateTime = useBusinessDateTime();
  const [range, setRange] = useState<{ from?: string; to?: string }>({});
  const [draft, setDraft] = useState({ from: '', to: '' });
  const statement = useQuery({
    queryKey: ['statement', customerId, range],
    queryFn: () => api.customers.statement(customerId, range),
  });

  return (
    <Card title={t('customers.statement')}>
      <form
        className="mb-4 flex flex-wrap items-end gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          setRange({
            ...(draft.from ? { from: draft.from } : {}),
            ...(draft.to ? { to: draft.to } : {}),
          });
        }}
      >
        <TextField
          label={t('customers.from')}
          type="date"
          value={draft.from}
          onChange={(e) => setDraft({ ...draft, from: e.target.value })}
        />
        <TextField
          label={t('customers.to')}
          type="date"
          value={draft.to}
          onChange={(e) => setDraft({ ...draft, to: e.target.value })}
        />
        <Button type="submit" variant="secondary">
          {t('customers.show')}
        </Button>
        <Button variant="secondary" disabled={!statement.isSuccess} onClick={() => window.print()}>
          <Printer aria-hidden className="size-4" />
          {t('customers.print')}
        </Button>
      </form>
      {statement.isPending ? (
        <Skeleton className="h-24 w-full" />
      ) : statement.isError ? (
        <Alert tone="danger">{errorMessage(t, statement.error)}</Alert>
      ) : (
        <article className="print-area space-y-3 text-sm" aria-label={t('customers.statement')}>
          <header className="hidden print:block">
            <p className="text-base font-bold">{statement.data.business.name}</p>
            {statement.data.business.addressLines.map((line) => (
              <p key={line}>{line}</p>
            ))}
            <p className="mt-2 font-semibold">
              {statement.data.customer.name} · {statement.data.customer.number}
            </p>
          </header>
          <p className="text-neutral-600">
            {statement.data.from} – {statement.data.to}
          </p>
          <table className="w-full">
            <thead className="text-left text-xs font-medium text-neutral-600">
              <tr>
                <th scope="col" className="py-1 pr-2">
                  {t('sales.date')}
                </th>
                <th scope="col" className="py-1 pr-2">
                  {t('customers.entry')}
                </th>
                <th scope="col" className="py-1 pr-2 text-right">
                  {t('customers.amount')}
                </th>
                <th scope="col" className="py-1 text-right">
                  {t('customers.runningBalance')}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100">
              <tr>
                <td className="py-1 pr-2" colSpan={3}>
                  {t('customers.opening')}
                </td>
                <td className="py-1 text-right tabular-nums">
                  {money(statement.data.openingBalanceMinor)}
                </td>
              </tr>
              {statement.data.entries.length === 0 ? (
                <tr>
                  <td className="py-2 text-neutral-600" colSpan={4}>
                    {t('customers.noEntries')}
                  </td>
                </tr>
              ) : (
                statement.data.entries.map((entry) => (
                  <tr key={entry.id}>
                    <td className="py-1 pr-2">{dateTime(entry.createdAt)}</td>
                    <td className="py-1 pr-2">
                      {t(`customers.entryTypes.${entry.type}`)}{' '}
                      <span className="font-mono text-xs">{entry.referenceNumber}</span>
                    </td>
                    <td className="py-1 pr-2 text-right tabular-nums">
                      {money(entry.amountMinor)}
                    </td>
                    <td className="py-1 text-right tabular-nums">
                      {money(entry.balanceAfterMinor)}
                    </td>
                  </tr>
                ))
              )}
              <tr className="font-semibold">
                <td className="py-1 pr-2" colSpan={3}>
                  {t('customers.closing')}
                </td>
                <td className="py-1 text-right tabular-nums" data-testid="closing-balance">
                  {money(statement.data.closingBalanceMinor)}
                </td>
              </tr>
            </tbody>
          </table>
        </article>
      )}
    </Card>
  );
}

function PurchaseHistory({ customerId }: { customerId: string }) {
  const { t } = useTranslation();
  const { format: money } = useMoney();
  const dateTime = useBusinessDateTime();
  const sales = useQuery({
    queryKey: ['sales', 'customer', customerId],
    queryFn: () => api.sales.list({ customerId, limit: 25 }),
  });
  return (
    <Card title={t('customers.history')}>
      {sales.isPending ? (
        <Skeleton className="h-16 w-full" />
      ) : sales.isError ? (
        <Alert tone="danger">{errorMessage(t, sales.error)}</Alert>
      ) : sales.data.items.length === 0 ? (
        <p className="text-sm text-neutral-600">{t('customers.noHistory')}</p>
      ) : (
        <ul className="divide-y divide-neutral-100 text-sm">
          {sales.data.items.map((sale) => (
            <li key={sale.id} className="flex justify-between gap-2 py-2">
              <span>
                <Link to={`/sales/${sale.id}`} className="font-mono text-brand-800 hover:underline">
                  {sale.number}
                </Link>{' '}
                · {dateTime(sale.createdAt)}
              </span>
              <span className="tabular-nums">{money(sale.totalMinor)}</span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
