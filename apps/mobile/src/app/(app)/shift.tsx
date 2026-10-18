import type { Shift } from '@pos/contracts';
import { formatMoney, parseMoney } from '@pos/domain';
import { INTL_LOCALES, isSupportedLanguage } from '@pos/i18n';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Banner, Button, screenStyles, TextField } from '@/components/ui';
import { api } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { useLoad } from '@/lib/use-load';

/** Close a shift: count the drawer, compare with the expected cash, record the difference. */
export default function CloseShiftScreen() {
  const { t, i18n } = useTranslation();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [data, reload] = useLoad(async () => {
    const [shift, settings] = await Promise.all([api.shifts.get(id), api.settings.get()]);
    return { shift, settings };
  });
  const [counted, setCounted] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [closed, setClosed] = useState<Shift | null>(null);
  const locale = isSupportedLanguage(i18n.resolvedLanguage)
    ? INTL_LOCALES[i18n.resolvedLanguage]
    : 'en-LK';

  if (data.status === 'loading')
    return <View style={screenStyles.center} accessibilityLabel={t('common.loading')} />;
  if (data.status === 'error')
    return (
      <SafeAreaView style={screenStyles.center}>
        <Banner tone="danger">{errorMessage(t, data.error)}</Banner>
        <Button variant="secondary" label={t('common.retry')} onPress={reload} />
      </SafeAreaView>
    );

  const { settings } = data.data;
  const shift = closed ?? data.data.shift;
  const money = (minor: number) => formatMoney(minor, settings.currency, locale);
  const s = shift.summary;

  const close = async () => {
    const parsed = parseMoney(counted, settings.currency);
    if (!counted.trim() || !parsed.ok) return setError(t('validation.money.invalid'));
    setBusy(true);
    setError(null);
    try {
      setClosed(
        await api.shifts.close(shift.id, {
          version: shift.version,
          countedCashMinor: parsed.minor,
          notes,
        }),
      );
    } catch (e) {
      setError(errorMessage(t, e));
    } finally {
      setBusy(false);
    }
  };

  const rows: Array<[string, string]> = [
    [
      t('pos.shift.sales'),
      `${t('pos.shift.salesCount', { count: s.saleCount })} · ${money(s.salesTotalMinor)}`,
    ],
    ...s.payments.map((p): [string, string] => [
      t(`paymentMethods.${p.method}`),
      money(p.amountMinor),
    ]),
    [t('pos.shift.openingFloatLabel'), money(shift.openingFloatMinor)],
    [t('pos.shift.cashReceived'), money(s.cashReceivedMinor)],
    [t('pos.shift.changeGiven'), `-${money(s.changeGivenMinor)}`],
    [t('pos.shift.expected'), money(shift.expectedCashMinor ?? s.expectedCashMinor)],
  ];

  return (
    <SafeAreaView style={{ flex: 1 }}>
      <ScrollView
        contentContainerStyle={screenStyles.container}
        keyboardShouldPersistTaps="handled"
      >
        <Text accessibilityRole="header" style={screenStyles.title}>
          {t('pos.shift.closeTitle', { number: shift.number })}
        </Text>
        <View style={screenStyles.card}>
          {rows.map(([label, value]) => (
            <View key={label} accessible accessibilityLabel={`${label}: ${value}`}>
              <Text style={screenStyles.rowLabel}>{label}</Text>
              <Text style={screenStyles.rowValue}>{value}</Text>
            </View>
          ))}
        </View>
        {closed ? (
          <>
            <Banner tone={closed.differenceMinor === 0 ? 'success' : 'warning'}>
              {t('pos.shift.closed', { number: closed.number })} {t('pos.shift.difference')}:{' '}
              {money(closed.differenceMinor ?? 0)}
            </Banner>
            <Button label={t('mobile.sell.done')} onPress={() => router.dismissTo('/')} />
          </>
        ) : (
          <>
            {error ? <Banner tone="danger">{error}</Banner> : null}
            <TextField
              label={`${t('pos.shift.counted')} (${settings.currency})`}
              value={counted}
              onChangeText={setCounted}
              keyboardType="decimal-pad"
            />
            <Text style={screenStyles.subtitle}>{t('pos.shift.countedHint')}</Text>
            <TextField
              label={t('pos.shift.notes')}
              value={notes}
              onChangeText={setNotes}
              maxLength={1000}
            />
            <Button
              label={t('pos.shift.confirmClose')}
              loading={busy}
              onPress={() => void close()}
            />
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
