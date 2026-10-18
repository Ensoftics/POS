import { MAX_IMPORT_BYTES, PRODUCT_CSV_COLUMNS, type ProductImportResult } from '@pos/contracts';
import { toCsv } from '@pos/domain';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, FileDown } from 'lucide-react';
import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { Alert, Button, Card } from '../../components/ui';
import { api } from '../../lib/api';
import { useAuthContext } from '../../lib/auth-store';
import { downloadText, productsKey } from '../../lib/catalog';
import { errorMessage } from '../../lib/errors';
import { useSettings } from '../../lib/settings';

/** Reads a file as UTF-8 text, with a FileReader fallback for browsers without Blob.text(). */
function readFileText(file: File): Promise<string> {
  if (typeof file.text === 'function') return file.text();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(reader.error ?? new Error('Could not read file'));
    reader.readAsText(file, 'utf-8');
  });
}

export function ImportProductsPage() {
  const { t } = useTranslation();
  const { tenant } = useAuthContext();
  const settings = useSettings();
  const queryClient = useQueryClient();
  const fileId = useId();
  const [csv, setCsv] = useState<string | null>(null);
  const [fileName, setFileName] = useState('');
  const [report, setReport] = useState<ProductImportResult | null>(null);
  const [busy, setBusy] = useState<'check' | 'apply' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const attributes = settings.data?.profile.variantAttributes ?? [];

  const downloadTemplate = () => {
    const header = [...PRODUCT_CSV_COLUMNS, ...attributes.map((name) => `attr:${name}`)];
    const example = [
      'Example product',
      '',
      '',
      settings.data?.profile.defaultUnits[0] ?? 'piece',
      'SKU-001',
      '',
      '100.00',
      '',
      '',
      '',
      'ACTIVE',
      ...attributes.map(() => ''),
    ];
    downloadText('products-template.csv', `\uFEFF${toCsv([header, example])}`);
  };

  const run = async (dryRun: boolean) => {
    if (!csv) return;
    setBusy(dryRun ? 'check' : 'apply');
    setError(null);
    try {
      const result = await api.products.import({ csv, dryRun });
      setReport(result);
      if (result.applied) await queryClient.invalidateQueries({ queryKey: productsKey(tenant.id) });
    } catch (err) {
      setError(errorMessage(t, err));
    } finally {
      setBusy(null);
    }
  };

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
          {t('importProducts.title')}
        </h1>
        <p className="mt-1 max-w-3xl text-sm text-neutral-600">{t('importProducts.intro')}</p>
      </div>

      <Card title={t('importProducts.columns')}>
        <p className="text-sm text-neutral-700">{t('importProducts.columnsHelp')}</p>
        <Button variant="secondary" className="mt-4" onClick={downloadTemplate}>
          <FileDown aria-hidden className="size-4" />
          {t('importProducts.template')}
        </Button>
      </Card>

      <Card>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <label htmlFor={fileId} className="block text-sm font-medium text-neutral-800">
              {t('importProducts.file')}
            </label>
            <input
              id={fileId}
              type="file"
              accept=".csv,text/csv"
              aria-describedby={`${fileId}-hint`}
              className="block w-full text-sm file:mr-4 file:min-h-11 file:rounded-md file:border-0 file:bg-brand-50 file:px-4 file:font-semibold file:text-brand-800"
              onChange={async (event) => {
                const file = event.target.files?.[0];
                setReport(null);
                setError(null);
                setCsv(null);
                if (!file) return;
                if (file.size > MAX_IMPORT_BYTES) {
                  setError(t('importProducts.tooLarge'));
                  return;
                }
                setFileName(file.name);
                setCsv(await readFileText(file));
              }}
            />
            <p id={`${fileId}-hint`} className="text-xs text-neutral-600">
              {t('importProducts.fileHint')}
            </p>
          </div>
          {error && <Alert tone="danger">{error}</Alert>}
          <div className="flex flex-wrap gap-2">
            <Button disabled={!csv} loading={busy === 'check'} onClick={() => void run(true)}>
              {t('importProducts.check')}
            </Button>
            {report && report.dryRun && report.errors.length === 0 && (
              <Button loading={busy === 'apply'} onClick={() => void run(false)}>
                {t('importProducts.apply', { count: report.rows })}
              </Button>
            )}
          </div>
        </div>
      </Card>

      {report && (
        <Card title={fileName}>
          <div className="space-y-4">
            <p className="text-sm text-neutral-800">{t('importProducts.summary', report)}</p>
            {report.applied ? (
              <Alert tone="success">{t('importProducts.done')}</Alert>
            ) : report.errors.length === 0 ? (
              <Alert tone="info">{t('importProducts.ready')}</Alert>
            ) : (
              <>
                <Alert tone="danger">{t('importProducts.problems')}</Alert>
                <div className="-mx-5 max-h-96 overflow-auto">
                  <table className="min-w-full text-left text-sm">
                    <thead className="sticky top-0 border-b border-neutral-200 bg-white text-neutral-600">
                      <tr>
                        <th scope="col" className="px-5 py-2 font-medium">
                          {t('importProducts.line')}
                        </th>
                        <th scope="col" className="px-5 py-2 font-medium">
                          {t('importProducts.column')}
                        </th>
                        <th scope="col" className="px-5 py-2 font-medium">
                          {t('importProducts.problem')}
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-neutral-100">
                      {report.errors.map((issue, index) => (
                        <tr key={`${issue.row}-${issue.column}-${index}`}>
                          <td className="px-5 py-2 tabular-nums">{issue.row}</td>
                          <td className="px-5 py-2 font-mono text-xs">{issue.column ?? '—'}</td>
                          <td className="px-5 py-2">
                            {t(issue.message, { defaultValue: issue.message })}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </div>
        </Card>
      )}
    </div>
  );
}
