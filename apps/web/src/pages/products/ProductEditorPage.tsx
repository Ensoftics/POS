import { zodResolver } from '@hookform/resolvers/zod';
import { isApiError } from '@pos/api-client';
import type { Product, TenantSettings, Variant } from '@pos/contracts';
import { type CurrencyCode, formatPercent, type UnitCode } from '@pos/domain';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import {
  type FieldErrors,
  type FieldValues,
  type Path,
  useFieldArray,
  useForm,
  type UseFormRegister,
  type UseFormSetError,
} from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { Link, useLocation, useNavigate, useParams } from 'react-router';
import { z } from 'zod';
import { Alert, Badge, Button, Card, SelectField, Skeleton, TextField } from '../../components/ui';
import { api } from '../../lib/api';
import { useAuthContext } from '../../lib/auth-store';
import {
  emptyVariant,
  formToVariantInput,
  productsKey,
  serverIssues,
  useCategories,
  useMoney,
  type VariantFormValues,
  variantFormSchema,
  variantToForm,
} from '../../lib/catalog';
import { errorMessage } from '../../lib/errors';
import { useTaxRates } from '../../lib/sales';
import { useSettings } from '../../lib/settings';
import { ProductImagesCard } from './ProductImagesCard';
import { VariantFields } from './VariantFields';

const productFieldsSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, { error: 'validation.required' })
    .max(120, { error: 'validation.text.too_long' }),
  brand: z.string().max(60, { error: 'validation.text.too_long' }),
  description: z.string().max(1000, { error: 'validation.text.too_long' }),
  unit: z.string().min(1, { error: 'validation.unit.invalid' }),
  categoryId: z.string(),
  taxRateId: z.string(),
});
type ProductFields = z.infer<typeof productFieldsSchema>;

function applyIssues<T extends FieldValues>(error: unknown, setError: UseFormSetError<T>): boolean {
  const issues = serverIssues(error);
  issues.forEach((issue, index) =>
    setError(
      issue.path as Path<T>,
      { type: 'server', message: issue.message },
      { shouldFocus: index === 0 },
    ),
  );
  return issues.length > 0;
}

/** Shared wrapper: waits for settings (currency, enabled options) before rendering forms. */
export function ProductEditorPage() {
  const { id } = useParams();
  const settings = useSettings();
  const { t } = useTranslation();

  if (settings.isPending) {
    return (
      <Card>
        <div className="space-y-3" aria-busy="true" aria-label={t('common.loading')}>
          <Skeleton className="h-8 w-1/3" />
          <Skeleton className="h-24 w-full" />
        </div>
      </Card>
    );
  }
  if (settings.isError) return <Alert tone="danger">{errorMessage(t, settings.error)}</Alert>;
  return id ? (
    <ExistingProduct id={id} settings={settings.data} />
  ) : (
    <NewProduct settings={settings.data} />
  );
}

function BackLink() {
  const { t } = useTranslation();
  return (
    <Link
      to="/products"
      className="inline-flex items-center gap-1 text-sm font-medium text-brand-700 hover:underline"
    >
      <ArrowLeft aria-hidden className="size-4" />
      {t('products.back')}
    </Link>
  );
}

function unitOptions(
  settings: TenantSettings,
  current: string | undefined,
  t: (key: string) => string,
) {
  const units = new Set<string>(settings.profile.defaultUnits);
  if (current) units.add(current);
  return [...units].map((unit) => ({ value: unit, label: t(`settings.profile.units.${unit}`) }));
}

