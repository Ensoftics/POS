import { isApiError } from '@pos/api-client';
import {
  buildLocalReceipt,
  type SyncEngine,
  toCatalogCartItem,
  toOfflineSaleRequest,
} from '@pos/offline';
import type { Customer, Receipt, Shift, TaxRateList, TenantSettings } from '@pos/contracts';
import {
  addToCart,
  type CurrencyCode,
  type CartItem,
  formatMoney,
  fromMilli,
  minorToDecimalString,
  parseMoney,
  parsePercent,
  PAYMENT_METHODS,
  type PaymentMethod,
  priceCart,
  removeLine,
  repriceCart,
  setCartDiscount,
  setLineQuantity,
  settlePayments,
  toMilli,
  maxRedeemableMinor,
} from '@pos/domain';
import { INTL_LOCALES, isSupportedLanguage } from '@pos/i18n';
import { colors, fontSizes, radii, spacing, touchTarget } from '@pos/ui-tokens';
import { Redirect, router } from 'expo-router';
import { type ComponentRef, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, StyleSheet, Text, type TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useApproval } from '@/components/approval';
import { PrintableReceipt } from '@/components/PrintableReceipt';
import { Banner, Button, screenStyles, TextField } from '@/components/ui';
import { api } from '@/lib/api';
import { cartStore, scanBus, toCartItem, useCart } from '@/lib/checkout';
import { useOfflineSync } from '@/lib/offline';
import { type DeviceRegister, readDeviceRegister } from '@/lib/device-register';
import { errorMessage } from '@/lib/errors';
import { PrinterError } from '@/lib/printing/bluetooth';
import { type PrintableView, printView } from '@/lib/printing/print';
import { useSavedPrinter } from '@/lib/printing/printer-store';
import { useSession } from '@/lib/session';
import { useLoad } from '@/lib/use-load';

interface Workspace {
  register: DeviceRegister | null;
  settings: TenantSettings;
  taxRates: TaxRateList;
  shift: Shift | null;
}

interface PaymentDraft {
  method: PaymentMethod;
  amount: string;
  reference: string;
}

/**
 * Android till: scan with a connected scanner, the keyboard or the camera; adjust
 * quantities; take split payments; show the receipt. Prices, tax and stock are
 * checked again by the API, which is the authority.
 */
export default function SellScreen() {
  const { t } = useTranslation();
  const session = useSession();
  const tenantId = session.status === 'authenticated' ? session.context.tenant.id : '';
  const offline = useOfflineSync(tenantId);
  // Live data when the server answers; this device's last copy when it does not.
  const [workspace, reload] = useLoad<Workspace>(async () => {
    const register = await readDeviceRegister(tenantId);
    const cacheKey = `workspace.${register?.registerId ?? 'none'}`;
    try {
      const [settings, taxRates, current] = await Promise.all([
        api.settings.get(),
        api.taxRates.list(),
        register ? api.shifts.current(register.registerId) : Promise.resolve({ shift: null }),
      ]);
      const live = { register, settings, taxRates, shift: current.shift };
      await offline.engine.remember(cacheKey, live);
      return live;
    } catch (error) {
      if (isApiError(error) && !error.isTransient) throw error;
      const cached = await offline.engine.recall<Workspace>(cacheKey);
      if (!cached) throw error;
      return { ...cached, register };
    }
  });

  if (session.status !== 'authenticated') return null;
  if (workspace.status === 'loading')
    return <View style={screenStyles.center} accessibilityLabel={t('common.loading')} />;
  if (workspace.status === 'error')
    return (
      <SafeAreaView style={screenStyles.center}>
        <Banner tone="danger">{errorMessage(t, workspace.error)}</Banner>
        <Button variant="secondary" label={t('common.retry')} onPress={reload} />
      </SafeAreaView>
    );
  const { register, shift } = workspace.data;
  if (!register) return <Redirect href="/register" />;

  const { user, permissions } = session.context;
  return (
    <SafeAreaView style={{ flex: 1 }}>
      {!shift ? (
        <OpenShift
          registerId={register.registerId}
          settings={workspace.data.settings}
          onOpened={reload}
        />
      ) : shift.openedById !== user.id && !permissions.includes('shifts.manage') ? (
        <View style={screenStyles.container}>
          <Banner tone="warning">
            {t('pos.shift.otherCashier', { name: shift.openedByName })}
          </Banner>
        </View>
      ) : (
        <>
          {!offline.reachable || offline.pending > 0 || offline.failed > 0 ? (
            <View style={styles.syncBar}>
              <Banner tone={offline.failed > 0 ? 'danger' : 'warning'}>
                {!offline.reachable ? `${t('offline.offlineTitle')}. ` : ''}
                {offline.pending > 0 ? t('offline.pending', { count: offline.pending }) : ''}
                {offline.failed > 0 ? ` ${t('offline.failed', { count: offline.failed })}` : ''}
              </Banner>
              <Button
                variant="secondary"
                label={t('offline.sendNow')}
                onPress={() => void offline.syncNow()}
              />
            </View>
          ) : null}
          <Till
            shift={shift}
            settings={workspace.data.settings}
            taxRates={workspace.data.taxRates}
            canDiscount={permissions.includes('sales.discount')}
            engine={offline.engine}
            onQueued={() => void offline.refresh()}
            onShiftChanged={reload}
          />
        </>
      )}
    </SafeAreaView>
  );
}

