import type { VariantAttribute } from '@pos/domain';
import type { FieldErrors, UseFormRegister } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { TextField } from '../../components/ui';
import type { VariantFormValues } from '../../lib/catalog';

type Errors = FieldErrors<VariantFormValues> | undefined;

/**
 * Inputs for one variant. `name` is the field prefix inside the parent form
 * (e.g. "variants.0." or "" for a standalone variant form).
 */
export function VariantFields({
  name,
  register,
  errors,
  attributes,
  currency,
  showCost,
  autoFocus,
}: {
  name: string;
  // The parent form decides the concrete field type; inputs only need register().
  register: UseFormRegister<never>;
  errors: Errors;
  attributes: readonly VariantAttribute[];
  currency: string;
  showCost: boolean;
  autoFocus?: boolean;
}) {
  const { t } = useTranslation();
  const field = (key: string) =>
    (register as unknown as UseFormRegister<Record<string, unknown>>)(`${name}${key}`);
  const attributeErrors = errors?.attributes as Record<string, { message?: string }> | undefined;

  return (
    <div className="space-y-4">
      {attributes.length > 0 && (
        <div className="grid gap-4 sm:grid-cols-3">
          {attributes.map((attribute) => (
            <TextField
              key={attribute}
              label={t(`settings.profile.attributes.${attribute}`)}
              optional
              error={attributeErrors?.[attribute]?.message}
              {...field(`attributes.${attribute}`)}
            />
          ))}
        </div>
      )}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <TextField
          label={t('products.sku')}
          className="uppercase"
          autoFocus={autoFocus}
          autoComplete="off"
          error={errors?.sku?.message}
          {...field('sku')}
        />
        <TextField
          label={t('products.barcode')}
          optional
          inputMode="text"
          autoComplete="off"
          error={errors?.barcode?.message}
          {...field('barcode')}
        />
        <TextField
          label={`${t('products.price')} (${currency})`}
          inputMode="decimal"
          autoComplete="off"
          className="tabular-nums"
          error={errors?.price?.message}
          {...field('price')}
        />
        {showCost && (
          <TextField
            label={`${t('products.cost')} (${currency})`}
            optional
            inputMode="decimal"
            autoComplete="off"
            className="tabular-nums"
            error={errors?.cost?.message}
            {...field('cost')}
          />
        )}
        <TextField
          label={t('products.packSize')}
          optional
          inputMode="numeric"
          error={errors?.packSize?.message}
          {...field('packSize')}
        />
        <TextField
          label={t('products.reorderLevel')}
          optional
          inputMode="decimal"
          error={errors?.reorderLevel?.message}
          {...field('reorderLevel')}
        />
      </div>
    </div>
  );
}