function ProductFieldsSection({
  register,
  errors,
  settings,
  currentUnit,
  currentTaxRateId,
}: {
  register: UseFormRegister<ProductFields>;
  errors: FieldErrors<ProductFields>;
  settings: TenantSettings;
  currentUnit?: string;
  currentTaxRateId?: string | null;
}) {
  const { t } = useTranslation();
  const categories = useCategories();
  const taxRates = useTaxRates();
  const defaultRate = taxRates.data?.items.find((r) => r.isDefault);
  const taxOptions = [
    {
      value: '',
      label: defaultRate
        ? t('products.taxDefault', {
            name: defaultRate.name,
            rate: formatPercent(defaultRate.rateBp),
          })
        : t('products.taxNone'),
    },
    ...(taxRates.data?.items ?? [])
      .filter((r) => r.status === 'ACTIVE' || r.id === currentTaxRateId)
      .map((r) => ({ value: r.id, label: `${r.name} (${formatPercent(r.rateBp)}%)` })),
  ];
  const categoryOptions = [
    { value: '', label: t('products.noCategory') },
    ...(categories.data?.items ?? [])
      .filter((c) => c.status === 'ACTIVE')
      .map((c) => ({ value: c.id, label: c.parentId ? `— ${c.name}` : c.name })),
  ];
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <TextField
        label={t('products.name')}
        autoFocus
        error={errors.name?.message}
        {...register('name')}
      />
      <TextField
        label={t('products.brand')}
        optional
        error={errors.brand?.message}
        {...register('brand')}
      />
      <SelectField
        label={t('products.category')}
        options={categoryOptions}
        {...register('categoryId')}
      />
      <SelectField
        label={t('products.unit')}
        options={unitOptions(settings, currentUnit, t)}
        error={errors.unit?.message}
        {...register('unit')}
      />
      <SelectField
        label={t('products.taxRate')}
        hint={t('products.taxRateHint')}
        options={taxOptions}
        error={errors.taxRateId?.message}
        {...register('taxRateId')}
      />
      <div className="md:col-span-2">
        <TextField
          label={t('products.description')}
          optional
          error={errors.description?.message}
          {...register('description')}
        />
      </div>
    </div>
  );
}

/* New product -------------------------------------------------------------- */

function NewProduct({ settings }: { settings: TenantSettings }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { permissions } = useAuthContext();
  const currency = settings.currency as CurrencyCode;
  const [formError, setFormError] = useState<string | null>(null);

  const schema = productFieldsSchema.extend({
    variants: z
      .array(variantFormSchema(currency))
      .min(1, { error: 'validation.variants.required' }),
  });
  type FormValues = ProductFields & { variants: VariantFormValues[] };

  const form = useForm<FormValues>({
    resolver: zodResolver(schema) as never,
    defaultValues: {
      name: '',
      brand: '',
      description: '',
      unit: settings.profile.defaultUnits[0] ?? 'piece',
      categoryId: '',
      taxRateId: '',
      variants: [emptyVariant()],
    },
  });
  const variants = useFieldArray({ control: form.control, name: 'variants' });
  const { errors, isSubmitting } = form.formState;

  const onSubmit = form.handleSubmit(async (values) => {
    setFormError(null);
    try {
      const product = await api.products.create({
        name: values.name,
        brand: values.brand,
        description: values.description,
        unit: values.unit as UnitCode,
        categoryId: values.categoryId || null,
        taxRateId: values.taxRateId || null,
        variants: values.variants.map((variant) => formToVariantInput(variant, currency)),
      });
      navigate(`/products/${product.id}`, { replace: true, state: { created: true } });
    } catch (error) {
      if (!applyIssues(error, form.setError)) setFormError(errorMessage(t, error));
    }
  });

  return (
    <div className="space-y-6">
      <BackLink />
      <h1 className="text-2xl font-semibold tracking-tight text-neutral-900">
        {t('products.newTitle')}
      </h1>
      <form noValidate onSubmit={onSubmit} className="space-y-6">
        {formError && <Alert tone="danger">{formError}</Alert>}
        <Card title={t('products.details')}>
          <ProductFieldsSection
            register={form.register as unknown as UseFormRegister<ProductFields>}
            errors={errors}
            settings={settings}
          />
        </Card>
        <Card title={t('products.variants')}>
          <p className="mb-4 text-sm text-neutral-600">{t('products.variantsHint')}</p>
          {settings.profile.variantAttributes.length === 0 && (
            <p className="mb-4 text-xs text-neutral-600">{t('products.attributesNone')}</p>
          )}
          <ol className="space-y-6">
            {variants.fields.map((field, index) => (
              <li key={field.id} className="rounded-md border border-neutral-200 p-4">
                <div className="mb-3 flex items-center justify-between">
                  <span className="text-sm font-semibold text-neutral-800">#{index + 1}</span>
                  {variants.fields.length > 1 && (
                    <Button
                      variant="ghost"
                      aria-label={`${t('products.removeVariant')} #${index + 1}`}
                      onClick={() => variants.remove(index)}
                    >
                      <Trash2 aria-hidden className="size-4" />
                    </Button>
                  )}
                </div>
                <VariantFields
                  name={`variants.${index}.`}
                  register={form.register as never}
                  errors={errors.variants?.[index]}
                  attributes={settings.profile.variantAttributes}
                  currency={currency}
                  showCost={permissions.includes('products.manage')}
                />
              </li>
            ))}
          </ol>
          {errors.variants?.root?.message && (
            <p className="mt-2 text-sm text-danger-700">{t(errors.variants.root.message)}</p>
          )}
          <Button
            variant="secondary"
            className="mt-4"
            onClick={() => variants.append(emptyVariant())}
          >
            <Plus aria-hidden className="size-4" />
            {t('products.addVariant')}
          </Button>
        </Card>
        <div className="flex justify-end">
          <Button type="submit" loading={isSubmitting}>
            {t('products.save')}
          </Button>
        </div>
      </form>
    </div>
  );
}

