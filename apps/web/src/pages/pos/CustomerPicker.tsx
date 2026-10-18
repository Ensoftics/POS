import type { Customer } from '@pos/contracts';
import { useQuery } from '@tanstack/react-query';
import { UserRound, X } from 'lucide-react';
import { useEffect, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '../../components/ui';
import { api } from '../../lib/api';
import { useAuthContext } from '../../lib/auth-store';
import { useMoney } from '../../lib/catalog';
import { CustomerForm, useBalanceText } from '../customers/CustomersPage';

/**
 * Attaches a customer to the sale: search by phone (any format), name or number,
 * or add a new customer without leaving the till.
 */
export function CustomerPicker({
  customer,
  onChange,
}: {
  customer: Customer | null;
  onChange: (customer: Customer | null) => void;
}) {
  const { t } = useTranslation();
  const { permissions } = useAuthContext();
  const { format: money } = useMoney();
  const balanceText = useBalanceText();
  const id = useId();
  const [text, setText] = useState('');
  const [q, setQ] = useState('');
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setQ(text.trim()), 250);
    return () => clearTimeout(timer);
  }, [text]);

  const results = useQuery({
    queryKey: ['customer-picker', q],
    queryFn: () => api.customers.list({ q, limit: 5 }),
    enabled: q.length >= 2 && !customer,
    retry: false,
  });

  if (!permissions.includes('customers.read')) return null;

  if (customer)
    return (
      <div
        className="flex items-start justify-between gap-2 rounded-md bg-brand-50 p-3 text-sm"
        data-testid="attached-customer"
      >
        <div>
          <p className="flex items-center gap-1 font-medium text-neutral-900">
            <UserRound aria-hidden className="size-4" />
            {customer.name}
          </p>
          <p className="text-xs text-neutral-700">{balanceText(customer.balanceMinor)}</p>
          {customer.availableCreditMinor > 0 && (
            <p className="text-xs text-neutral-700">
              {t('pos.customer.available', { amount: money(customer.availableCreditMinor) })}
            </p>
          )}
        </div>
        <button
          type="button"
          aria-label={t('pos.customer.remove')}
          onClick={() => onChange(null)}
          className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-md text-neutral-600 hover:bg-white"
        >
          <X aria-hidden className="size-4" />
        </button>
      </div>
    );

  if (adding) {
    const digits = /^[+\d\s()-]+$/.test(text.trim());
    return (
      <div className="rounded-md border border-neutral-200 p-3">
        <CustomerForm
          initialName={digits ? '' : text.trim()}
          initialPhone={digits ? text.trim() : ''}
          onCancel={() => setAdding(false)}
          onSaved={(created) => {
            setAdding(false);
            setText('');
            onChange(created);
          }}
        />
      </div>
    );
  }

  const items = results.data?.items ?? [];
  return (
    <div className="space-y-2">
      <label htmlFor={id} className="block text-sm font-medium text-neutral-800">
        {t('pos.customer.label')}
      </label>
      <input
        id={id}
        type="search"
        autoComplete="off"
        placeholder={t('pos.customer.search')}
        value={text}
        onChange={(e) => setText(e.target.value)}
        className="block min-h-11 w-full rounded-md border border-neutral-300 px-3 text-base focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-600/30"
      />
      {items.length > 0 && (
        <ul className="divide-y divide-neutral-100 rounded-md border border-neutral-200 bg-white">
          {items.map((c) => (
            <li key={c.id}>
              <button
                type="button"
                onClick={() => {
                  onChange(c);
                  setText('');
                }}
                className="flex min-h-11 w-full items-center justify-between gap-3 px-3 text-left text-sm hover:bg-neutral-50"
              >
                <span className="font-medium">{c.name}</span>
                <span className="text-xs text-neutral-600">{c.phone ?? c.number}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {q.length >= 2 && results.isSuccess && items.length === 0 && (
        <p className="text-sm text-neutral-600">{t('pos.customer.notFound')}</p>
      )}
      {permissions.includes('customers.manage') && (
        <Button variant="ghost" onClick={() => setAdding(true)}>
          {t('pos.customer.add')}
        </Button>
      )}
    </div>
  );
}
