import { isApiError } from '@pos/api-client';
import type { Customer, Receipt, Sale, Shift, TaxRateList, TenantSettings } from '@pos/contracts';
import {
  addToCart,
  type Cart,
  cartQuantitiesValid,
  type CartItem,
  emptyCart,
  parseQuantity,
  PAYMENT_METHODS,
  priceCart,
  repriceCart,
  setCartDiscount,
  settlePayments,
  maxRedeemableMinor,
  minorToDecimalString,
  type CurrencyCode,
} from '@pos/domain';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { buildLocalReceipt, toCatalogCartItem, toOfflineSaleRequest } from '@pos/offline';
import { CheckCircle2, CloudOff, Printer, RefreshCw, Store } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useApproval } from '../../components/ApprovalDialog';
import { ItemPicker } from '../../components/ItemPicker';
import { ReceiptView } from '../../components/ReceiptView';
import { Alert, Button, Card, Skeleton } from '../../components/ui';
import { api } from '../../lib/api';
import { useAuthContext } from '../../lib/auth-store';
import { useMoney } from '../../lib/catalog';
import { errorMessage } from '../../lib/errors';
import { loyaltyRules } from '../../lib/loyalty';
import { newDocumentId } from '../../lib/inventory';
import { type OfflineStatus, useOfflineSync } from '../../lib/offline';

import {
  salesKey,
  shiftKey,
  toCartItem,
  useBusinessDateTime,
  useSelectedRegister,
} from '../../lib/sales';
import { CartTable } from './CartTable';
import { CustomerPicker } from './CustomerPicker';
import { DiscountInput } from './DiscountInput';
import {
  newPayment,
  parsePayments,
  type PaymentDraft,
  PaymentPanel,
  TotalsSummary,
} from './PaymentPanel';
import { CashMovementCard, CloseShiftCard, OpenShiftCard, ShiftSummaryList } from './ShiftPanels';

/* Cart persistence: a reload keeps the sale in progress, including its id, so a
 * sale whose confirmation was lost can be re-submitted without charging twice. */
const cartStorageKey = (tenantId: string, registerId: string) =>
  `pos.cart.${tenantId}.${registerId}`;

function loadCart(key: string): Cart {
  try {
    const raw = sessionStorage.getItem(key);
    if (raw) return JSON.parse(raw) as Cart;
  } catch {
    // Fall through to a new cart.
  }
  return emptyCart(newDocumentId());
}

function saveCart(key: string, cart: Cart) {
  try {
    if (cart.lines.length === 0) sessionStorage.removeItem(key);
    else sessionStorage.setItem(key, JSON.stringify(cart));
  } catch {
    // Non-fatal.
  }
}

