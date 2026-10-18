import { isApiError } from '@pos/api-client';
import type { PurchaseOrder } from '@pos/contracts';
import { fromMilli, minorToDecimalString, parseMoney, toMilli } from '@pos/domain';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router';
import { DocumentLines, type DocumentLine } from '../../components/DocumentLines';
import { ItemPicker } from '../../components/ItemPicker';
import { Alert, Button, Card, SelectField, TextField } from '../../components/ui';
import { api } from '../../lib/api';
import { useAuthContext } from '../../lib/auth-store';
import { useMoney } from '../../lib/catalog';
import { errorMessage } from '../../lib/errors';
import { inventoryKey, issuesByPath, newDocumentId, useSelectedBranch } from '../../lib/inventory';
import { useSettings } from '../../lib/settings';

export function ReceiveStockPage() {
  const { t } = useTranslation();
  const { tenant } = useAuthContext();
  const queryClient = useQueryClient();
  const settings = useSettings();
  const money = useMoney();
  const [params] = useSearchParams();
  const [branchId, setBranchId, branches] = useSelectedBranch();
  const [documentId, setDocumentId] = useState(newDocumentId);
  const [supplierId, setSupplierId] = useState('');
  const [orderId, setOrderId] = useState(params.get('po') ?? '');
  const [reference, setReference] = useState('');
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState<DocumentLine[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [feedback, setFeedback] = useState<{ tone: 'success' | 'danger'; message: string } | null>(
    null,
  );
  const [saving, setSaving] = useState(false);

  const suppliers = useQuery({
    queryKey: ['suppliers', tenant.id, 'active'],
    queryFn: () => api.suppliers.list({ limit: 100 }),
  });
  const orders = useQuery({
    queryKey: ['purchase-orders', tenant.id, 'receivable'],
    queryFn: async () => {
      const [ordered, partial] = await Promise.all([
        api.purchaseOrders.list({ status: 'ORDERED', limit: 100 }),
        api.purchaseOrders.list({ status: 'PARTIALLY_RECEIVED', limit: 100 }),
      ]);
      return [...ordered.items, ...partial.items];
    },
  });
  const profile = settings.data?.profile;
  const order = orders.data?.find((o) => o.id === orderId);

  // Receiving against an order: pre-fill its branch, supplier and what is still outstanding.
  useEffect(() => {
    if (!order) return;
    setBranchId(order.branchId);
    setSupplierId(order.supplierId);
    setLines(outstandingLines(order, money.currency));
    // Re-run only when a different order is chosen.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [order?.id]);

  const submit = async () => {
    setErrors({});
    setFeedback(null);
    const costIssues: Record<string, string> = {};
    const payloadLines = lines.map((line, index) => {
      const cost = parseMoney(line.unitCost ?? '', money.currency);
      if (!cost.ok) costIssues[`lines.${index}.unitCostMinor`] = `validation.money.${cost.issue}`;
      return {
        variantId: line.variantId,
        quantity: line.quantity,
        unitCostMinor: cost.ok ? cost.minor : 0,
        batchNumber: line.batchNumber ?? '',
        expiryDate: line.expiryDate || null,
      };
    });
    if (Object.keys(costIssues).length > 0) {
      setErrors(costIssues);
      return;
    }
    setSaving(true);
    try {
      const receipt = await api.goodsReceipts.create({
        id: documentId,
        branchId: branchId!,
        supplierId: supplierId || null,
        purchaseOrderId: orderId || null,
        supplierReference: reference,
        notes,
        lines: payloadLines,
      });
      setFeedback({
        tone: 'success',
        message: t('inventory.receive.posted', { number: receipt.number }),
      });
      setLines([]);
      setReference('');
      setNotes('');
      setOrderId('');
      setDocumentId(newDocumentId());
      await queryClient.invalidateQueries({ queryKey: inventoryKey(tenant.id) });
      await queryClient.invalidateQueries({ queryKey: ['purchase-orders', tenant.id] });
    } catch (error) {
      const issues = issuesByPath(error);
      setErrors(issues);
      if (Object.keys(issues).length === 0 || !isApiError(error))
        setFeedback({ tone: 'danger', message: errorMessage(t, error) });
      else if (issues.branchId || issues.supplierId || issues.purchaseOrderId) {
        setFeedback({
          tone: 'danger',
          message: t(issues.branchId ?? issues.supplierId ?? issues.purchaseOrderId!),
        });
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <Link
        to="/inventory"
        className="inline-flex items-center gap-1 text-sm font-medium text-brand-700 hover:underline"
      >
        <ArrowLeft aria-hidden className="size-4" />
        {t('inventory.title')}
      </Link>
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-neutral-900">
          {t('inventory.receive.title')}
        </h1>
        <p className="mt-1 text-sm text-neutral-600">{t('inventory.receive.subtitle')}</p>
      </div>
      {feedback && <Alert tone={feedback.tone}>{feedback.message}</Alert>}

      <Card>
        <div className="grid gap-4 md:grid-cols-2">
          <SelectField
            label={t('inventory.receive.purchaseOrder')}
            value={orderId}
            onChange={(event) => setOrderId(event.target.value)}
            options={[
              { value: '', label: t('inventory.receive.noOrder') },
              ...(orders.data ?? []).map((o) => ({
                value: o.id,
                label: `${o.number} · ${o.supplierName}`,
              })),
            ]}
          />
          <SelectField
            label={t('inventory.branch')}
            value={branchId ?? ''}
            disabled={!!order}
            onChange={(event) => setBranchId(event.target.value)}
            options={branches.map((b) => ({ value: b.id, label: b.name }))}
          />
          <SelectField
            label={t('inventory.receive.supplier')}
            value={supplierId}
            disabled={!!order}
            onChange={(event) => setSupplierId(event.target.value)}
            options={[
              { value: '', label: t('inventory.receive.noSupplier') },
              ...(suppliers.data?.items ?? []).map((s) => ({ value: s.id, label: s.name })),
            ]}
          />
          <TextField
            label={t('inventory.receive.reference')}
            optional
            value={reference}
            onChange={(e) => setReference(e.target.value)}
          />
        </div>
      </Card>

      <Card title={t('inventory.lines.title')}>
        <div className="space-y-4">
          {!order && (
            <ItemPicker
              onPick={(item) =>
                setLines((current) => [
                  ...current,
                  {
                    ...item,
                    quantity: '1',
                    unitCost:
                      item.costMinor === null
                        ? ''
                        : minorToDecimalString(item.costMinor, money.currency),
                  },
                ])
              }
            />
          )}
          <DocumentLines
            lines={lines}
            onChange={setLines}
            errors={errors}
            columns={{
              unitCost: { currency: money.currency },
              batch: profile?.trackBatchNumbers,
              expiry: profile?.trackExpiryDates,
            }}
          />
        </div>
      </Card>

      <Card>
        <TextField
          label={t('inventory.receive.notes')}
          optional
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />
      </Card>

      <div className="flex justify-end">
        <Button
          onClick={() => void submit()}
          loading={saving}
          disabled={lines.length === 0 || !branchId}
        >
          {t('inventory.receive.submit')}
        </Button>
      </div>
    </div>
  );
}

function outstandingLines(
  order: PurchaseOrder,
  currency: Parameters<typeof minorToDecimalString>[1],
): DocumentLine[] {
  return order.lines
    .map((line) => ({
      variantId: line.variantId,
      productName: line.productName,
      sku: line.sku,
      variantLabel: line.variantLabel,
      unit: line.unit,
      costMinor: line.unitCostMinor,
      quantity: fromMilli(
        Math.max(0, toMilli(line.quantityOrdered) - toMilli(line.quantityReceived)),
      ),
      unitCost: minorToDecimalString(line.unitCostMinor, currency),
    }))
    .filter((line) => toMilli(line.quantity) > 0);
}
