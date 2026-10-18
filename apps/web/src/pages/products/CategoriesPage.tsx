import { zodResolver } from '@hookform/resolvers/zod';
import { type Category, createCategoryRequestSchema } from '@pos/contracts';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowLeft } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { z } from 'zod';
import { Alert, Badge, Button, Card, SelectField, Skeleton, TextField } from '../../components/ui';
import { api } from '../../lib/api';
import { useAuthContext } from '../../lib/auth-store';
import { categoriesKey, useCategories } from '../../lib/catalog';
import { applyServerIssues, errorMessage } from '../../lib/errors';

const formSchema = z.object({
  name: createCategoryRequestSchema.shape.name,
  parentId: z.string(),
});
type FormInput = z.input<typeof formSchema>;
type FormOutput = z.output<typeof formSchema>;

export function CategoriesPage() {
  const { t } = useTranslation();
  const { tenant, permissions } = useAuthContext();
  const canManage = permissions.includes('products.manage');
  const categories = useCategories();
  const queryClient = useQueryClient();
  const [notice, setNotice] = useState<string | null>(null);
  const refresh = () => queryClient.invalidateQueries({ queryKey: categoriesKey(tenant.id) });

  const items = categories.data?.items ?? [];
  const topLevel = items.filter((c) => c.parentId === null);
  const ordered = topLevel.flatMap((parent) => [
    parent,
    ...items.filter((c) => c.parentId === parent.id),
  ]);

  return (
    <div className="space-y-6">
      <Link
        to="/products"
        className="inline-flex items-center gap-1 text-sm font-medium text-brand-700 hover:underline"
      >
        <ArrowLeft aria-hidden className="size-4" />
        {t('products.back')}
      </Link>
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-neutral-900">
          {t('categories.title')}
        </h1>
        <p className="mt-1 text-sm text-neutral-600">{t('categories.subtitle')}</p>
      </div>
      {notice && <Alert tone="success">{notice}</Alert>}

      {canManage && (
        <Card title={t('categories.add')}>
          <AddCategoryForm
            parents={topLevel.filter((c) => c.status === 'ACTIVE')}
            onAdded={() => {
              setNotice(t('categories.added'));
              return refresh();
            }}
          />
        </Card>
      )}

      {categories.isPending ? (
        <Card>
          <Skeleton className="h-24 w-full" />
        </Card>
      ) : categories.isError ? (
        <Alert
          tone="danger"
          action={
            <Button variant="secondary" onClick={() => void categories.refetch()}>
              {t('common.retry')}
            </Button>
          }
        >
          {errorMessage(t, categories.error)}
        </Alert>
      ) : ordered.length === 0 ? (
        <Card>
          <p className="text-sm text-neutral-600">{t('categories.empty')}</p>
        </Card>
      ) : (
        <Card>
          <ul className="divide-y divide-neutral-100">
            {ordered.map((category) => (
              <CategoryRow
                key={category.id}
                category={category}
                canManage={canManage}
                onSaved={() => {
                  setNotice(t('categories.saved'));
                  return refresh();
                }}
              />
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}

function AddCategoryForm({
  parents,
  onAdded,
}: {
  parents: Category[];
  onAdded: () => Promise<unknown>;
}) {
  const { t } = useTranslation();
  const [formError, setFormError] = useState<string | null>(null);
  const form = useForm<FormInput, unknown, FormOutput>({
    resolver: zodResolver(formSchema),
    defaultValues: { name: '', parentId: '' },
  });
  const onSubmit = form.handleSubmit(async (values) => {
    setFormError(null);
    try {
      await api.categories.create({ name: values.name, parentId: values.parentId || null });
      form.reset({ name: '', parentId: values.parentId });
      await onAdded();
    } catch (error) {
      if (!applyServerIssues(error, form.setError, ['name', 'parentId']))
        setFormError(errorMessage(t, error));
    }
  });
  return (
    <form
      noValidate
      onSubmit={onSubmit}
      className="grid gap-4 md:grid-cols-[1fr_1fr_auto] md:items-end"
    >
      {formError && (
        <div className="md:col-span-3">
          <Alert tone="danger">{formError}</Alert>
        </div>
      )}
      <TextField
        label={t('categories.name')}
        error={form.formState.errors.name?.message}
        {...form.register('name')}
      />
      <SelectField
        label={t('categories.parent')}
        options={[
          { value: '', label: t('categories.topLevel') },
          ...parents.map((p) => ({ value: p.id, label: p.name })),
        ]}
        {...form.register('parentId')}
      />
      <Button type="submit" loading={form.formState.isSubmitting}>
        {t('categories.add')}
      </Button>
    </form>
  );
}

function CategoryRow({
  category,
  canManage,
  onSaved,
}: {
  category: Category;
  canManage: boolean;
  onSaved: () => Promise<unknown>;
}) {
  const { t } = useTranslation();
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(category.name);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const archived = category.status === 'ARCHIVED';

  const save = async (patch: { name?: string; status?: 'ACTIVE' | 'ARCHIVED' }) => {
    setBusy(true);
    setError(null);
    try {
      await api.categories.update(category.id, { version: category.version, ...patch });
      setRenaming(false);
      await onSaved();
    } catch (err) {
      setError(errorMessage(t, err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <li
      className={`flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between ${category.parentId ? 'sm:pl-8' : ''}`}
    >
      {renaming ? (
        <form
          className="flex flex-1 gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            void save({ name });
          }}
        >
          <input
            aria-label={t('categories.name')}
            value={name}
            autoFocus
            onChange={(event) => setName(event.target.value)}
            className="min-h-11 flex-1 rounded-md border border-neutral-300 px-3"
          />
          <Button type="submit" loading={busy}>
            {t('products.save')}
          </Button>
          <Button variant="secondary" onClick={() => setRenaming(false)}>
            {t('products.cancel')}
          </Button>
        </form>
      ) : (
        <div className="flex items-center gap-2 text-sm">
          <span className="font-medium text-neutral-900">{category.name}</span>
          {archived && <Badge tone="warning">{t('products.status.ARCHIVED')}</Badge>}
        </div>
      )}
      {error && <span className="text-sm text-danger-700">{error}</span>}
      {canManage && !renaming && (
        <div className="flex gap-2">
          {!archived && (
            <Button
              variant="ghost"
              aria-label={`${t('categories.rename')} ${category.name}`}
              onClick={() => setRenaming(true)}
            >
              {t('categories.rename')}
            </Button>
          )}
          <Button
            variant="ghost"
            loading={busy}
            aria-label={`${archived ? t('categories.restore') : t('categories.archive')} ${category.name}`}
            onClick={() => void save({ status: archived ? 'ACTIVE' : 'ARCHIVED' })}
          >
            {archived ? t('categories.restore') : t('categories.archive')}
          </Button>
        </div>
      )}
    </li>
  );
}
