import { isApiError } from '@pos/api-client';
import type { PurchaseOrder } from '@pos/contracts';
import { minorToDecimalString, parseMoney } from '@pos/domain';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Plus } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useLocation, useNavigate, useParams } from 'react-router';
import { DocumentLines, type DocumentLine } from '../../components/DocumentLines';
import { ItemPicker } from '../../components/ItemPicker';
import { Alert, Badge, Button, Card, SelectField, Skeleton, TextField } from '../../components/ui';
import { api } from '../../lib/api';
import { useAuthContext } from '../../lib/auth-store';
import { useMoney } from '../../lib/catalog';
import { errorMessage } from '../../lib/errors';
import { issuesByPath, useSelectedBranch } from '../../lib/inventory';

const ordersKey = (tenantId: string) => ['purchase-orders', tenantId] as const;
const statusTone = (status: PurchaseOrder['status']) =>
  status === 'RECEIVED' ? 'success' : status === 'CANCELLED' ? 'neutral' : 'warning';

export function PurchaseOrdersPage() {
  const { t } = useTranslation();
  const { tenant } = useAuthContext();
  const money = useMoney();
  const orders = useQuery({
    queryKey: [...ordersKey(tenant.id), 'list'],
    queryFn: () => api.purchaseOrders.list({ limit: 50 }),
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-neutral-900">
            {t('purchasing.orders.title')}
          </h1>
          <p className="mt-1 text-sm text-neutral-600">{t('purchasing.orders.subtitle')}</p>
        </div>
        <div className="flex gap-2">
          <Link
            to="/purchasing/suppliers"
            className="inline-flex min-h-11 items-center rounded-md px-3 text-sm font-semibold text-neutral-700 hover:bg-neutral-100"
          >
            {t('purchasing.suppliers.title')}
          </Link>
          <Link
            to="/purchasing/orders/new"
            className="inline-flex min-h-11 items-center gap-2 rounded-md bg-brand-700 px-4 text-sm font-semibold text-white hover:bg-brand-800"
          >
            <Plus aria-hidden className="size-4" />
            {t('purchasing.orders.new')}
          </Link>
        </div>
      </div>
      {orders.isPending ? (
        <Card>
          <Skeleton className="h-24 w-full" />
        </Card>
      ) : orders.isError ? (
        <Alert
          tone="danger"
          action={
            <Button variant="secondary" onClick={() => void orders.refetch()}>
              {t('common.retry')}
            </Button>
          }
        >
          {errorMessage(t, orders.error)}
        </Alert>
      ) : orders.data.items.length === 0 ? (
        <Card>
          <p className="text-sm text-neutral-600">{t('purchasing.orders.empty')}</p>
        </Card>
      ) : (
        <Card>
          <ul className="-mx-5 divide-y divide-neutral-100">
            {orders.data.items.map((order) => (
              <li
                key={order.id}
                className="flex flex-col gap-1 px-5 py-3 text-sm sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <Link
                    to={`/purchasing/orders/${order.id}`}
                    className="font-mono font-semibold text-brand-800 hover:underline"
                  >
                    {order.number}
                  </Link>
                  <span>{order.supplierName}</span>
                  <span className="text-neutral-500">→ {order.branchName}</span>
                  <Badge tone={statusTone(order.status)}>
                    {t(`purchasing.orders.status.${order.status}`)}
                  </Badge>
                </div>
                <span className="font-semibold tabular-nums">{money.format(order.totalMinor)}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}

export function PurchaseOrderPage() {
  const { id } = useParams();
  return id ? <ExistingOrder id={id} /> : <NewOrder />;
}

function NewOrder() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { tenant } = useAuthContext();
  const money = useMoney();
  const [branchId, setBranchId, branches] = useSelectedBranch();
  const suppliers = useQuery({
    queryKey: ['suppliers', tenant.id, 'active'],
    queryFn: () => api.suppliers.list({ limit: 100 }),
  });
  const [supplierId, setSupplierId] = useState('');
  const [expectedDate, setExpectedDate] = useState('');
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState<DocumentLine[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const supplierOptions = suppliers.data?.items ?? [];

  const submit = async () => {
    setErrors({});
    setError(null);
    const costIssues: Record<string, string> = {};
    const payload = lines.map((line, index) => {
      const cost = parseMoney(line.unitCost ?? '', money.currency);
      if (!cost.ok) costIssues[`lines.${index}.unitCostMinor`] = `validation.money.${cost.issue}`;
      return {
        variantId: line.variantId,
        quantity: line.quantity.trim(),
        unitCostMinor: cost.ok ? cost.minor : 0,
      };
    });
    if (Object.keys(costIssues).length) return setErrors(costIssues);
    setSaving(true);
    try {
      const order = await api.purchaseOrders.create({
        supplierId: supplierId || supplierOptions[0]?.id || '',
        branchId: branchId!,
        expectedDate: expectedDate || null,
        notes,
        lines: payload,
      });
      navigate(`/purchasing/orders/${order.id}`, {
        replace: true,
        state: { created: order.number },
      });
    } catch (err) {
      const issues = issuesByPath(err);
      setErrors(issues);
      if (!Object.keys(issues).some((path) => path.startsWith('lines.'))) {
        setError(Object.values(issues)[0] ? t(Object.values(issues)[0]!) : errorMessage(t, err));
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <Link
        to="/purchasing/orders"
        className="inline-flex items-center gap-1 text-sm font-medium text-brand-700 hover:underline"
      >
        <ArrowLeft aria-hidden className="size-4" />
        {t('purchasing.orders.back')}
      </Link>
      <h1 className="text-2xl font-semibold tracking-tight text-neutral-900">
        {t('purchasing.orders.new')}
      </h1>
      {error && <Alert tone="danger">{error}</Alert>}
      {suppliers.isSuccess && supplierOptions.length === 0 ? (
        <Alert tone="info">
          {t('purchasing.orders.noSuppliers')}{' '}
          <Link to="/purchasing/suppliers" className="font-semibold underline">
            {t('purchasing.suppliers.add')}
          </Link>
        </Alert>
      ) : (
        <>
          <Card>
            <div className="grid gap-4 md:grid-cols-3">
              <SelectField
                label={t('purchasing.orders.supplier')}
                value={supplierId || supplierOptions[0]?.id || ''}
                onChange={(e) => setSupplierId(e.target.value)}
                options={supplierOptions.map((s) => ({ value: s.id, label: s.name }))}
              />
              <SelectField
                label={t('purchasing.orders.branch')}
                value={branchId ?? ''}
                onChange={(e) => setBranchId(e.target.value)}
                options={branches.map((b) => ({ value: b.id, label: b.name }))}
              />
              <TextField
                label={t('purchasing.orders.expectedDate')}
                optional
                type="date"
                value={expectedDate}
                onChange={(e) => setExpectedDate(e.target.value)}
              />
            </div>
          </Card>
          <Card title={t('inventory.lines.title')}>
            <div className="space-y-4">
              <ItemPicker
                onPick={(item) =>
                  setLines((current) =>
                    current.some((l) => l.variantId === item.variantId)
                      ? current
                      : [
                          ...current,
                          {
                            ...item,
                            quantity: '1',
                            unitCost:
                              item.costMinor === null
                                ? ''
                                : minorToDecimalString(item.costMinor, money.currency),
                          },
                        ],
                  )
                }
              />
              <DocumentLines
                lines={lines}
                onChange={setLines}
                errors={errors}
                columns={{ unitCost: { currency: money.currency } }}
              />
            </div>
          </Card>
          <Card>
            <TextField
              label={t('purchasing.orders.notes')}
              optional
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </Card>
          <div className="flex justify-end">
            <Button loading={saving} disabled={lines.length === 0} onClick={() => void submit()}>
              {t('purchasing.orders.saveDraft')}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}

function ExistingOrder({ id }: { id: string }) {
  const { t } = useTranslation();
  const { tenant } = useAuthContext();
  const queryClient = useQueryClient();
  const money = useMoney();
  const key = [...ordersKey(tenant.id), 'detail', id];
  const order = useQuery({ queryKey: key, queryFn: () => api.purchaseOrders.get(id) });
  const created = (useLocation().state as { created?: string } | null)?.created;
  const [notice, setNotice] = useState<{
    tone: 'success' | 'danger' | 'warning';
    message: string;
  } | null>(
    created
      ? { tone: 'success', message: t('purchasing.orders.created', { number: created }) }
      : null,
  );
  const [busy, setBusy] = useState<'order' | 'cancel' | null>(null);

  if (order.isPending)
    return (
      <Card>
        <Skeleton className="h-40 w-full" />
      </Card>
    );
  if (order.isError) {
    return (
      <Alert
        tone="danger"
        action={
          <Button variant="secondary" onClick={() => void order.refetch()}>
            {t('common.retry')}
          </Button>
        }
      >
        {errorMessage(t, order.error)}
      </Alert>
    );
  }
  const data = order.data;

  const act = async (action: 'order' | 'cancel') => {
    if (
      action === 'cancel' &&
      !window.confirm(t('purchasing.orders.cancelConfirm', { number: data.number }))
    )
      return;
    setBusy(action);
    setNotice(null);
    try {
      const updated =
        action === 'order'
          ? await api.purchaseOrders.placeOrder(data.id, data.version)
          : await api.purchaseOrders.cancel(data.id, data.version);
      queryClient.setQueryData(key, updated);
      await queryClient.invalidateQueries({ queryKey: [...ordersKey(tenant.id), 'list'] });
    } catch (error) {
      if (isApiError(error) && error.code === 'VERSION_CONFLICT') await order.refetch();
      setNotice({ tone: 'danger', message: errorMessage(t, error) });
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-6">
      <Link
        to="/purchasing/orders"
        className="inline-flex items-center gap-1 text-sm font-medium text-brand-700 hover:underline"
      >
        <ArrowLeft aria-hidden className="size-4" />
        {t('purchasing.orders.back')}
      </Link>
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="font-mono text-2xl font-semibold text-neutral-900">{data.number}</h1>
        <Badge tone={statusTone(data.status)}>{t(`purchasing.orders.status.${data.status}`)}</Badge>
      </div>
      {notice && <Alert tone={notice.tone}>{notice.message}</Alert>}
      <Card>
        <dl className="grid gap-3 text-sm sm:grid-cols-3">
          <div>
            <dt className="text-neutral-600">{t('purchasing.orders.supplier')}</dt>
            <dd className="font-medium">{data.supplierName}</dd>
          </div>
          <div>
            <dt className="text-neutral-600">{t('purchasing.orders.branch')}</dt>
            <dd className="font-medium">{data.branchName}</dd>
          </div>
          <div>
            <dt className="text-neutral-600">{t('purchasing.orders.total')}</dt>
            <dd className="font-medium tabular-nums">{money.format(data.totalMinor)}</dd>
          </div>
        </dl>
      </Card>
      <Card title={t('inventory.lines.title')}>
        <div className="-mx-5 overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead className="border-b border-neutral-200 text-neutral-600">
              <tr>
                <th scope="col" className="px-5 py-2 font-medium">
                  {t('inventory.lines.item')}
                </th>
                <th scope="col" className="px-5 py-2 text-right font-medium">
                  {t('purchasing.orders.ordered')}
                </th>
                <th scope="col" className="px-5 py-2 text-right font-medium">
                  {t('purchasing.orders.received')}
                </th>
                <th scope="col" className="px-5 py-2 text-right font-medium">
                  {t('inventory.lines.unitCost')}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100">
              {data.lines.map((line) => (
                <tr key={line.id}>
                  <td className="px-5 py-2">
                    <div className="font-medium">
                      {line.productName}
                      {line.variantLabel && ` — ${line.variantLabel}`}
                    </div>
                    <div className="font-mono text-xs text-neutral-600">{line.sku}</div>
                  </td>
                  <td className="px-5 py-2 text-right tabular-nums">{line.quantityOrdered}</td>
                  <td className="px-5 py-2 text-right tabular-nums">{line.quantityReceived}</td>
                  <td className="px-5 py-2 text-right tabular-nums">
                    {money.format(line.unitCostMinor)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      <div className="flex flex-wrap justify-end gap-2">
        {['DRAFT', 'ORDERED', 'PARTIALLY_RECEIVED'].includes(data.status) && (
          <Button
            variant="danger"
            loading={busy === 'cancel'}
            disabled={busy !== null}
            onClick={() => void act('cancel')}
          >
            {t('purchasing.orders.cancel')}
          </Button>
        )}
        {data.status === 'DRAFT' && (
          <Button
            loading={busy === 'order'}
            disabled={busy !== null}
            onClick={() => void act('order')}
          >
            {t('purchasing.orders.placeOrder')}
          </Button>
        )}
        {['ORDERED', 'PARTIALLY_RECEIVED'].includes(data.status) && (
          <Link
            to={`/inventory/receive?po=${data.id}`}
            className="inline-flex min-h-11 items-center rounded-md bg-brand-700 px-4 text-sm font-semibold text-white hover:bg-brand-800"
          >
            {t('purchasing.orders.receive')}
          </Link>
        )}
      </div>
    </div>
  );
}
