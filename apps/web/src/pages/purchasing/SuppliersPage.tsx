import { zodResolver } from '@hookform/resolvers/zod';
import { createSupplierRequestSchema, type Supplier } from '@pos/contracts';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Mail, Phone, Plus } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import type { z } from 'zod';
import { Alert, Badge, Button, Card, Skeleton, TextField } from '../../components/ui';
import { api } from '../../lib/api';
import { useAuthContext } from '../../lib/auth-store';
import { applyServerIssues, errorMessage } from '../../lib/errors';

type FormInput = z.input<typeof createSupplierRequestSchema>;
type FormOutput = z.output<typeof createSupplierRequestSchema>;
const FIELDS = ['name', 'contactName', 'phone', 'email', 'address', 'taxNumber', 'notes'] as const;

export function SuppliersPage() {
  const { t } = useTranslation();
  const { tenant } = useAuthContext();
  const queryClient = useQueryClient();
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const key = ['suppliers', tenant.id, 'all'];
  const suppliers = useQuery({
    queryKey: key,
    queryFn: () => api.suppliers.list({ status: 'ALL', limit: 100 }),
  });
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['suppliers', tenant.id] });

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-neutral-900">
            {t('purchasing.suppliers.title')}
          </h1>
          <p className="mt-1 text-sm text-neutral-600">{t('purchasing.suppliers.subtitle')}</p>
        </div>
        {!adding && (
          <Button onClick={() => setAdding(true)}>
            <Plus aria-hidden className="size-4" />
            {t('purchasing.suppliers.add')}
          </Button>
        )}
      </div>
      {notice && <Alert tone="success">{notice}</Alert>}
      {adding && (
        <Card title={t('purchasing.suppliers.add')}>
          <SupplierForm
            onCancel={() => setAdding(false)}
            onSaved={async () => {
              setAdding(false);
              setNotice(t('purchasing.suppliers.added'));
              await refresh();
            }}
          />
        </Card>
      )}
      {suppliers.isPending ? (
        <Card>
          <Skeleton className="h-24 w-full" />
        </Card>
      ) : suppliers.isError ? (
        <Alert
          tone="danger"
          action={
            <Button variant="secondary" onClick={() => void suppliers.refetch()}>
              {t('common.retry')}
            </Button>
          }
        >
          {errorMessage(t, suppliers.error)}
        </Alert>
      ) : suppliers.data.items.length === 0 ? (
        <Card>
          <p className="text-sm text-neutral-600">{t('purchasing.suppliers.empty')}</p>
        </Card>
      ) : (
        <Card>
          <ul className="-mx-5 divide-y divide-neutral-100">
            {suppliers.data.items.map((supplier) => (
              <li key={supplier.id} className="px-5 py-3">
                {editing === supplier.id ? (
                  <SupplierForm
                    supplier={supplier}
                    onCancel={() => setEditing(null)}
                    onSaved={async () => {
                      setEditing(null);
                      setNotice(t('purchasing.suppliers.saved'));
                      await refresh();
                    }}
                  />
                ) : (
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <div className="text-sm">
                      <div className="flex items-center gap-2 font-medium text-neutral-900">
                        {supplier.name}
                        {supplier.status === 'ARCHIVED' && (
                          <Badge tone="warning">{t('products.status.ARCHIVED')}</Badge>
                        )}
                      </div>
                      <div className="flex flex-wrap gap-x-4 text-neutral-600">
                        {supplier.contactName && <span>{supplier.contactName}</span>}
                        {supplier.phone && (
                          <span className="inline-flex items-center gap-1">
                            <Phone aria-hidden className="size-3.5" />
                            {supplier.phone}
                          </span>
                        )}
                        {supplier.email && (
                          <span className="inline-flex items-center gap-1">
                            <Mail aria-hidden className="size-3.5" />
                            {supplier.email}
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <Button
                        variant="ghost"
                        aria-label={`${t('purchasing.suppliers.edit')} ${supplier.name}`}
                        onClick={() => setEditing(supplier.id)}
                      >
                        {t('purchasing.suppliers.edit')}
                      </Button>
                      <ArchiveButton supplier={supplier} onDone={refresh} />
                    </div>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}

function ArchiveButton({
  supplier,
  onDone,
}: {
  supplier: Supplier;
  onDone: () => Promise<unknown>;
}) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const archived = supplier.status === 'ARCHIVED';
  return (
    <Button
      variant="ghost"
      loading={busy}
      aria-label={`${archived ? t('purchasing.suppliers.restore') : t('purchasing.suppliers.archive')} ${supplier.name}`}
      onClick={async () => {
        setBusy(true);
        try {
          await api.suppliers.update(supplier.id, {
            version: supplier.version,
            status: archived ? 'ACTIVE' : 'ARCHIVED',
          });
          await onDone();
        } finally {
          setBusy(false);
        }
      }}
    >
      {archived ? t('purchasing.suppliers.restore') : t('purchasing.suppliers.archive')}
    </Button>
  );
}

function SupplierForm({
  supplier,
  onCancel,
  onSaved,
}: {
  supplier?: Supplier;
  onCancel: () => void;
  onSaved: () => Promise<void>;
}) {
  const { t } = useTranslation();
  const [formError, setFormError] = useState<string | null>(null);
  const form = useForm<FormInput, unknown, FormOutput>({
    resolver: zodResolver(createSupplierRequestSchema),
    defaultValues: Object.fromEntries(
      FIELDS.map((field) => [field, supplier?.[field] ?? '']),
    ) as FormInput,
  });
  const { errors, isSubmitting } = form.formState;
  const onSubmit = form.handleSubmit(async (values) => {
    setFormError(null);
    try {
      if (supplier)
        await api.suppliers.update(supplier.id, { version: supplier.version, ...values });
      else await api.suppliers.create(values);
      await onSaved();
    } catch (error) {
      if (!applyServerIssues(error, form.setError, FIELDS)) setFormError(errorMessage(t, error));
    }
  });
  return (
    <form noValidate onSubmit={onSubmit} className="space-y-4">
      {formError && <Alert tone="danger">{formError}</Alert>}
      <div className="grid gap-4 md:grid-cols-2">
        <TextField
          label={t('purchasing.suppliers.name')}
          autoFocus
          error={errors.name?.message}
          {...form.register('name')}
        />
        <TextField
          label={t('purchasing.suppliers.contactName')}
          optional
          error={errors.contactName?.message}
          {...form.register('contactName')}
        />
        <TextField
          label={t('purchasing.suppliers.phone')}
          optional
          type="tel"
          error={errors.phone?.message}
          {...form.register('phone')}
        />
        <TextField
          label={t('purchasing.suppliers.email')}
          optional
          type="email"
          error={errors.email?.message}
          {...form.register('email')}
        />
        <TextField
          label={t('purchasing.suppliers.address')}
          optional
          error={errors.address?.message}
          {...form.register('address')}
        />
        <TextField
          label={t('purchasing.suppliers.taxNumber')}
          optional
          error={errors.taxNumber?.message}
          {...form.register('taxNumber')}
        />
      </div>
      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={onCancel}>
          {t('locations.cancel')}
        </Button>
        <Button type="submit" loading={isSubmitting}>
          {t('locations.save')}
        </Button>
      </div>
    </form>
  );
}
