import type { Receipt } from '@pos/contracts';
import { formatPercent } from '@pos/domain';
import { type ComponentRef, type Ref, useImperativeHandle, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, Text, View } from 'react-native';
import type { PrintableView } from '@/lib/printing/print';

// Layout width per paper size; the capture is scaled to the printer's dots.
const LAYOUT_WIDTH = { 58: 300, 80: 450 } as const;

/**
 * The receipt as it prints: black on white, one column, no decoration. Kept
 * off screen; `ref` gives the printer code the view and its size.
 */
export function PrintableReceipt({
  receipt,
  money,
  paperWidth,
  ref,
  onReady,
}: {
  receipt: Receipt;
  money: (minor: number) => string;
  paperWidth: 58 | 80;
  ref: Ref<{ printable: () => PrintableView | null }>;
  /** Called once, when the receipt has been laid out and can be printed. */
  onReady?: () => void;
}) {
  const { t, i18n } = useTranslation();
  const view = useRef<ComponentRef<typeof View>>(null);
  const size = useRef<{ width: number; height: number } | null>(null);
  useImperativeHandle(ref, () => ({
    printable: () =>
      view.current && size.current ? { view: view.current, ...size.current } : null,
  }));
  const { sale, business } = receipt;
  const when = new Intl.DateTimeFormat(i18n.resolvedLanguage, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(sale.createdAt));

  return (
    <View
      ref={view}
      testID="printable-receipt"
      collapsable={false}
      onLayout={(event) => {
        const first = size.current === null;
        size.current = event.nativeEvent.layout;
        if (first) onReady?.();
      }}
      style={[styles.paper, { width: LAYOUT_WIDTH[paperWidth] }]}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      {business.name ? <Text style={[styles.text, styles.title]}>{business.name}</Text> : null}
      {business.addressLines.map((line, index) => (
        <Text key={index} style={[styles.text, styles.center]}>
          {line}
        </Text>
      ))}
      <Text style={[styles.text, styles.center]}>
        {[business.branchName, business.branchAddress, business.branchPhone]
          .filter(Boolean)
          .join(' · ')}
      </Text>
      {business.taxRegistrationNumber ? (
        <Text style={[styles.text, styles.center]}>
          {t('sales.receipt.taxNumber', { number: business.taxRegistrationNumber })}
        </Text>
      ) : null}
      <Text style={[styles.text, styles.center]}>
        {sale.number || t('offline.pendingNumber')} · {when}
      </Text>
      <View style={styles.rule} />
      {sale.lines.map((line, index) => (
        <View key={index}>
          <Text style={styles.text}>{line.productName}</Text>
          <View style={styles.row}>
            <Text style={styles.text}>
              {t('sales.receipt.qtyAt', { qty: line.quantity, price: money(line.unitPriceMinor) })}
            </Text>
            <Text style={styles.text}>{money(line.totalMinor)}</Text>
          </View>
        </View>
      ))}
      <View style={styles.rule} />
      {sale.discountMinor > 0 ? (
        <Row label={t('sales.receipt.discount')} value={`-${money(sale.discountMinor)}`} />
      ) : null}
      {!sale.pricesIncludeTax &&
        sale.taxSummary.map((tax) => (
          <Row
            key={`${tax.name}-${tax.rateBp}`}
            label={t('sales.receipt.taxAddedLine', {
              name: tax.name ?? '',
              rate: formatPercent(tax.rateBp),
            })}
            value={money(tax.taxMinor)}
          />
        ))}
      <Row label={t('sales.receipt.total')} value={money(sale.totalMinor)} bold />
      {sale.payments.map((payment, index) => (
        <Row
          key={index}
          label={t(`paymentMethods.${payment.method}`)}
          value={money(payment.amountMinor)}
        />
      ))}
      {sale.changeMinor > 0 ? (
        <Row label={t('sales.receipt.change')} value={money(sale.changeMinor)} />
      ) : null}
      {sale.pricesIncludeTax &&
        sale.taxSummary.map((tax) => (
          <Row
            key={`${tax.name}-${tax.rateBp}`}
            label={t('sales.receipt.taxIncludedLine', {
              name: tax.name ?? '',
              rate: formatPercent(tax.rateBp),
            })}
            value={money(tax.taxMinor)}
          />
        ))}
      {sale.pointsEarned ? (
        <Text style={styles.text}>{t('loyalty.earned', { points: sale.pointsEarned })}</Text>
      ) : null}
      {typeof receipt.loyaltyBalance === 'number' ? (
        <Text style={styles.text}>
          {t('loyalty.newBalance', { points: receipt.loyaltyBalance })}
        </Text>
      ) : null}
      {business.footer ? (
        <Text style={[styles.text, styles.center, styles.footer]}>{business.footer}</Text>
      ) : null}
    </View>
  );
}

function Row({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <View style={styles.row}>
      <Text style={[styles.text, bold && styles.bold]}>{label}</Text>
      <Text style={[styles.text, bold && styles.bold]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  paper: {
    position: 'absolute',
    left: -10_000,
    top: 0,
    backgroundColor: '#ffffff',
    paddingVertical: 8,
    gap: 2,
  },
  text: { color: '#000000', fontSize: 15, lineHeight: 20 },
  title: { fontSize: 19, lineHeight: 26, fontWeight: '700', textAlign: 'center' },
  center: { textAlign: 'center' },
  bold: { fontWeight: '700', fontSize: 17 },
  row: { flexDirection: 'row', justifyContent: 'space-between', gap: 8 },
  rule: { borderBottomWidth: 1, borderColor: '#000000', marginVertical: 4 },
  footer: { marginTop: 8 },
});
