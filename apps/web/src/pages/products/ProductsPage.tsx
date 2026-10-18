import { isApiError } from '@pos/api-client';
import type { Product } from '@pos/contracts';
import { useInfiniteQuery, useMutation } from '@tanstack/react-query';
import { Download, FolderTree, Plus, Search, Upload } from 'lucide-react';
import { useEffect, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router';
import { ProductThumb } from '../../components/ProductThumb';
import { Alert, Badge, Button, Card, SelectField, Skeleton } from '../../components/ui';
import { api } from '../../lib/api';
import { useAuthContext } from '../../lib/auth-store';
import { downloadText, productsKey, useCategories, useMoney } from '../../lib/catalog';
import { errorMessage } from '../../lib/errors';

const PAGE_SIZE = 25;

function useDebounced<T>(value: T, delay = 250): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

function priceRange(product: Product, format: (minor: number) => string): string {
  const prices = product.variants.map((v) => v.priceMinor);
  if (prices.length === 0) return '—';
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  return min === max ? format(min) : `${format(min)} – ${format(max)}`;
}

export function ProductsPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { tenant, permissions } = useAuthContext();
  const canManage = permissions.includes('products.manage');
  const canImport = permissions.includes('products.import');
  const money = useMoney();
  const categories = useCategories();
  const searchId = useId();

  const [text, setText] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [status, setStatus] = useState<'ACTIVE' | 'ARCHIVED' | 'ALL'>('ACTIVE');
  const [notice, setNotice] = useState<string | null>(null);
  const q = useDebounced(text.trim());

  const query = useInfiniteQuery({
    queryKey: [...productsKey(tenant.id), { q, categoryId, status }],
    queryFn: ({ pageParam }) =>
      api.products.list({
        q: q || undefined,
        categoryId: categoryId || undefined,
        status,
        cursor: pageParam,
        limit: PAGE_SIZE,
      }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
  });

  // Barcode scanners type the code and press Enter: open the exact match directly.
  const lookup = useMutation({
    mutationFn: (code: string) => api.products.lookup(code),
    onSuccess: (result) => navigate(`/products/${result.product.id}`),
    onError: (error, code) =>
      setNotice(
        isApiError(error) && error.code === 'NOT_FOUND'
          ? t('products.notFoundCode', { code })
          : errorMessage(t, error),
      ),
  });

  const exportCsv = useMutation({
    mutationFn: () => api.products.exportCsv(),
    onSuccess: (csv) =>
      downloadText(
        `products-${new Date().toISOString().slice(0, 10).replaceAll('-', '')}.csv`,
        csv,
      ),
    onError: (error) => setNotice(errorMessage(t, error)),
  });

  const items = query.data?.pages.flatMap((page) => page.items) ?? [];
  const filtering = q !== '' || categoryId !== '' || status !== 'ACTIVE';

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-neutral-900">
            {t('products.title')}
          </h1>
          <p className="mt-1 text-sm text-neutral-600">{t('products.subtitle')}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link
            to="/products/categories"
            className="inline-flex min-h-11 items-center gap-2 rounded-md px-3 text-sm font-semibold text-neutral-700 hover:bg-neutral-100"
          >
            <FolderTree aria-hidden className="size-4" />
            {t('products.categories')}
          </Link>
          {canImport && (
            <>
              <Button
                variant="secondary"
                loading={exportCsv.isPending}
                onClick={() => exportCsv.mutate()}
              >
                <Download aria-hidden className="size-4" />
                {t('products.export')}
              </Button>
              <Link
                to="/products/import"
                className="inline-flex min-h-11 items-center gap-2 rounded-md bg-white px-4 text-sm font-semibold text-neutral-800 ring-1 ring-neutral-300 hover:bg-neutral-100"
              >
                <Upload aria-hidden className="size-4" />
                {t('products.import')}
              </Link>
            </>
          )}
          {canManage && (
            <Link
              to="/products/new"
              className="inline-flex min-h-11 items-center gap-2 rounded-md bg-brand-700 px-4 text-sm font-semibold text-white hover:bg-brand-800"
            >
              <Plus aria-hidden className="size-4" />
              {t('products.add')}
            </Link>
          )}
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-[1fr_14rem_10rem]">
        <div className="space-y-1.5">
          <label htmlFor={searchId} className="block text-sm font-medium text-neutral-800">
            {t('products.search')}
          </label>
          <div className="relative">
            <Search
              aria-hidden
              className="pointer-events-none absolute left-3 top-3 size-5 text-neutral-400"
            />
            <input
              id={searchId}
              type="search"
              autoFocus
              autoComplete="off"
              aria-describedby={`${searchId}-hint`}
              value={text}
              onChange={(event) => {
                setText(event.target.value);
                setNotice(null);
              }}
              onKeyDown={(event) => {
                const code = text.trim();
                if (event.key === 'Enter' && code && !/\s/.test(code)) {
                  event.preventDefault();
                  lookup.mutate(code);
                }
              }}
              className="block min-h-11 w-full rounded-md border border-neutral-300 bg-white pl-10 pr-3 text-base focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-600/30"
            />
          </div>
          <p id={`${searchId}-hint`} className="text-xs text-neutral-600">
            {t('products.searchHint')}
          </p>
        </div>
        <SelectField
          label={t('products.category')}
          value={categoryId}
          onChange={(event) => setCategoryId(event.target.value)}
          options={[
            { value: '', label: t('products.allCategories') },
            ...(categories.data?.items ?? [])
              .filter((c) => c.status === 'ACTIVE')
              .map((c) => ({
                value: c.id,
                label: c.parentId ? `— ${c.name}` : c.name,
              })),
          ]}
        />
        <SelectField
          label={t('products.statusFilter')}
          value={status}
          onChange={(event) => setStatus(event.target.value as typeof status)}
          options={(['ACTIVE', 'ARCHIVED', 'ALL'] as const).map((value) => ({
            value,
            label: t(`products.status.${value}`),
          }))}
        />
      </div>

      {notice && <Alert tone="warning">{notice}</Alert>}

      {query.isPending ? (
        <Card>
          <div className="space-y-3" aria-busy="true" aria-label={t('common.loading')}>
            {Array.from({ length: 6 }, (_, index) => (
              <Skeleton key={index} className="h-8 w-full" />
            ))}
          </div>
        </Card>
      ) : query.isError ? (
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
      ) : items.length === 0 ? (
        <Card>
          <p className="text-sm text-neutral-600">
            {filtering ? t('products.noResults') : t('products.empty')}
          </p>
        </Card>
      ) : (
        <Card>
          {/* Phones: stacked rows so the price is never cut off. */}
          <ul className="-mx-5 divide-y divide-neutral-100 md:hidden">
            {items.map((product) => (
              <li key={product.id} className="px-5 py-3">
                <div className="flex items-start justify-between gap-3">
                  <ProductThumb url={product.images?.[0]?.thumbUrl} />
                  <div className="min-w-0 flex-1">
                    <Link
                      to={`/products/${product.id}`}
                      className="font-medium text-brand-800 hover:underline"
                    >
                      {product.name}
                    </Link>
                    <div className="text-xs text-neutral-600">
                      {[product.brand, product.categoryName].filter(Boolean).join(' · ')}
                    </div>
                    <div className="text-xs text-neutral-600">
                      {t('products.variantCount', { count: product.variants.length })}
                    </div>
                  </div>
                  <div className="shrink-0 text-right">
                    <div className="text-sm font-semibold tabular-nums">
                      {priceRange(product, money.format)}
                    </div>
                    {product.status !== 'ACTIVE' && (
                      <Badge tone="warning">{t(`products.status.${product.status}`)}</Badge>
                    )}
                  </div>
                </div>
              </li>
            ))}
          </ul>
          <div className="-mx-5 hidden overflow-x-auto md:block">
            <table className="min-w-full text-left text-sm">
              <thead className="border-b border-neutral-200 text-neutral-600">
                <tr>
                  <th scope="col" className="px-5 py-2 font-medium">
                    {t('products.columns.name')}
                  </th>
                  <th scope="col" className="px-5 py-2 font-medium">
                    {t('products.columns.category')}
                  </th>
                  <th scope="col" className="px-5 py-2 font-medium">
                    {t('products.columns.variants')}
                  </th>
                  <th scope="col" className="px-5 py-2 text-right font-medium">
                    {t('products.columns.price')}
                  </th>
                  <th scope="col" className="px-5 py-2 font-medium">
                    {t('products.columns.status')}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100">
                {items.map((product) => (
                  <tr key={product.id} className="hover:bg-neutral-50">
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-3">
                        <ProductThumb url={product.images?.[0]?.thumbUrl} size="sm" />
                        <div>
                          <Link
                            to={`/products/${product.id}`}
                            className="font-medium text-brand-800 hover:underline"
                          >
                            {product.name}
                          </Link>
                          {product.brand && (
                            <div className="text-xs text-neutral-600">{product.brand}</div>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="px-5 py-3 text-neutral-700">{product.categoryName ?? '—'}</td>
                    <td className="px-5 py-3 text-neutral-700">
                      {t('products.variantCount', { count: product.variants.length })}
                    </td>
                    <td className="whitespace-nowrap px-5 py-3 text-right tabular-nums">
                      {priceRange(product, money.format)}
                    </td>
                    <td className="px-5 py-3">
                      <Badge tone={product.status === 'ACTIVE' ? 'success' : 'warning'}>
                        {t(`products.status.${product.status}`)}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {query.hasNextPage && (
            <div className="mt-4 flex justify-center">
              <Button
                variant="secondary"
                onClick={() => void query.fetchNextPage()}
                loading={query.isFetchingNextPage}
              >
                {t('products.loadMore')}
              </Button>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