/* Existing product -------------------------------------------------------- */

function ExistingProduct({ id, settings }: { id: string; settings: TenantSettings }) {
  const { t } = useTranslation();
  const { tenant, permissions } = useAuthContext();
  const queryClient = useQueryClient();
  const canManage = permissions.includes('products.manage');
  const justCreated = (useLocation().state as { created?: boolean } | null)?.created === true;
  const [notice, setNotice] = useState<{
    tone: 'success' | 'warning' | 'danger';
    message: string;
  } | null>(justCreated ? { tone: 'success', message: t('products.created') } : null);
  const [addingVariant, setAddingVariant] = useState(false);

  const key = [...productsKey(tenant.id), 'detail', id];
  const query = useQuery({ queryKey: key, queryFn: () => api.products.get(id) });

  const onSaved = (product: Product, message = t('products.saved')) => {
    queryClient.setQueryData(key, product);
    void queryClient.invalidateQueries({
      queryKey: productsKey(tenant.id),
      exact: false,
      refetchType: 'none',
    });
    setNotice({ tone: 'success', message });
  };
  const onConflict = async () => {
    await query.refetch();
    setNotice({ tone: 'warning', message: t('products.conflict') });
  };

  if (query.isPending) {
    return (
      <Card>
        <div className="space-y-3" aria-busy="true" aria-label={t('common.loading')}>
          <Skeleton className="h-8 w-1/3" />
          <Skeleton className="h-24 w-full" />
        </div>
      </Card>
    );
  }
  if (query.isError) {
    return (
      <div className="space-y-4">
        <BackLink />
        <Alert
          tone="danger"
          action={
            <Button variant="secondary" onClick={() => void query.refetch()}>
              {t('common.retry')}
            </Button>
          }
        >
          {errorMessage(t, query.error)}
        </Alert>
      </div>
    );
  }

  const product = query.data;
  return (
    <div className="space-y-6">
      <BackLink />
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold tracking-tight text-neutral-900">{product.name}</h1>
        <Badge tone={product.status === 'ACTIVE' ? 'success' : 'warning'}>
          {t(`products.status.${product.status}`)}
        </Badge>
      </div>
      {notice && <Alert tone={notice.tone}>{notice.message}</Alert>}

      <ProductDetailsForm
        product={product}
        settings={settings}
        canManage={canManage}
        onSaved={onSaved}
        onConflict={onConflict}
      />

      <ProductImagesCard product={product} canManage={canManage} onSaved={onSaved} />

      <Card title={t('products.variants')}>
        <ul className="divide-y divide-neutral-100">
          {product.variants.map((variant) => (
            <VariantRow
              key={variant.id}
              variant={variant}
              settings={settings}
              canManage={canManage}
              onSaved={onSaved}
              onConflict={onConflict}
            />
          ))}
        </ul>
        {canManage &&
          (addingVariant ? (
            <div className="mt-4 rounded-md border border-neutral-200 p-4">
              <VariantForm
                settings={settings}
                initial={emptyVariant()}
                onCancel={() => setAddingVariant(false)}
                onSubmit={async (input) => {
                  const updated = await api.variants.create({ productId: product.id, ...input });
                  setAddingVariant(false);
                  onSaved(updated);
                }}
              />
            </div>
          ) : (
            <Button variant="secondary" className="mt-4" onClick={() => setAddingVariant(true)}>
              <Plus aria-hidden className="size-4" />
              {t('products.addVariant')}
            </Button>
          ))}
      </Card>
    </div>
  );
}

