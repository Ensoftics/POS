import { colors, fontSizes, radii, spacing, touchTarget } from '@pos/ui-tokens';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Banner, Button, screenStyles } from '@/components/ui';
import {
  type FoundPrinter,
  findPrinterLink,
  PrinterError,
  type PrinterProblem,
  scanForPrinters,
  sendToPrinter,
} from '@/lib/printing/bluetooth';
import { testPageJob } from '@/lib/printing/test-page';
import { type SavedPrinter, savePrinter, useSavedPrinter } from '@/lib/printing/printer-store';

const problemOf = (error: unknown): PrinterProblem =>
  error instanceof PrinterError ? error.problem : 'send_failed';

/** Choose this till's Bluetooth receipt printer, its paper width and auto-printing. */
export default function PrinterScreen() {
  const { t } = useTranslation();
  const saved = useSavedPrinter();
  const [found, setFound] = useState<FoundPrinter[]>([]);
  const [scanning, setScanning] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);
  const stopScan = useRef<(() => void) | null>(null);

  useEffect(() => () => stopScan.current?.(), []);

  const fail = (error: unknown) =>
    setNotice({ tone: 'danger', text: t(`printing.errors.${problemOf(error)}`) });

  const scan = async () => {
    setFound([]);
    setNotice(null);
    setScanning(true);
    try {
      stopScan.current = await scanForPrinters(
        (printer) => setFound((list) => [...list, printer]),
        (problem) => {
          setScanning(false);
          stopScan.current = null;
          if (problem) setNotice({ tone: 'danger', text: t(`printing.errors.${problem}`) });
        },
      );
    } catch (error) {
      setScanning(false);
      fail(error);
    }
  };

  const choose = async (printer: FoundPrinter) => {
    stopScan.current?.();
    setBusy(printer.id);
    setNotice(null);
    try {
      const link = await findPrinterLink(printer.id);
      await savePrinter({
        id: printer.id,
        name: printer.name,
        ...link,
        paperWidth: saved?.paperWidth ?? 58,
        autoPrint: saved?.autoPrint ?? false,
      });
      setFound([]);
      setNotice({ tone: 'success', text: t('printing.saved', { name: printer.name }) });
    } catch (error) {
      fail(error);
    } finally {
      setBusy(null);
    }
  };

  const update = (changes: Partial<SavedPrinter>) =>
    saved ? void savePrinter({ ...saved, ...changes }) : undefined;

  const testPrint = async () => {
    if (!saved) return;
    setBusy('test');
    setNotice(null);
    try {
      await sendToPrinter(saved, testPageJob(saved.paperWidth));
      setNotice({ tone: 'success', text: t('printing.testSent') });
    } catch (error) {
      fail(error);
    } finally {
      setBusy(null);
    }
  };

  return (
    <SafeAreaView style={{ flex: 1 }}>
      <ScrollView contentContainerStyle={screenStyles.container}>
        <Text accessibilityRole="header" style={screenStyles.title}>
          {t('printing.title')}
        </Text>
        <Text style={screenStyles.subtitle}>{t('printing.intro')}</Text>
        {notice ? <Banner tone={notice.tone}>{notice.text}</Banner> : null}

        {saved ? (
          <View style={screenStyles.card}>
            <Text style={screenStyles.rowLabel}>{t('printing.current')}</Text>
            <Text style={screenStyles.rowValue}>{saved.name}</Text>
            <Text style={screenStyles.rowLabel}>{t('printing.paper')}</Text>
            <View style={styles.chips} accessibilityRole="radiogroup">
              {([58, 80] as const).map((width) => (
                <Pressable
                  key={width}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: saved.paperWidth === width }}
                  onPress={() => update({ paperWidth: width })}
                  style={[styles.chip, saved.paperWidth === width && styles.chipActive]}
                >
                  <Text
                    style={saved.paperWidth === width ? styles.chipTextActive : styles.chipText}
                  >
                    {t('printing.paperWidth', { mm: width })}
                  </Text>
                </Pressable>
              ))}
            </View>
            <View style={styles.switchRow}>
              <Text style={[screenStyles.rowValue, { flex: 1 }]}>{t('printing.autoPrint')}</Text>
              <Switch
                accessibilityLabel={t('printing.autoPrint')}
                value={saved.autoPrint}
                onValueChange={(autoPrint) => update({ autoPrint })}
              />
            </View>
            <Button
              label={t('printing.test')}
              loading={busy === 'test'}
              disabled={busy !== null}
              onPress={() => void testPrint()}
            />
            <Button
              variant="danger"
              label={t('printing.forget')}
              disabled={busy !== null}
              onPress={() => {
                setNotice(null);
                void savePrinter(null);
              }}
            />
          </View>
        ) : saved === null ? (
          <Text style={screenStyles.subtitle}>{t('printing.none')}</Text>
        ) : null}

        <Button
          variant={saved ? 'secondary' : 'primary'}
          label={scanning ? t('printing.searching') : t('printing.find')}
          loading={scanning}
          disabled={busy !== null}
          onPress={() => void scan()}
        />
        {found.length > 0 ? (
          <View style={screenStyles.card} accessibilityLabel={t('printing.found')}>
            <Text style={screenStyles.rowLabel}>{t('printing.choose')}</Text>
            {found.map((printer) => (
              <Button
                key={printer.id}
                variant="secondary"
                label={printer.name}
                loading={busy === printer.id}
                disabled={busy !== null}
                onPress={() => void choose(printer)}
              />
            ))}
          </View>
        ) : null}
        <Text style={screenStyles.subtitle}>{t('printing.help')}</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
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
  switchRow: { flexDirection: 'row', alignItems: 'center', minHeight: touchTarget },
});
