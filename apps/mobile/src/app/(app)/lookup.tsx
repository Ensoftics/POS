import { isApiError } from '@pos/api-client';
import type { VariantLookup } from '@pos/contracts';
import { type CurrencyCode, formatMoney } from '@pos/domain';
import { INTL_LOCALES, isSupportedLanguage } from '@pos/i18n';
import { type ComponentRef, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Image, ScrollView, Text, type TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Banner, Button, screenStyles, TextField } from '@/components/ui';
import { api } from '@/lib/api';
import { readDeviceRegister } from '@/lib/device-register';
import { errorMessage } from '@/lib/errors';
import { useSession } from '@/lib/session';
import { useLoad } from '@/lib/use-load';

/**
 * Price check. Works with keyboard-wedge (USB/Bluetooth HID) scanners, which type
 * the code into the focused field and press Enter, and with manual entry.
 * Camera scanning needs a native module and arrives with the checkout screen.
 */
export default function LookupScreen() {
  const { t, i18n } = useTranslation();
  const input = useRef<ComponentRef<typeof TextInput>>(null);
  const [code, setCode] = useState('');
  const [result, setResult] = useState<VariantLookup | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [stock, setStock] = useState<{ branchName: string; quantity: string; unit: string } | null>(
    null,
  );
  const session = useSession();
  const tenantId = session.status === 'authenticated' ? session.context.tenant.id : null;
  const [settings] = useLoad(() => api.settings.get());
  const locale = isSupportedLanguage(i18n.resolvedLanguage)
    ? INTL_LOCALES[i18n.resolvedLanguage]
    : 'en-LK';

  const lookUp = async () => {
    const value = code.trim();
    if (!value) return;
    setBusy(true);
    setMessage(null);
    setStock(null);
    try {
      const found = await api.products.lookup(value);
      setResult(found);
      void loadStock(found.variant.sku);
    } catch (error) {
      setResult(null);
      setMessage(
        isApiError(error) && error.code === 'NOT_FOUND'
          ? t('mobile.lookup.notFound', { code: value })
          : errorMessage(t, error),
      );
    } finally {
      setBusy(false);
      setCode('');
      // Ready for the next scan.
      input.current?.focus();
    }
  };

  /** Quantity at this device's branch; skipped quietly when no register is chosen or it fails. */
  const loadStock = async (sku: string) => {
    if (!tenantId) return;
    const register = await readDeviceRegister(tenantId);
    if (!register) return;
    try {
      const page = await api.stock.list({ branchId: register.branchId, q: sku, limit: 5 });
      const row = page.items.find((item) => item.sku === sku);
      if (row)
        setStock({ branchName: register.branchName, quantity: row.quantity, unit: row.unit });
    } catch {
      // Price check still works without stock information.
    }
  };

  const currency = settings.status === 'ready' ? (settings.data.currency as CurrencyCode) : null;
  const options = result
    ? Object.entries(result.variant.attributes)
        .map(([name, value]) => `${t(`settings.profile.attributes.${name}`)}: ${value}`)
        .join(' · ')
    : '';

  return (
    <SafeAreaView style={{ flex: 1 }}>
      <ScrollView
        contentContainerStyle={screenStyles.container}
        keyboardShouldPersistTaps="handled"
      >
        <Text accessibilityRole="header" style={screenStyles.title}>
          {t('mobile.lookup.title')}
        </Text>
        <TextField
          ref={input}
          label={t('mobile.lookup.code')}
          value={code}
          onChangeText={setCode}
          autoFocus
          autoCapitalize="characters"
          autoCorrect={false}
          returnKeyType="search"
          submitBehavior="submit"
          onSubmitEditing={() => void lookUp()}
        />
        <Text style={screenStyles.subtitle}>{t('mobile.lookup.codeHint')}</Text>
        <Button label={t('mobile.lookup.submit')} loading={busy} onPress={() => void lookUp()} />

        {message ? <Banner tone="warning">{message}</Banner> : null}
        {result ? (
          <View style={screenStyles.card} accessibilityLiveRegion="polite">
            {result.product.images?.[0] ? (
              <Image
                source={{ uri: result.product.images[0].thumbUrl }}
                accessibilityLabel={t('mobile.lookup.photo', { name: result.product.name })}
                resizeMode="contain"
                style={{ width: '100%', height: 200, borderRadius: 8, backgroundColor: '#f5f5f5' }}
              />
            ) : null}
            <Text accessibilityRole="header" style={screenStyles.rowValue}>
              {result.product.name}
            </Text>
            {options ? <Text style={screenStyles.rowLabel}>{options}</Text> : null}
            <Text style={screenStyles.rowLabel}>{result.variant.sku}</Text>
            <Text style={screenStyles.rowLabel}>{t('mobile.lookup.price')}</Text>
            <Text style={[screenStyles.title, { fontVariant: ['tabular-nums'] }]}>
              {currency ? formatMoney(result.variant.priceMinor, currency, locale) : '…'}
            </Text>
            {stock ? (
              <Text style={screenStyles.rowLabel}>
                {t('mobile.lookup.stock', { branch: stock.branchName })}:{' '}
                <Text style={screenStyles.rowValue}>
                  {stock.quantity}{' '}
                  {t(`settings.profile.units.${stock.unit}`, { defaultValue: stock.unit })}
                </Text>
              </Text>
            ) : null}
          </View>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}
