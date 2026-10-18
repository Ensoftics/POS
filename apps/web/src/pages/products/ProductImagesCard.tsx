import { isApiError } from '@pos/api-client';
import { MAX_PRODUCT_IMAGES, PRODUCT_IMAGE_TYPES, type Product } from '@pos/contracts';
import { ImagePlus } from 'lucide-react';
import { type ChangeEvent, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Badge, Button, Card } from '../../components/ui';
import { api } from '../../lib/api';
import { errorMessage } from '../../lib/errors';

/** Product photos: shown to everyone, added, reordered and removed by managers. */
export function ProductImagesCard({
  product,
  canManage,
  onSaved,
}: {
  product: Product;
  canManage: boolean;
  onSaved: (product: Product, message: string) => void;
}) {
  const { t } = useTranslation();
  const inputId = useId();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const images = product.images ?? [];
  const full = images.length >= MAX_PRODUCT_IMAGES;

  const run = async (label: string, action: () => Promise<Product>, message: string) => {
    setBusy(label);
    setError(null);
    try {
      onSaved(await action(), message);
      return true;
    } catch (caught) {
      setError(uploadError(caught));
      return false;
    } finally {
      setBusy(null);
    }
  };

  const uploadError = (caught: unknown) => {
    const issue = isApiError(caught) ? caught.issues.find((i) => i.path === 'file') : undefined;
    return issue ? t(issue.message) : errorMessage(t, caught);
  };

  const onFiles = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = [...(event.target.files ?? [])];
    event.target.value = '';
    const room = MAX_PRODUCT_IMAGES - images.length;
    for (const file of files.slice(0, room)) {
      if (!(PRODUCT_IMAGE_TYPES as readonly string[]).includes(file.type)) {
        setError(t('validation.image.unsupported_type'));
        return;
      }
      const form = new FormData();
      form.append('file', file, file.name);
      const ok = await run(
        'upload',
        () => api.products.addImage(product.id, form),
        t('products.images.added'),
      );
      if (!ok) return;
    }
    if (files.length > room) setError(t('errors.IMAGE_LIMIT_REACHED'));
  };

  return (
    <Card title={t('products.images.title')}>
      <div className="space-y-4">
        {images.length === 0 ? (
          <p className="text-sm text-neutral-600">{t('products.images.empty')}</p>
        ) : (
          <ul
            className="grid grid-cols-2 gap-3 sm:grid-cols-4"
            aria-label={t('products.images.title')}
          >
            {images.map((image, index) => (
              <li key={image.id} className="space-y-2">
                <a href={image.url} target="_blank" rel="noreferrer" className="block">
                  <img
                    src={image.thumbUrl}
                    alt={t('products.images.alt', { name: product.name, number: index + 1 })}
                    width={image.width}
                    height={image.height}
                    loading="lazy"
                    className="aspect-square w-full rounded-md border border-neutral-200 bg-neutral-50 object-contain"
                  />
                </a>
                {index === 0 && <Badge tone="success">{t('products.images.main')}</Badge>}
                {canManage && (
                  <div className="flex flex-wrap gap-2">
                    {index > 0 && (
                      <Button
                        variant="secondary"
                        className="min-h-9 px-3 text-xs"
                        loading={busy === `main-${image.id}`}
                        disabled={busy !== null}
                        onClick={() =>
                          void run(
                            `main-${image.id}`,
                            () =>
                              api.products.reorderImages(product.id, [
                                image.id,
                                ...images.filter((other) => other.id !== image.id).map((o) => o.id),
                              ]),
                            t('products.images.mainSet'),
                          )
                        }
                      >
                        {t('products.images.makeMain')}
                      </Button>
                    )}
                    <Button
                      variant="secondary"
                      className="min-h-9 px-3 text-xs"
                      loading={busy === `remove-${image.id}`}
                      disabled={busy !== null}
                      aria-label={t('products.images.removeNumber', { number: index + 1 })}
                      onClick={() => {
                        if (!window.confirm(t('products.images.removeConfirm'))) return;
                        void run(
                          `remove-${image.id}`,
                          () => api.products.removeImage(product.id, image.id),
                          t('products.images.removed'),
                        );
                      }}
                    >
                      {t('products.images.remove')}
                    </Button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
        {error && <Alert tone="danger">{error}</Alert>}
        {canManage && (
          <div className="space-y-1">
            <input
              ref={input}
              id={inputId}
              type="file"
              accept={PRODUCT_IMAGE_TYPES.join(',')}
              multiple
              className="sr-only"
              aria-describedby={`${inputId}-hint`}
              onChange={(event) => void onFiles(event)}
              disabled={full || busy !== null}
            />
            <Button
              variant="secondary"
              loading={busy === 'upload'}
              disabled={full || busy !== null}
              onClick={() => input.current?.click()}
            >
              <ImagePlus aria-hidden className="size-4" />
              {t('products.images.add')}
            </Button>
            <p id={`${inputId}-hint`} className="text-xs text-neutral-600">
              {full
                ? t('errors.IMAGE_LIMIT_REACHED')
                : t('products.images.hint', { max: MAX_PRODUCT_IMAGES })}
            </p>
          </div>
        )}
      </div>
    </Card>
  );
}
