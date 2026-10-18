import { isApiError } from '@pos/api-client';
import type { Sale, SaleReturn } from '@pos/contracts';
import {
  type CurrencyCode,
  formatMoney,
  fromMilli,
  isCurrencyCode,
  lineRefund,
  refundableByMethod,
  remainingQuantity,
  suggestRefunds,
  toMilli,
} from '@pos/domain';
import { INTL_LOCALES, isSupportedLanguage } from '@pos/i18n';
import { colors, fontSizes, radii, spacing, touchTarget } from '@pos/ui-tokens';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useApproval } from '@/components/approval';
import { Banner, Button, screenStyles, TextField } from '@/components/ui';
import { api } from '@/lib/api';
import { newSaleId } from '@/lib/checkout';
import { errorMessage } from '@/lib/errors';

/**
 * Return items from a receipt at this till: find the sale by its number, choose
 * quantities, and refund by the original payment methods (cash first). Refunds
 * come out of the cashier's open shift, passed in as `shiftId`.
 */
export default function ReturnsScreen() {
  const { t, i18n } = useTranslation();
  const { shiftId } = useLocalSearchParams<{ shiftId: string }>();
  const approval = useApproval();
  const [number, setNumber] = useState('');
  const [sale, setSale] = useState<Sale | null>(null);
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<SaleReturn | null>(null);
  const [returnId] = useState(newSaleId);
  const locale = isSupportedLanguage(i18n.resolvedLanguage)
    ? INTL_LOCALES[i18n.resolvedLanguage]
    : 'en-LK';
  const currency: CurrencyCode = sale && isCurrencyCode(sale.currency) ? sale.currency : 'LKR';
  const money = (minor: number) => formatMoney(minor, currency, locale);

  const find = async () => {
    if (!number.trim()) return;
    setBusy(true);
    setError(null);
    try {
      setSale(await api.sales.byNumber(number.trim().toUpperCase()));
      setQuantities({});
    } catch (e) {
      setError(errorMessage(t, e));
    } finally {
      setBusy(false);
    }
  };

  const chosen = (sale?.lines ?? [])
    .map((line) => ({ line, milli: quantities[line.id] ?? 0 }))
    .filter((c) => c.milli > 0)
    .map((c) => {
      const result = lineRefund(c.line, fromMilli(c.milli));
      return { ...c, refund: result.ok ? result.refundMinor : 0 };
    });
  const refundTotal = chosen.reduce((sum, c) => sum + c.refund, 0);
  const refunds = sale
    ? suggestRefunds(
        refundTotal,
        refundableByMethod(
          sale.refundable.map((r) => ({ method: r.method, amountMinor: r.amountMinor })),
          0,
          [],
        ),
      )
    : [];

  const submit = async () => {
    if (!sale || chosen.length === 0) return setError(t('sales.returnForm.nothing'));
    if (!reason.trim()) return setError(t('validation.required'));
    setBusy(true);
    setError(null);
    try {
      const result = await approval.run('RETURN', (given) =>
        api.sales.createReturn(sale.id, {
          id: returnId,
          shiftId,
          reason,
          lines: chosen.map((c) => ({
            saleLineId: c.line.id,
            quantity: fromMilli(c.milli),
            restock: true,
          })),
          refunds: refunds.map((r) => ({ ...r, reference: null })),
          ...(given ? { approval: given } : {}),
        }),
      );
      if (result) setDone(result);
    } catch (e) {
      setError(isApiError(e) && e.issues[0] ? t(e.issues[0].message) : errorMessage(t, e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <SafeAreaView style={{ flex: 1 }}>
      {approval.prompt}
      <ScrollView
        contentContainerStyle={screenStyles.container}
        keyboardShouldPersistTaps="handled"
      >
        <Text accessibilityRole="header" style={screenStyles.title}>
          {t('sales.actions.return')}
        </Text>
        {done ? (
          <>
            <Banner tone="success">
              {t('sales.returnForm.done', { number: done.number, amount: money(done.refundMinor) })}
            </Banner>
            {done.refunds.map((r, i) => (
              <Text key={i} style={screenStyles.rowValue}>
                {t(`paymentMethods.${r.method}`)}: {money(r.amountMinor)}
              </Text>
            ))}
            <Button label={t('mobile.sell.done')} onPress={() => router.back()} />
          </>
        ) : (
          <>
            {error ? <Banner tone="danger">{error}</Banner> : null}
            <TextField
              label={t('sales.findForReturn')}
              value={number}
              onChangeText={setNumber}
              autoCapitalize="characters"
              autoCorrect={false}
              submitBehavior="submit"
              onSubmitEditing={() => void find()}
            />
            <Button
              variant="secondary"
              label={t('sales.find')}
              loading={busy && !sale}
              onPress={() => void find()}
            />
            {sale ? (
              <>
                <Text style={screenStyles.rowValue}>
                  {sale.number} · {money(sale.totalMinor)}
                </Text>
                {sale.lines.map((line) => {
                  const remaining = remainingQuantity(line);
                  const value = quantities[line.id] ?? 0;
                  const step = Number.isInteger(Number(line.quantity)) ? 1000 : 100;
                  const set = (next: number) =>
                    setQuantities({
                      ...quantities,
                      [line.id]: Math.max(0, Math.min(remaining, next)),
                    });
                  return (
                    <View key={line.id} style={screenStyles.card}>
                      <Text style={screenStyles.rowValue}>{line.productName}</Text>
                      <Text style={screenStyles.rowLabel}>
                        {line.sku} ·{' '}
                        {t('sales.returnForm.ofRemaining', { count: Number(fromMilli(remaining)) })}
                      </Text>
                      <View style={styles.row}>
                        <Pressable
                          accessibilityRole="button"
                          accessibilityLabel={t('mobile.sell.decrease', { name: line.productName })}
                          disabled={value <= 0}
                          onPress={() => set(value - step)}
                          style={styles.stepper}
                        >
                          <Text style={styles.stepperText}>−</Text>
                        </Pressable>
                        <Text
                          style={styles.quantity}
                          accessibilityLabel={t('sales.returnForm.returnQty', {
                            name: line.productName,
                          })}
                        >
                          {fromMilli(value)}
                        </Text>
                        <Pressable
                          accessibilityRole="button"
                          accessibilityLabel={t('mobile.sell.increase', { name: line.productName })}
                          disabled={value >= remaining}
                          onPress={() =>
                            set(value + Math.min(step, toMilli(fromMilli(remaining - value))))
                          }
                          style={styles.stepper}
                        >
                          <Text style={styles.stepperText}>+</Text>
                        </Pressable>
                      </View>
                    </View>
                  );
                })}
                <TextField
                  label={t('sales.returnForm.reason')}
                  value={reason}
                  onChangeText={setReason}
                  maxLength={200}
                />
                <View style={screenStyles.card} accessibilityLiveRegion="polite">
                  <Text style={screenStyles.title} testID="refund-total">
                    {t('sales.returnForm.refundTotal')}: {money(refundTotal)}
                  </Text>
                  {refunds.map((r) => (
                    <Text key={r.method} style={screenStyles.rowLabel}>
                      {t(`paymentMethods.${r.method}`)}: {money(r.amountMinor)}
                    </Text>
                  ))}
                </View>
                <Button
                  label={t('sales.returnForm.submit')}
                  loading={busy}
                  disabled={chosen.length === 0}
                  onPress={() => void submit()}
                />
              </>
            ) : null}
            <Button
              variant="secondary"
              label={t('mobile.scan.cancel')}
              onPress={() => router.back()}
            />
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing[2] },
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
  quantity: { minWidth: 48, textAlign: 'center', fontSize: fontSizes.md },
});