export function CheckoutPage() {
  const { t } = useTranslation();
  const { tenant, user, permissions } = useAuthContext();
  const queryClient = useQueryClient();
  const register = useSelectedRegister();
  const [choosing, setChoosing] = useState(false);
  const registerId = register.selected?.registerId ?? null;
  const offline = useOfflineSync();

  // The register's shift, remembered so the till keeps working without a connection.
  const shift = useQuery({
    queryKey: shiftKey(tenant.id, registerId),
    queryFn: async () => {
      try {
        const result = await api.shifts.current(registerId!);
        await offline.engine.remember(`shift.${registerId}`, result);
        return result;
      } catch (error) {
        if (isApiError(error) && !error.isTransient) throw error;
        const cached = await offline.engine.recall<{ shift: Shift | null }>(`shift.${registerId}`);
        if (!cached) throw error;
        return cached;
      }
    },
    enabled: !!registerId,
  });
  const [closing, setClosing] = useState(false);
  const [cashing, setCashing] = useState(false);
  const [cashNotice, setCashNotice] = useState(false);
  const [closedShift, setClosedShift] = useState<Shift | null>(null);
  const { format: money, currency } = useMoney();
  const dateTime = useBusinessDateTime();
  const refreshShift = () =>
    queryClient.invalidateQueries({ queryKey: shiftKey(tenant.id, registerId) });

  const header = (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-neutral-900">{t('pos.title')}</h1>
        {register.selected && (
          <p className="mt-1 flex items-center gap-1 text-sm text-neutral-600">
            <Store aria-hidden className="size-4" />
            {register.selected.branch.name} › {register.selected.registerName}
          </p>
        )}
      </div>
      {register.selected && register.options.length > 1 && !choosing && (
        <Button variant="secondary" onClick={() => setChoosing(true)}>
          {t('pos.changeRegister')}
        </Button>
      )}
    </div>
  );

  if (register.isPending) return <Skeleton className="h-40 w-full" />;
  if (register.options.length === 0)
    return (
      <div className="space-y-6">
        {header}
        <Alert tone="warning">{t('pos.noRegisters')}</Alert>
      </div>
    );
  if (!register.selected || choosing)
    return (
      <div className="space-y-6">
        {header}
        <Card title={t('pos.chooseRegister')}>
          <ul className="grid gap-2 sm:grid-cols-2">
            {register.options.map((option) => (
              <li key={option.registerId}>
                <Button
                  variant={option.registerId === registerId ? 'primary' : 'secondary'}
                  block
                  onClick={() => {
                    register.choose(option.registerId);
                    setChoosing(false);
                  }}
                >
                  {option.label}
                </Button>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    );

  const current = shift.data?.shift ?? null;
  const mine =
    !!current && (current.openedById === user.id || permissions.includes('shifts.manage'));

  return (
    <div className="space-y-6">
      {header}
      <SyncBar offline={offline} />
      {closedShift && (
        <Alert tone="success">
          <p className="font-medium">{t('pos.shift.closed', { number: closedShift.number })}</p>
          <div className="mt-2 max-w-sm">
            <ShiftSummaryList shift={closedShift} money={money} />
            <p className="mt-1 text-sm font-semibold">
              {t('pos.shift.difference')}: {money(closedShift.differenceMinor ?? 0)}
            </p>
          </div>
        </Alert>
      )}
      {shift.isPending ? (
        <Skeleton className="h-40 w-full" />
      ) : shift.isError ? (
        <Alert
          tone="danger"
          action={
            <Button variant="secondary" onClick={() => void shift.refetch()}>
              {t('common.retry')}
            </Button>
          }
        >
          {errorMessage(t, shift.error)}
        </Alert>
      ) : !current ? (
        <OpenShiftCard
          registerId={register.selected.registerId}
          currency={currency}
          onOpened={(opened) => {
            setClosedShift(null);
            queryClient.setQueryData(shiftKey(tenant.id, registerId), { shift: opened });
          }}
        />
      ) : !mine ? (
        <Alert tone="warning">{t('pos.shift.otherCashier', { name: current.openedByName })}</Alert>
      ) : closing ? (
        <CloseShiftCard
          shift={current}
          currency={currency}
          money={money}
          onCancel={() => setClosing(false)}
          onStale={async () => {
            await refreshShift();
          }}
          onClosed={(closed) => {
            setClosing(false);
            setClosedShift(closed);
            queryClient.setQueryData(shiftKey(tenant.id, registerId), { shift: null });
          }}
        />
      ) : cashing ? (
        <CashMovementCard
          shift={current}
          currency={currency}
          onCancel={() => setCashing(false)}
          onRecorded={(updated) => {
            setCashing(false);
            setCashNotice(true);
            queryClient.setQueryData(shiftKey(tenant.id, registerId), { shift: updated });
          }}
        />
      ) : (
        <>
          {cashNotice && <Alert tone="success">{t('pos.shift.cashRecorded')}</Alert>}
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-white px-4 py-2 text-sm ring-1 ring-neutral-200">
            <span className="text-neutral-700">
              {t('pos.shift.openedBy', {
                number: current.number,
                name: current.openedByName,
                time: dateTime(current.openedAt),
              })}
            </span>
            <span className="flex gap-1">
              {permissions.includes('cash.manage') && (
                <Button
                  variant="ghost"
                  onClick={() => {
                    setCashNotice(false);
                    setCashing(true);
                  }}
                >
                  {t('pos.shift.cash')}
                </Button>
              )}
              <Button variant="ghost" onClick={() => setClosing(true)}>
                {t('pos.shift.close')}
              </Button>
            </span>
          </div>
          <Till
            key={register.selected.registerId}
            shift={current}
            registerId={register.selected.registerId}
            offline={offline}
            onSold={refreshShift}
          />
        </>
      )}
    </div>
  );
}

/** Settings and tax rates for pricing, from the server or this device's last copy. */
function useTillData(offline: OfflineStatus) {
  const { tenant } = useAuthContext();
  return useQuery({
    queryKey: ['till-data', tenant.id],
    queryFn: async (): Promise<{ settings: TenantSettings; taxRates: TaxRateList }> => {
      try {
        const [settings, taxRates] = await Promise.all([api.settings.get(), api.taxRates.list()]);
        return { settings, taxRates };
      } catch (error) {
        if (isApiError(error) && !error.isTransient) throw error;
        const [settings, taxRates] = await Promise.all([
          offline.engine.cachedSettings(),
          offline.engine.cachedTaxRates(),
        ]);
        if (!settings || !taxRates) throw error;
        return { settings, taxRates };
      }
    },
  });
}

function Till({
  shift,
  registerId,
  offline,
  onSold,
}: {
  shift: Shift;
  registerId: string;
  offline: OfflineStatus;
  onSold: () => Promise<void>;
}) {
  const { t } = useTranslation();
  const { tenant, user, permissions, features } = useAuthContext();
  const queryClient = useQueryClient();
  const tillData = useTillData(offline);
  const { format: money, currency } = useMoney();
  const storageKey = cartStorageKey(tenant.id, registerId);
  const [cart, setCart] = useState<Cart>(() => loadCart(storageKey));
  const [payments, setPayments] = useState<PaymentDraft[]>([newPayment()]);
  const [submitting, setSubmitting] = useState(false);
  const [notice, setNotice] = useState<{ tone: 'danger' | 'warning'; message: string } | null>(
    null,
  );
  const [paymentError, setPaymentError] = useState<string | null>(null);
  const [lineErrors, setLineErrors] = useState<Record<number, string>>({});
  const [cartDiscountError, setCartDiscountError] = useState<string | undefined>();
  const [completed, setCompleted] = useState<Sale | null>(null);
  const [savedOffline, setSavedOffline] = useState<Receipt | null>(null);
  const [customer, setCustomer] = useState<Customer | null>(null);
  const approval = useApproval();

  useEffect(() => saveCart(storageKey, cart), [storageKey, cart]);

  if (tillData.isPending) return <Skeleton className="h-64 w-full" />;
  if (tillData.isError) return <Alert tone="danger">{errorMessage(t, tillData.error)}</Alert>;
  const settings = { data: tillData.data.settings };
  const loyalty = loyaltyRules(settings.data, features);
  const taxRates = { data: tillData.data.taxRates };

  const { pricesIncludeTax } = settings.data.checkout;
  const allowFraction = settings.data.profile.allowFractionalQuantities;
  const canDiscount = permissions.includes('sales.discount');
  const totals = priceCart(cart, taxRates.data.items, pricesIncludeTax);
  const parsedPayments = parsePayments(payments, currency);
  const quantitiesOk =
    cartQuantitiesValid(cart) &&
    cart.lines.every((l) => parseQuantity(l.quantity, { allowFraction }).ok);
  const settlement = parsedPayments ? settlePayments(totals.totalMinor, parsedPayments) : null;
  const canComplete =
    cart.lines.length > 0 &&
    quantitiesOk &&
    totals.issues.length === 0 &&
    !!settlement?.ok &&
    !submitting;

  // Accepts an updater so rapid scans (each finishing asynchronously) build on the latest cart.
  const change = (next: Cart | ((current: Cart) => Cart)) => {
    setCart(next);
    setLineErrors({});
    setNotice(null);
  };

  const reprice = async () => {
    // Fresh prices and tax assignments for every item in the cart.
    const fresh = new Map<string, CartItem>();
    await Promise.all(
      [...new Set(cart.lines.map((l) => l.sku))].map(async (sku) => {
        try {
          const { product, variant } = await api.products.lookup(sku);
          fresh.set(variant.id, toCartItem(product, variant));
        } catch {
          // Archived or removed items stay as they are; the server will name them.
        }
      }),
    );
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['till-data', tenant.id] }),
      queryClient.invalidateQueries({ queryKey: ['tax-rates', tenant.id] }),
      queryClient.invalidateQueries({ queryKey: ['settings', tenant.id] }),
    ]);
    setCart((current) => repriceCart(current, fresh));
  };

  const complete = async () => {
    if (!canComplete || !parsedPayments) return;
    setSubmitting(true);
    setNotice(null);
    setPaymentError(null);
    setLineErrors({});
    setCartDiscountError(undefined);
    try {
      // Discounts above the business's limit come back as APPROVAL_REQUIRED: ask a manager.
      const sale = await approval.run('DISCOUNT', (given) =>
        api.sales.create({
          ...(given ? { approval: given } : {}),
          id: cart.saleId,
          shiftId: shift.id,
          ...(customer ? { customerId: customer.id } : {}),
          lines: cart.lines.map((line) => ({
            variantId: line.variantId,
            quantity: line.quantity,
            discount: line.discount,
          })),
          discount: cart.discount,
          payments: parsedPayments,
          expectedTotalMinor: totals.totalMinor,
        }),
      );
      if (!sale) return;
      setCompleted(sale);
      setCustomer(null);
      setCart(emptyCart(newDocumentId()));
      setPayments([newPayment()]);
      await Promise.all([
        onSold(),
        queryClient.invalidateQueries({ queryKey: salesKey(tenant.id) }),
      ]);
    } catch (error) {
      if (
        (!isApiError(error) || error.isTransient) &&
        parsedPayments.some((p) => p.method === 'LOYALTY')
      ) {
        // Points cannot be checked without the server: the sale is not saved offline.
        setNotice({ tone: 'danger', message: t('loyalty.needsConnection') });
      } else if (!isApiError(error) || error.isTransient) {
        // No connection (or the server is down): the customer has paid, so finish the sale
        // on this device. It keeps its id, so if the server did receive it, sending it again
        // later just returns the original.
        const request = toOfflineSaleRequest({
          cart,
          shiftId: shift.id,
          payments: parsedPayments,
          taxRates: taxRates.data.items,
          pricesIncludeTax,
          customerId: customer?.id ?? null,
        });
        await offline.engine.enqueue(request);
        setSavedOffline(
          buildLocalReceipt({
            request,
            cart,
            totals,
            changeMinor: settlement?.ok ? settlement.changeMinor : 0,
            shift,
            settings: settings.data,
            businessName: tenant.name,
            cashierName: user.fullName,
            customer,
          }),
        );
        setCustomer(null);
        setCart(emptyCart(newDocumentId()));
        setPayments([newPayment()]);
        await offline.refresh();
      } else if (error.code === 'TOTAL_MISMATCH') {
        await reprice();
        setNotice({ tone: 'warning', message: t('pos.pricesUpdated') });
      } else if (error.code === 'VALIDATION_FAILED') {
        const lines: Record<number, string> = {};
        for (const issue of error.issues) {
          const match = /^lines\.(\d+)\./.exec(issue.path);
          if (match) lines[Number(match[1])] = issue.message;
          else if (issue.path.startsWith('payments')) setPaymentError(issue.message);
          else if (issue.path === 'discount') setCartDiscountError(issue.message);
        }
        setLineErrors(lines);
        setNotice({ tone: 'danger', message: errorMessage(t, error) });
      } else {
        setNotice({ tone: 'danger', message: errorMessage(t, error) });
      }
    } finally {
      setSubmitting(false);
    }
  };

  if (completed) return <SaleDone sale={completed} onNext={() => setCompleted(null)} />;
  if (savedOffline)
    return <OfflineSaleDone receipt={savedOffline} onNext={() => setSavedOffline(null)} />;

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
      {approval.dialog}
      <div className="space-y-4">
        <Card>
          <ItemPicker
            label={t('pos.scan')}
            hint={t('pos.scanHint')}
            autoFocus
            onPick={(_item, product, variant) =>
              change((current) => addToCart(current, toCartItem(product, variant)))
            }
            offline={{
              findByCode: (code) => offline.engine.findByCode(code),
              search: (text, limit) => offline.engine.search(text, limit),
              onPick: (item) => change((current) => addToCart(current, toCatalogCartItem(item))),
            }}
          />
        </Card>
        <CartTable
          cart={cart}
          totals={totals}
          currency={currency}
          money={money}
          allowFraction={allowFraction}
          canDiscount={canDiscount}
          lineErrors={lineErrors}
          onChange={change}
        />
        {cart.lines.length > 0 && (
          <div className="flex justify-end">
            <Button
              variant="ghost"
              onClick={() => {
                if (window.confirm(t('pos.clearConfirm'))) {
                  change(emptyCart(newDocumentId()));
                  setPayments([newPayment()]);
                }
              }}
            >
              {t('pos.clear')}
            </Button>
          </div>
        )}
      </div>
      <Card className="h-fit space-y-5 lg:sticky lg:top-4">
        {notice && <Alert tone={notice.tone}>{notice.message}</Alert>}
        <CustomerPicker customer={customer} onChange={setCustomer} />
        {canDiscount && cart.lines.length > 0 && (
          <DiscountInput
            label={t('pos.cartDiscount')}
            value={cart.discount}
            currency={currency}
            error={
              cartDiscountError ??
              (totals.issues.some((i) => i.line === null)
                ? 'validation.discount.exceeds_total'
                : undefined)
            }
            onChange={(discount) => change(setCartDiscount(cart, discount))}
          />
        )}
        <TotalsSummary totals={totals} pricesIncludeTax={pricesIncludeTax} money={money} />
        {loyalty && customer && (
          <PointsHint
            points={customer.loyaltyPoints ?? 0}
            usableMinor={maxRedeemableMinor(
              customer.loyaltyPoints ?? 0,
              Math.max(
                0,
                totals.totalMinor -
                  (parsedPayments ?? [])
                    .filter((p) => p.method !== 'LOYALTY')
                    .reduce((sum, p) => sum + p.amountMinor, 0),
              ),
              loyalty,
            )}
            pointValueMinor={loyalty.pointValueMinor}
            money={money}
            currency={currency}
            onUse={(amount) =>
              setPayments([
                { ...newPayment('LOYALTY'), amount },
                ...payments.filter((p) => p.method !== 'LOYALTY'),
              ])
            }
          />
        )}
        <PaymentPanel
          methods={PAYMENT_METHODS.filter(
            (m) =>
              (m !== 'ACCOUNT' || (!!customer && customer.availableCreditMinor > 0)) &&
              (m !== 'LOYALTY' ||
                (!!loyalty &&
                  !!customer &&
                  (customer.loyaltyPoints ?? 0) >= Math.max(loyalty.minRedeemPoints, 1))),
          )}
          totalMinor={totals.totalMinor}
          payments={payments}
          currency={currency}
          money={money}
          error={
            paymentError ??
            (settlement && !settlement.ok && settlement.issue === 'non_cash_exceeds_total'
              ? 'validation.payment.non_cash_exceeds_total'
              : null)
          }
          onChange={(next) => {
            setPayments(next);
            setPaymentError(null);
          }}
        />
        <Button block loading={submitting} disabled={!canComplete} onClick={() => void complete()}>
          {submitting ? t('pos.completing') : `${t('pos.complete')} · ${money(totals.totalMinor)}`}
        </Button>
      </Card>
    </div>
  );
}

