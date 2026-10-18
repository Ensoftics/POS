import { isApiError } from '@pos/api-client';
import { parseMoney } from '@pos/domain';
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
import { useLoad } from '@/lib/use-load';

/** Cash put into or taken out of the drawer during a shift; pay-outs need a manager. */
export default function CashScreen() {
  const { t } = useTranslation();
  const { id: shiftId } = useLocalSearchParams<{ id: string }>();
  const [settings] = useLoad(() => api.settings.get());
  const approval = useApproval();
  // One id per entry: a retry after a lost response cannot record it twice.
  const [movementId] = useState(newSaleId);
  const [type, setType] = useState<'PAY_IN' | 'PAY_OUT'>('PAY_IN');
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  if (settings.status !== 'ready')
    return <View style={screenStyles.center} accessibilityLabel={t('common.loading')} />;
  const currency = settings.data.currency;

  const save = async () => {
    const parsed = parseMoney(amount, currency);
    if (!parsed.ok || parsed.minor === 0) return setError(t('validation.payment.amount_positive'));
    if (!reason.trim()) return setError(t('validation.required'));
    setBusy(true);
    setError(null);
    try {
      const result = await approval.run('PAY_OUT', (given) =>
        api.shifts.cashMovement(shiftId, {
          id: movementId,
          type,
          amountMinor: parsed.minor,
          reason,
          ...(given ? { approval: given } : {}),
        }),
      );
      if (result) setDone(true);
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
          {t('mobile.cash.title')}
        </Text>
        {done ? (
          <>
            <Banner tone="success">{t('pos.shift.cashRecorded')}</Banner>
            <Button label={t('mobile.sell.done')} onPress={() => router.back()} />
          </>
        ) : (
          <>
            {error ? <Banner tone="danger">{error}</Banner> : null}
            <View style={styles.chips} accessibilityRole="radiogroup">
              {(['PAY_IN', 'PAY_OUT'] as const).map((value) => (
                <Pressable
                  key={value}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: type === value }}
                  onPress={() => setType(value)}
                  style={[styles.chip, type === value && styles.chipActive]}
                >
                  <Text style={type === value ? styles.chipTextActive : styles.chipText}>
                    {value === 'PAY_IN' ? t('pos.shift.payIn') : t('pos.shift.payOut')}
                  </Text>
                </Pressable>
              ))}
            </View>
            <TextField
              label={`${t('pos.shift.cashAmount')} (${currency})`}
              value={amount}
              onChangeText={setAmount}
              keyboardType="decimal-pad"
            />
            <TextField
              label={t('pos.shift.cashReason')}
              value={reason}
              onChangeText={setReason}
              maxLength={200}
            />
            <Text style={screenStyles.subtitle}>{t('pos.shift.cashReasonHint')}</Text>
            <Button label={t('pos.shift.cashSave')} loading={busy} onPress={() => void save()} />
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
  chips: { flexDirection: 'row', gap: spacing[2] },
  chip: {
    minHeight: touchTarget,
    paddingHorizontal: spacing[4],
    justifyContent: 'center',
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.neutral[300],
    backgroundColor: colors.neutral[0],
  },
  chipActive: { backgroundColor: colors.brand[700], borderColor: colors.brand[700] },
  chipText: { color: colors.neutral[800], fontSize: fontSizes.md },
  chipTextActive: { color: colors.neutral[0], fontSize: fontSizes.md, fontWeight: '600' },
});