function useMoney(currency: CurrencyCode) {
  const { i18n } = useTranslation();
  const locale = isSupportedLanguage(i18n.resolvedLanguage)
    ? INTL_LOCALES[i18n.resolvedLanguage]
    : 'en-LK';
  return (minor: number) => formatMoney(minor, currency, locale);
}

function OpenShift({
  registerId,
  settings,
  onOpened,
}: {
  registerId: string;
  settings: TenantSettings;
  onOpened: () => void;
}) {
  const { t } = useTranslation();
  const [amount, setAmount] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const open = async () => {
    const parsed = parseMoney(amount || '0', settings.currency);
    if (!parsed.ok) return setError(t(`validation.money.${parsed.issue}`));
    setBusy(true);
    setError(null);
    try {
      await api.shifts.open({ registerId, openingFloatMinor: parsed.minor });
      onOpened();
    } catch (e) {
      setError(errorMessage(t, e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <ScrollView contentContainerStyle={screenStyles.container} keyboardShouldPersistTaps="handled">
      <Text accessibilityRole="header" style={screenStyles.title}>
        {t('pos.shift.open')}
      </Text>
      <Text style={screenStyles.subtitle}>{t('pos.shift.none')}</Text>
      <TextField
        label={`${t('pos.shift.openingFloat')} (${settings.currency})`}
        value={amount}
        onChangeText={setAmount}
        keyboardType="decimal-pad"
        error={error ?? undefined}
      />
      <Text style={screenStyles.subtitle}>{t('pos.shift.openingFloatHint')}</Text>
      <Button label={t('pos.shift.open')} loading={busy} onPress={() => void open()} />
    </ScrollView>
  );
}

function Till({
  shift,
  settings,
  taxRates,
  canDiscount,
  engine,
  onQueued,
  onShiftChanged,
}: {
  shift: Shift;
  settings: TenantSettings;
  taxRates: TaxRateList;
  canDiscount: boolean;
  engine: SyncEngine;
  onQueued: () => void;
  onShiftChanged: () => void;
}) {
  const { t } = useTranslation();
  const session = useSession();
  const cart = useCart();
  const money = useMoney(settings.currency);
  const input = useRef<ComponentRef<typeof TextInput>>(null);
  const [code, setCode] = useState('');
  const [message, setMessage] = useState<{ tone: 'danger' | 'warning'; text: string } | null>(null);
  const [step, setStep] = useState<'cart' | 'pay'>('cart');
  const [payments, setPayments] = useState<PaymentDraft[]>([
    { method: 'CASH', amount: '', reference: '' },
  ]);
  const [discountText, setDiscountText] = useState(
    cart.discount?.kind === 'PERCENT' ? String(cart.discount.value / 100) : '',
  );
  const [busy, setBusy] = useState(false);
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [savedOffline, setSavedOffline] = useState(false);
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [customerPhone, setCustomerPhone] = useState('');
  const [customerMessage, setCustomerMessage] = useState<string | null>(null);
  // Loyalty needs the owner's setting and the platform flag; the server re-checks both.
  const features = session.status === 'authenticated' ? (session.context.features ?? []) : [];
  const loyalty =
    settings.loyalty?.enabled && features.includes('loyalty') ? settings.loyalty : null;
  const points = customer?.loyaltyPoints ?? 0;
  const methods = PAYMENT_METHODS.filter(
    (m) =>
      (m !== 'ACCOUNT' || (customer !== null && customer.availableCreditMinor > 0)) &&
      (m !== 'LOYALTY' ||
        (loyalty !== null && customer !== null && points >= Math.max(loyalty.minRedeemPoints, 1))),
  );

  const findCustomer = async () => {
    setCustomerMessage(null);
    try {
      const page = await api.customers.list({ q: customerPhone.trim(), limit: 1 });
      if (page.items[0]) setCustomer(page.items[0]);
      else setCustomerMessage(t('mobile.customer.none'));
    } catch (error) {
      setCustomerMessage(errorMessage(t, error));
    }
  };
  const approval = useApproval();
  const { pricesIncludeTax } = settings.checkout;
  const allowFraction = settings.profile.allowFractionalQuantities;
  const totals = priceCart(cart, taxRates.items, pricesIncludeTax);

  const add = async (raw: string) => {
    const value = raw.trim();
    if (!value) return;
    setMessage(null);
    try {
      const { product, variant } = await api.products.lookup(value);
      cartStore.set(addToCart(cartStore.get(), toCartItem(product, variant)));
    } catch (error) {
      // No connection: sell from this device's copy of the catalogue.
      if (!isApiError(error) || error.isTransient) {
        const local = await engine.findByCode(value);
        if (local) {
          cartStore.set(addToCart(cartStore.get(), toCatalogCartItem(local)));
          return;
        }
      }
      setMessage({
        tone: 'warning',
        text:
          (isApiError(error) && error.code === 'NOT_FOUND') ||
          !isApiError(error) ||
          error.isTransient
            ? t('mobile.lookup.notFound', { code: value })
            : errorMessage(t, error),
      });
    } finally {
      setCode('');
      input.current?.focus();
    }
  };

  // Codes read by the camera screen.
  useEffect(() => scanBus.subscribe((scanned) => void add(scanned)), []); // eslint-disable-line react-hooks/exhaustive-deps

  const step1 = allowFraction ? 100 : 1000; // ±0.1 for part quantities, ±1 otherwise
  const bump = (key: string, quantity: string, direction: 1 | -1) => {
    const next = toMilli(quantity) + direction * step1;
    cartStore.set(
      next <= 0
        ? removeLine(cartStore.get(), key)
        : setLineQuantity(cartStore.get(), key, fromMilli(next)),
    );
  };

  const parsedPayments = payments
    .filter((p) => p.amount.trim() !== '')
    .map((p) => ({ ...p, parsed: parseMoney(p.amount, settings.currency) }));
  const paymentsValid = parsedPayments.every((p) => p.parsed.ok && p.parsed.minor > 0);
  const settlement = paymentsValid
    ? settlePayments(
        totals.totalMinor,
        parsedPayments.map((p) => ({
          method: p.method,
          amountMinor: p.parsed.ok ? p.parsed.minor : 0,
        })),
      )
    : null;

  const reprice = async () => {
    const fresh = new Map<string, CartItem>();
    for (const line of cartStore.get().lines) {
      try {
        const { product, variant } = await api.products.lookup(line.sku);
        fresh.set(variant.id, toCartItem(product, variant));
      } catch {
        // The server will name items that can no longer be sold.
      }
    }
    cartStore.set(repriceCart(cartStore.get(), fresh));
  };

  const complete = async () => {
    if (!settlement?.ok) return;
    setBusy(true);
    setMessage(null);
    try {
      // Discounts above the business's limit need a manager: ask, then resubmit the same sale.
      const sale = await approval.run('DISCOUNT', (given) =>
        api.sales.create({
          ...(given ? { approval: given } : {}),
          id: cart.saleId,
          shiftId: shift.id,
          ...(customer ? { customerId: customer.id } : {}),
          lines: cart.lines.map((l) => ({
            variantId: l.variantId,
            quantity: l.quantity,
            discount: l.discount,
          })),
          discount: cart.discount,
          payments: parsedPayments.map((p) => ({
            method: p.method,
            amountMinor: p.parsed.ok ? p.parsed.minor : 0,
            reference: p.reference.trim() || null,
          })),
          expectedTotalMinor: totals.totalMinor,
        }),
      );
      if (!sale) return;
      cartStore.reset();
      setCustomer(null);
      setPayments([{ method: 'CASH', amount: '', reference: '' }]);
      setDiscountText('');
      setStep('cart');
      try {
        setReceipt(await api.sales.receipt(sale.id));
      } catch {
        setReceipt({
          business: {
            name: '',
            legalName: null,
            taxRegistrationNumber: null,
            addressLines: [],
            branchName: shift.branchName,
            branchAddress: null,
            branchPhone: null,
            footer: null,
            timezone: settings.timezone,
          },
          sale,
        });
      }
    } catch (error) {
      if (isApiError(error) && error.code === 'TOTAL_MISMATCH') {
        await reprice();
        setMessage({ tone: 'warning', text: t('pos.pricesUpdated') });
        setStep('cart');
      } else if (isApiError(error) && error.code === 'SHIFT_NOT_OPEN') {
        onShiftChanged();
      } else if (
        (!isApiError(error) || error.isTransient) &&
        parsedPayments.some((p) => p.method === 'LOYALTY')
      ) {
        // Points cannot be checked without the server: never saved on the device.
        setMessage({ tone: 'danger', text: t('loyalty.needsConnection') });
      } else if (!isApiError(error) || error.isTransient) {
        // No connection: the customer has paid, so finish on this device. The sale keeps
        // its id; if the server did receive it, sending it again returns the original.
        const request = toOfflineSaleRequest({
          cart,
          shiftId: shift.id,
          payments: parsedPayments.map((p) => ({
            method: p.method,
            amountMinor: p.parsed.ok ? p.parsed.minor : 0,
            reference: p.reference.trim() || null,
          })),
          taxRates: taxRates.items,
          pricesIncludeTax,
          customerId: customer?.id ?? null,
        });
        await engine.enqueue(request);
        const local = buildLocalReceipt({
          request,
          cart,
          totals,
          changeMinor: settlement.changeMinor,
          shift,
          settings,
          businessName: session.status === 'authenticated' ? session.context.tenant.name : '',
          cashierName: session.status === 'authenticated' ? session.context.user.fullName : '',
          customer,
        });
        cartStore.reset();
        setCustomer(null);
        setPayments([{ method: 'CASH', amount: '', reference: '' }]);
        setDiscountText('');
        setStep('cart');
        setSavedOffline(true);
        setReceipt(local);
        onQueued();
      } else {
        const issue = error.issues[0]?.message;
        setMessage({ tone: 'danger', text: issue ? t(issue) : errorMessage(t, error) });
      }
    } finally {
      setBusy(false);
    }
  };

  if (receipt)
    return (
      <SaleReceipt
        receipt={receipt}
        money={money}
        offline={savedOffline}
        onNext={() => {
          setReceipt(null);
          setSavedOffline(false);
        }}
      />
    );

  if (step === 'pay') {
    return (
      <ScrollView
        contentContainerStyle={screenStyles.container}
        keyboardShouldPersistTaps="handled"
      >
        {approval.prompt}
        <Text accessibilityRole="header" style={screenStyles.title}>
          {t('pos.pay')} · {money(totals.totalMinor)}
        </Text>
        {message ? <Banner tone={message.tone}>{message.text}</Banner> : null}
        {session.status === 'authenticated' &&
        session.context.permissions.includes('customers.read') ? (
          customer ? (
            <View style={screenStyles.card} testID="attached-customer">
              <Text style={screenStyles.rowValue}>{customer.name}</Text>
              <Text style={screenStyles.rowLabel}>
                {t('pos.customer.available', { amount: money(customer.availableCreditMinor) })}
              </Text>
              {loyalty ? (
                <Text style={screenStyles.rowLabel}>
                  {t('mobile.points', {
                    points,
                    amount: money(Math.max(points, 0) * loyalty.pointValueMinor),
                  })}
                </Text>
              ) : null}
              {loyalty &&
              maxRedeemableMinor(points, totals.totalMinor, loyalty) > 0 &&
              !payments.some((p) => p.method === 'LOYALTY') ? (
                <Button
                  variant="secondary"
                  label={t('loyalty.usable', {
                    amount: money(maxRedeemableMinor(points, totals.totalMinor, loyalty)),
                  })}
                  onPress={() =>
                    setPayments([
                      {
                        method: 'LOYALTY',
                        amount: minorToDecimalString(
                          maxRedeemableMinor(points, totals.totalMinor, loyalty),
                          settings.currency,
                        ),
                        reference: '',
                      },
                      ...payments.filter((p) => p.method !== 'LOYALTY'),
                    ])
                  }
                />
              ) : null}
              <Button
                variant="secondary"
                label={t('mobile.customer.remove')}
                onPress={() => setCustomer(null)}
              />
            </View>
          ) : (
            <View style={screenStyles.card}>
              <TextField
                label={t('mobile.customer.phone')}
                value={customerPhone}
                onChangeText={setCustomerPhone}
                keyboardType="phone-pad"
                submitBehavior="submit"
                onSubmitEditing={() => void findCustomer()}
              />
              <Button
                variant="secondary"
                label={t('mobile.customer.find')}
                onPress={() => void findCustomer()}
              />
              {customerMessage ? <Text style={styles.error}>{customerMessage}</Text> : null}
            </View>
          )
        ) : null}
        {payments.map((payment, index) => (
          <View key={index} style={screenStyles.card}>
            <View style={styles.chips} accessibilityRole="radiogroup">
              {methods.map((method) => (
                <Pressable
                  key={method}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: payment.method === method }}
                  onPress={() =>
                    setPayments(payments.map((p, i) => (i === index ? { ...p, method } : p)))
                  }
                  style={[styles.chip, payment.method === method && styles.chipActive]}
                >
                  <Text style={payment.method === method ? styles.chipTextActive : styles.chipText}>
                    {t(`paymentMethods.${method}`)}
                  </Text>
                </Pressable>
              ))}
            </View>
            <TextField
              label={`${t('pos.paymentAmount')} (${settings.currency})`}
              value={payment.amount}
              keyboardType="decimal-pad"
              onChangeText={(amount) =>
                setPayments(payments.map((p, i) => (i === index ? { ...p, amount } : p)))
              }
            />
            {payment.method !== 'CASH' ? (
              <TextField
                label={t('pos.reference')}
                value={payment.reference}
                maxLength={40}
                onChangeText={(reference) =>
                  setPayments(payments.map((p, i) => (i === index ? { ...p, reference } : p)))
                }
              />
            ) : null}
            <Button
              variant="secondary"
              label={t('pos.exact')}
              onPress={() => {
                const others = parsedPayments
                  .filter((_, i) => i !== index)
                  .reduce((sum, p) => sum + (p.parsed.ok ? p.parsed.minor : 0), 0);
                const due = Math.max(0, totals.totalMinor - others);
                setPayments(
                  payments.map((p, i) =>
                    i === index
                      ? { ...p, amount: minorToDecimalString(due, settings.currency) }
                      : p,
                  ),
                );
              }}
            />
          </View>
        ))}
        {payments.length < 10 ? (
          <Button
            variant="secondary"
            label={t('pos.addPayment')}
            onPress={() =>
              setPayments([...payments, { method: 'CARD', amount: '', reference: '' }])
            }
          />
        ) : null}
        <View style={screenStyles.card} accessibilityLiveRegion="polite">
          {settlement && !settlement.ok && settlement.issue === 'insufficient' ? (
            <Text style={screenStyles.rowValue}>
              {t('pos.due')}: {money(settlement.dueMinor)}
            </Text>
          ) : null}
          {settlement && !settlement.ok && settlement.issue === 'non_cash_exceeds_total' ? (
            <Text style={styles.error}>{t('validation.payment.non_cash_exceeds_total')}</Text>
          ) : null}
          {settlement?.ok && settlement.changeMinor > 0 ? (
            <Text style={[screenStyles.title, { color: colors.success[700] }]}>
              {t('pos.change')}: {money(settlement.changeMinor)}
            </Text>
          ) : null}
          {!paymentsValid ? (
            <Text style={styles.error}>{t('validation.money.invalid')}</Text>
          ) : null}
        </View>
        <Button
          label={busy ? t('pos.completing') : t('pos.complete')}
          loading={busy}
          disabled={!settlement?.ok}
          onPress={() => void complete()}
        />
        <Button variant="secondary" label={t('mobile.sell.back')} onPress={() => setStep('cart')} />
      </ScrollView>
    );
  }

  return (
    <ScrollView contentContainerStyle={screenStyles.container} keyboardShouldPersistTaps="handled">
      <Text accessibilityRole="header" style={screenStyles.title}>
        {t('mobile.sell.title')}
      </Text>
      <Text style={screenStyles.subtitle}>
        {shift.registerName} · {shift.number}
      </Text>
      <TextField
        ref={input}
        label={t('mobile.sell.code')}
        value={code}
        onChangeText={setCode}
        autoFocus
        autoCapitalize="characters"
        autoCorrect={false}
        returnKeyType="done"
        submitBehavior="submit"
        onSubmitEditing={() => void add(code)}
      />
      <View style={styles.row}>
        <View style={{ flex: 1 }}>
          <Button variant="secondary" label={t('mobile.sell.add')} onPress={() => void add(code)} />
        </View>
        <View style={{ flex: 1 }}>
          <Button label={t('mobile.sell.scanCamera')} onPress={() => router.push('/scan')} />
        </View>
      </View>
      {message ? <Banner tone={message.tone}>{message.text}</Banner> : null}

      {cart.lines.length === 0 ? (
        <Text style={screenStyles.subtitle}>{t('pos.emptyCart')}</Text>
      ) : (
        cart.lines.map((line, index) => (
          <View key={line.key} style={screenStyles.card}>
            <Text style={screenStyles.rowValue}>
              {line.productName}
              {line.variantLabel ? ` (${line.variantLabel})` : ''}
            </Text>
            <Text style={screenStyles.rowLabel}>
              {line.sku} · {money(line.unitPriceMinor)}
            </Text>
            <View style={styles.row}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t('mobile.sell.decrease', { name: line.productName })}
                onPress={() => bump(line.key, line.quantity, -1)}
                style={styles.stepper}
              >
                <Text style={styles.stepperText}>−</Text>
              </Pressable>
              <Text
                style={styles.quantity}
                accessibilityLabel={t('pos.quantityFor', { name: line.productName })}
              >
                {line.quantity}
              </Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t('mobile.sell.increase', { name: line.productName })}
                onPress={() => bump(line.key, line.quantity, 1)}
                style={styles.stepper}
              >
                <Text style={styles.stepperText}>+</Text>
              </Pressable>
              <Text style={[screenStyles.rowValue, styles.lineTotal]}>
                {money(totals.lines[index]?.grossMinor ?? 0)}
              </Text>
            </View>
          </View>
        ))
      )}

      {canDiscount && cart.lines.length > 0 ? (
        <TextField
          label={`${t('pos.cartDiscount')} (%)`}
          value={discountText}
          keyboardType="decimal-pad"
          error={
            discountText && parsePercent(discountText) === null
              ? t('validation.percent.invalid')
              : undefined
          }
          onChangeText={(text) => {
            setDiscountText(text);
            const bp = text.trim() ? parsePercent(text) : 0;
            if (bp !== null)
              cartStore.set(
                setCartDiscount(cartStore.get(), bp ? { kind: 'PERCENT', value: bp } : null),
              );
          }}
        />
      ) : null}

      <View style={screenStyles.card}>
        <Text style={screenStyles.rowLabel}>
          {t('pos.subtotal')}: {money(totals.subtotalMinor)}
        </Text>
        {totals.discountMinor > 0 ? (
          <Text style={screenStyles.rowLabel}>
            {t('pos.discounts')}: -{money(totals.discountMinor)}
          </Text>
        ) : null}
        {totals.taxMinor > 0 ? (
          <Text style={screenStyles.rowLabel}>
            {pricesIncludeTax ? t('pos.taxIncluded') : t('pos.tax')}: {money(totals.taxMinor)}
          </Text>
        ) : null}
        <Text style={screenStyles.title} testID="cart-total">
          {t('pos.total')}: {money(totals.totalMinor)}
        </Text>
      </View>
      <Button
        label={t('mobile.sell.pay', { amount: money(totals.totalMinor) })}
        disabled={cart.lines.length === 0 || totals.issues.length > 0}
        onPress={() => setStep('pay')}
      />
      {session.status === 'authenticated' &&
      session.context.permissions.includes('sales.refund') ? (
        <Button
          variant="secondary"
          label={t('sales.actions.return')}
          onPress={() => router.push({ pathname: '/returns', params: { shiftId: shift.id } })}
        />
      ) : null}
      <Button
        variant="secondary"
        label={t('mobile.cash.title')}
        onPress={() => router.push({ pathname: '/cash', params: { id: shift.id } })}
      />
      <Button
        variant="secondary"
        label={t('mobile.sell.closeShift')}
        onPress={() => router.push({ pathname: '/shift', params: { id: shift.id } })}
      />
    </ScrollView>
  );
}