function SaleDone({ sale, onNext }: { sale: Sale; onNext: () => void }) {
  const { t } = useTranslation();
  const { format: money } = useMoney();
  const receipt = useQuery({
    queryKey: ['receipt', sale.id],
    queryFn: () => api.sales.receipt(sale.id),
  });
  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
      <div>
        {receipt.isPending ? (
          <Skeleton className="mx-auto h-96 w-full max-w-sm" />
        ) : receipt.isError ? (
          <Alert tone="danger">{errorMessage(t, receipt.error)}</Alert>
        ) : (
          <ReceiptView receipt={receipt.data} />
        )}
      </div>
      <Card className="h-fit space-y-4">
        <p className="flex items-center gap-2 text-lg font-semibold text-success-700">
          <CheckCircle2 aria-hidden className="size-6" />
          {t('pos.saleDone', { number: sale.number })}
        </p>
        {sale.changeMinor > 0 && (
          <p className="text-2xl font-bold tabular-nums" data-testid="sale-change">
            {t('pos.changeDue', { amount: money(sale.changeMinor) })}
          </p>
        )}
        <Button
          variant="secondary"
          block
          disabled={!receipt.isSuccess}
          onClick={() => window.print()}
        >
          <Printer aria-hidden className="size-4" />
          {t('pos.print')}
        </Button>
        <Button block autoFocus onClick={onNext}>
          {t('pos.newSale')}
        </Button>
      </Card>
    </div>
  );
}