function ProductDetailsForm({
  product,
  settings,
  canManage,
  onSaved,
  onConflict,
}: {
  product: Product;
  settings: TenantSettings;
  canManage: boolean;
  onSaved: (product: Product) => void;
  onConflict: () => Promise<void>;
}) {
  const { t } = useTranslation();
  const [formError, setFormError] = useState<string | null>(null);
  const [toggling, setToggling] = useState(false);
  const form = useForm<ProductFields>({
    resolver: zodResolver(productFieldsSchema),
    values: {
      name: product.name,
      brand: product.brand ?? '',
      description: product.description ?? '',
      unit: product.unit,
      categoryId: product.categoryId ?? '',
      taxRateId: product.taxRateId ?? '',
    },
  });

  const save = async (patch: Parameters<typeof api.products.update>[1]) => {
    setFormError(null);
    try {
      onSaved(await api.products.update(product.id, patch));
    } catch (error) {
      if (isApiError(error) && error.code === 'VERSION_CONFLICT') return onConflict();
      if (!applyIssues(error, form.setError)) setFormError(errorMessage(t, error));
    }
  };

  const onSubmit = form.handleSubmit((values) =>
    save({
      version: product.version,
      name: values.name,
      brand: values.brand,
      description: values.description,
      unit: values.unit as UnitCode,
      categoryId: values.categoryId || null,
      taxRateId: values.taxRateId || null,
    }),
  );

  const archived = product.status === 'ARCHIVED';
  return (
    <Card title={t('products.details')}>
      <form noValidate onSubmit={onSubmit} className="space-y-4">
        {formError && <Alert tone="danger">{formError}</Alert>}
        <fieldset disabled={!canManage} className="space-y-4">
          <ProductFieldsSection
            register={form.register}
            errors={form.formState.errors}
            settings={settings}
            currentUnit={product.unit}
            currentTaxRateId={product.taxRateId}
          />
        </fieldset>
        {canManage && (
          <div className="flex flex-wrap justify-end gap-2">
            <Button
              variant={archived ? 'secondary' : 'danger'}
              loading={toggling}
              onClick={async () => {
                if (
                  !archived &&
                  !window.confirm(t('products.archiveConfirm', { name: product.name }))
                )
                  return;
                setToggling(true);
                await save({ version: product.version, status: archived ? 'ACTIVE' : 'ARCHIVED' });
                setToggling(false);
              }}
            >
              {archived ? t('products.restore') : t('products.archive')}
            </Button>
            <Button type="submit" loading={form.formState.isSubmitting}>
              {t('products.save')}
            </Button>
          </div>
        )}
      </form>
    </Card>
  );
}