function SaleReceipt({
  receipt,
  money,
  offline,
  onNext,
}: {
  receipt: Receipt;
  money: (minor: number) => string;
  offline: boolean;
  onNext: () => void;
}) {
  const { t } = useTranslation();
  const { sale, business } = receipt;
  const printer = useSavedPrinter();
  const printable = useRef<{ printable: () => PrintableView | null }>(null);
  const [printing, setPrinting] = useState(false);
  const [printProblem, setPrintProblem] = useState<string | null>(null);
  const [printed, setPrinted] = useState(false);

  const print = async () => {
    const view = printable.current?.printable();
    if (!printer || !view) return;
    setPrinting(true);
    setPrintProblem(null);
    try {
      await printView(view, printer);
      setPrinted(true);
    } catch (error) {
      setPrintProblem(
        t(`printing.errors.${error instanceof PrinterError ? error.problem : 'send_failed'}`),
      );
    } finally {
      setPrinting(false);
    }
  };

  return (
    <ScrollView contentContainerStyle={screenStyles.container}>
      {printer ? (
        <PrintableReceipt
          ref={printable}
          receipt={receipt}
          money={money}
          paperWidth={printer.paperWidth}
          onReady={printer.autoPrint ? () => void print() : undefined}
        />
      ) : null}
      {offline ? (
        <Banner tone="warning">
          {t('offline.savedTitle')}. {t('offline.savedBody')}
        </Banner>
      ) : (
        <Banner tone="success">{t('pos.saleDone', { number: sale.number })}</Banner>
      )}
      {sale.changeMinor > 0 ? (
        <Text style={screenStyles.title} testID="sale-change">
          {t('pos.changeDue', { amount: money(sale.changeMinor) })}
        </Text>
      ) : null}
      <View style={screenStyles.card} accessibilityLabel={t('sales.receipt.title')}>
        {business.name ? <Text style={screenStyles.rowValue}>{business.name}</Text> : null}
        {business.taxRegistrationNumber ? (
          <Text style={screenStyles.rowLabel}>
            {t('sales.receipt.taxNumber', { number: business.taxRegistrationNumber })}
          </Text>
        ) : null}
        <Text style={screenStyles.rowLabel}>
          {sale.number || t('offline.pendingNumber')} · {sale.registerName}
        </Text>
        {sale.pointsRedeemed ? (
          <Text style={screenStyles.rowLabel}>
            {t('loyalty.redeemed', { points: sale.pointsRedeemed })}
          </Text>
        ) : null}
        {sale.pointsEarned ? (
          <Text style={screenStyles.rowLabel}>
            {t('loyalty.earned', { points: sale.pointsEarned })}
          </Text>
        ) : null}
        {typeof receipt.loyaltyBalance === 'number' ? (
          <Text style={screenStyles.rowLabel}>
            {t('loyalty.newBalance', { points: receipt.loyaltyBalance })}
          </Text>
        ) : null}
        {sale.lines.map((line, index) => (
          <Text key={index} style={screenStyles.rowLabel}>
            {line.productName}{' '}
            {t('sales.receipt.qtyAt', { qty: line.quantity, price: money(line.unitPriceMinor) })}
          </Text>
        ))}
        <Text style={screenStyles.rowValue}>
          {t('sales.receipt.total')}: {money(sale.totalMinor)}
        </Text>
        {sale.payments.map((payment, index) => (
          <Text key={index} style={screenStyles.rowLabel}>
            {t(`paymentMethods.${payment.method}`)}: {money(payment.amountMinor)}
          </Text>
        ))}
        {business.footer ? <Text style={screenStyles.subtitle}>{business.footer}</Text> : null}
      </View>
      {printProblem ? <Banner tone="danger">{printProblem}</Banner> : null}
      {printed ? <Banner tone="success">{t('printing.printed')}</Banner> : null}
      {printer ? (
        <Button
          variant="secondary"
          label={printed ? t('printing.printAgain') : t('printing.print')}
          loading={printing}
          onPress={() => void print()}
        />
      ) : null}
      <Button label={t('pos.newSale')} onPress={onNext} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  syncBar: { paddingHorizontal: spacing[6], paddingTop: spacing[4], gap: spacing[2] },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing[2] },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing[2] },
  chip: {
    minHeight: touchTarget,
    paddingHorizontal: spacing[3],
    justifyContent: 'center',
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.neutral[300],
    backgroundColor: colors.neutral[0],
  },
  chipActive: { backgroundColor: colors.brand[700], borderColor: colors.brand[700] },
  chipText: { color: colors.neutral[800], fontSize: fontSizes.sm },
  chipTextActive: { color: colors.neutral[0], fontSize: fontSizes.sm, fontWeight: '600' },
  stepper: {
    minWidth: touchTarget,
    minHeight: touchTarget,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.neutral[300],
    backgroundColor: colors.neutral[0],
  },
  stepperText: { fontSize: fontSizes.xl, color: colors.neutral[900] },
  quantity: {
    minWidth: 48,
    textAlign: 'center',
    fontSize: fontSizes.md,
    fontVariant: ['tabular-nums'],
  },
  lineTotal: { flex: 1, textAlign: 'right', fontVariant: ['tabular-nums'] },
  error: { color: colors.danger[700], fontSize: fontSizes.sm },
});
