import { type BarcodeScanningResult, CameraView, useCameraPermissions } from 'expo-camera';
import { router } from 'expo-router';
import { useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button, screenStyles } from '@/components/ui';
import { scanBus } from '@/lib/checkout';

/** Retail barcode formats; QR is excluded so stray QR codes are not added to the cart. */
const BARCODE_TYPES = ['ean13', 'ean8', 'upc_a', 'upc_e', 'code128', 'code39', 'itf14'] as const;

/** Full-screen camera that reads one barcode and returns it to the till. */
export default function ScanScreen() {
  const { t } = useTranslation();
  const [permission, requestPermission] = useCameraPermissions();
  const done = useRef(false);

  const onScanned = (result: BarcodeScanningResult) => {
    // The camera reports the same code many times per second; take the first.
    if (done.current || !result.data) return;
    done.current = true;
    scanBus.publish(result.data.trim());
    router.back();
  };

  if (!permission) return <View style={screenStyles.center} />;
  if (!permission.granted) {
    return (
      <SafeAreaView style={screenStyles.center}>
        <Text accessibilityRole="header" style={screenStyles.title}>
          {t('mobile.scan.title')}
        </Text>
        <Text style={[screenStyles.subtitle, { textAlign: 'center' }]}>
          {permission.canAskAgain ? t('mobile.scan.permission') : t('mobile.scan.denied')}
        </Text>
        {permission.canAskAgain ? (
          <Button label={t('mobile.scan.allow')} onPress={() => void requestPermission()} />
        ) : null}
        <Button variant="secondary" label={t('mobile.scan.cancel')} onPress={() => router.back()} />
      </SafeAreaView>
    );
  }

  return (
    <View style={styles.root}>
      <CameraView
        style={StyleSheet.absoluteFill}
        facing="back"
        barcodeScannerSettings={{ barcodeTypes: [...BARCODE_TYPES] }}
        onBarcodeScanned={onScanned}
        accessibilityLabel={t('mobile.scan.title')}
      />
      <SafeAreaView style={styles.overlay} pointerEvents="box-none">
        <Text style={styles.hint}>{t('mobile.scan.hint')}</Text>
        <View style={styles.frame} accessibilityElementsHidden importantForAccessibility="no" />
        <Button variant="secondary" label={t('mobile.scan.cancel')} onPress={() => router.back()} />
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000' },
  overlay: { flex: 1, justifyContent: 'space-between', padding: 24 },
  hint: {
    color: '#fff',
    fontSize: 18,
    textAlign: 'center',
    backgroundColor: 'rgba(0,0,0,0.55)',
    padding: 12,
    borderRadius: 8,
  },
  frame: {
    alignSelf: 'center',
    width: '85%',
    height: 160,
    borderWidth: 3,
    borderColor: '#fff',
    borderRadius: 12,
  },
});