function VariantRow({
  variant,
  settings,
  canManage,
  onSaved,
  onConflict,
}: {
  variant: Variant;
  settings: TenantSettings;
  canManage: boolean;
  onSaved: (product: Product) => void;
  onConflict: () => Promise<void>;
}) {
  const { t } = useTranslation();
  const money = useMoney();
  const currency = settings.currency as CurrencyCode;
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const archived = variant.status === 'ARCHIVED';
  const options = Object.entries(variant.attributes)
    .map(([name, value]) => `${t(`settings.profile.attributes.${name}`)}: ${value}`)
    .join(' · ');

  if (editing) {
    return (
      <li className="py-4">
        <VariantForm
          settings={settings}
          initial={variantToForm(variant, currency)}
          onCancel={() => setEditing(false)}
          onSubmit={async (input) => {
            try {
              const updated = await api.variants.update(variant.id, {
                version: variant.version,
                ...input,
              });
              setEditing(false);
              onSaved(updated);
            } catch (err) {
              if (isApiError(err) && err.code === 'VERSION_CONFLICT') {
                setEditing(false);
                return onConflict();
              }
              throw err;
            }
          }}
        />
      </li>
    );
  }

  return (
    <li className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="space-y-0.5 text-sm">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono font-medium text-neutral-900">{variant.sku}</span>
          {archived && <Badge tone="warning">{t('products.status.ARCHIVED')}</Badge>}
        </div>
        {options && <div className="text-neutral-700">{options}</div>}
        {variant.barcode && (
          <div className="font-mono text-xs text-neutral-600">{variant.barcode}</div>
        )}
        {error && <div className="text-danger-700">{error}</div>}
      </div>
      <div className="flex items-center gap-3">
        <span className="font-semibold tabular-nums text-neutral-900">
          {money.format(variant.priceMinor)}
        </span>
        {canManage && (
          <>
            {!archived && (
              <Button
                variant="ghost"
                aria-label={`${t('products.editVariant')} ${variant.sku}`}
                onClick={() => setEditing(true)}
              >
                {t('products.editVariant')}
              </Button>
            )}
            <Button
              variant="ghost"
              aria-label={`${archived ? t('products.restoreVariant') : t('products.archiveVariant')} ${variant.sku}`}
              onClick={async () => {
                setError(null);
                try {
                  onSaved(
                    await api.variants.update(variant.id, {
                      version: variant.version,
                      status: archived ? 'ACTIVE' : 'ARCHIVED',
                    }),
                  );
                } catch (err) {
                  if (isApiError(err) && err.code === 'VERSION_CONFLICT') return onConflict();
                  setError(errorMessage(t, err));
                }
              }}
            >
              {archived ? t('products.restoreVariant') : t('products.archiveVariant')}
            </Button>
          </>
        )}
      </div>
    </li>
  );
}

function VariantForm({
  settings,
  initial,
  onSubmit,
  onCancel,
}: {
  settings: TenantSettings;
  initial: VariantFormValues;
  onSubmit: (input: ReturnType<typeof formToVariantInput>) => Promise<unknown>;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const { permissions } = useAuthContext();
  const currency = settings.currency as CurrencyCode;
  const [formError, setFormError] = useState<string | null>(null);
  const form = useForm<VariantFormValues>({
    resolver: zodResolver(variantFormSchema(currency)) as never,
    defaultValues: initial,
  });
  const attributes = [
    ...new Set([
      ...settings.profile.variantAttributes,
      ...(Object.keys(initial.attributes) as never[]),
    ]),
  ];

  const submit = form.handleSubmit(async (values) => {
    setFormError(null);
    try {
      await onSubmit(formToVariantInput(values, currency));
    } catch (error) {
      if (!applyIssues(error, form.setError)) setFormError(errorMessage(t, error));
    }
  });

  return (
    <form noValidate onSubmit={submit} className="space-y-4">
      {formError && <Alert tone="danger">{formError}</Alert>}
      <VariantFields
        name=""
        register={form.register as never}
        errors={form.formState.errors}
        attributes={attributes}
        currency={currency}
        showCost={permissions.includes('products.manage')}
        autoFocus
      />
      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={onCancel}>
          {t('products.cancel')}
        </Button>
        <Button type="submit" loading={form.formState.isSubmitting}>
          {t('products.saveVariant')}
        </Button>
      </div>
    </form>
  );
}