/** Saved on this device: the receipt is printable now; its number arrives when it syncs. */
function OfflineSaleDone({ receipt, onNext }: { receipt: Receipt; onNext: () => void }) {
  const { t } = useTranslation();
  const { format: money } = useMoney();
  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
      <ReceiptView receipt={receipt} />
      <Card className="h-fit space-y-4">
        <p className="flex items-center gap-2 text-lg font-semibold text-warning-700">
          <CloudOff aria-hidden className="size-6" />
          {t('offline.savedTitle')}
        </p>
        <p className="text-sm text-neutral-700">{t('offline.savedBody')}</p>
        {receipt.sale.changeMinor > 0 && (
          <p className="text-2xl font-bold tabular-nums" data-testid="sale-change">
            {t('pos.changeDue', { amount: money(receipt.sale.changeMinor) })}
          </p>
        )}
        <Button variant="secondary" block onClick={() => window.print()}>
          <Printer aria-hidden className="size-4" />
          {t('pos.print')}
        </Button>
        <Button block autoFocus onClick={onNext}>
          {t('pos.newSale')}
        </Button>
      </Card>
    </div>
  );
}

/** Connection and outbox state for this till, with sales the server refused. */
function SyncBar({ offline }: { offline: OfflineStatus }) {
  const { t } = useTranslation();
  const { permissions } = useAuthContext();
  const [syncing, setSyncing] = useState(false);
  const [showFailed, setShowFailed] = useState(false);
  const sync = async () => {
    setSyncing(true);
    await offline.syncNow().finally(() => setSyncing(false));
  };
  if (offline.reachable && offline.pending === 0 && offline.failed.length === 0) return null;
  return (
    <div className="space-y-2">
      {(!offline.reachable || offline.pending > 0) && (
        <Alert
          tone="warning"
          action={
            <Button variant="secondary" loading={syncing} onClick={() => void sync()}>
              <RefreshCw aria-hidden className="size-4" />
              {t('offline.sendNow')}
            </Button>
          }
        >
          <p className="font-medium">
            {offline.reachable ? t('offline.onlineTitle') : t('offline.offlineTitle')}
          </p>
          <p>{t('offline.pending', { count: offline.pending })}</p>
        </Alert>
      )}
      {offline.failed.length > 0 && (
        <Alert
          tone="danger"
          action={
            <Button variant="secondary" onClick={() => setShowFailed(!showFailed)}>
              {t('offline.review')}
            </Button>
          }
        >
          {t('offline.failed', { count: offline.failed.length })}
        </Alert>
      )}
      {showFailed && (
        <Card title={t('offline.failedTitle')}>
          <ul className="divide-y divide-neutral-100 text-sm">
            {offline.failed.map((entry) => (
              <li key={entry.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span>
                  <span className="font-mono">{entry.id.slice(0, 8)}</span> ·{' '}
                  {new Date(entry.createdAt).toLocaleString()} ·{' '}
                  {entry.lastError
                    ? t(`errors.${entry.lastError.code}`, { defaultValue: entry.lastError.message })
                    : ''}
                </span>
                <span className="flex gap-2">
                  <Button
                    variant="secondary"
                    onClick={async () => {
                      await offline.engine.retry(entry.id);
                      await offline.syncNow();
                    }}
                  >
                    {t('offline.retry')}
                  </Button>
                  {permissions.includes('shifts.manage') && (
                    <Button
                      variant="danger"
                      onClick={async () => {
                        if (!window.confirm(t('offline.discardConfirm'))) return;
                        await offline.engine.discard(entry.id);
                        await offline.refresh();
                      }}
                    >
                      {t('offline.discard')}
                    </Button>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}

/** The attached customer's points, and a one-tap way to pay with as many as fit. */
function PointsHint({
  points,
  usableMinor,
  pointValueMinor,
  money,
  currency,
  onUse,
}: {
  points: number;
  usableMinor: number;
  pointValueMinor: number;
  money: (minor: number) => string;
  currency: CurrencyCode;
  onUse: (amount: string) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-brand-50 px-3 py-2 text-sm">
      <span>
        {t('loyalty.balance', { points })} ·{' '}
        {t('loyalty.worth', { amount: money(Math.max(points, 0) * pointValueMinor) })}
      </span>
      {usableMinor > 0 && (
        <Button
          variant="secondary"
          onClick={() => onUse(minorToDecimalString(usableMinor, currency))}
        >
          {t('loyalty.usable', { amount: money(usableMinor) })}
        </Button>
      )}
    </div>
  );
}
