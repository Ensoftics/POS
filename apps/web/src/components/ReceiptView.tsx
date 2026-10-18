import type { Receipt } from '@pos/contracts';
import { type CurrencyCode, formatMoney, formatPercent, isCurrencyCode } from '@pos/domain';
import { INTL_LOCALES, isSupportedLanguage } from '@pos/i18n';
import { useTranslation } from 'react-i18next';
import { useBusinessDateTime } from '../lib/sales';

/**
 * A receipt laid out for an 80 mm roll printer. Printing (window.print) shows only
 * the element marked `print-area`, so the app chrome never reaches the paper.
 */
export function ReceiptView({ receipt }: { receipt: Receipt }) {
  const { t, i18n } = useTranslation();
  const { business, sale } = receipt;
  const locale = isSupportedLanguage(i18n.resolvedLanguage)
    ? INTL_LOCALES[i18n.resolvedLanguage]
    : 'en-LK';
  const currency: CurrencyCode = isCurrencyCode(sale.currency) ? sale.currency : 'LKR';
  const money = (minor: number) => formatMoney(minor, currency, locale);
  const dateTime = useBusinessDateTime(business.timezone);

  return (
    <article
      aria-label={t('sales.receipt.title')}
      className="print-area mx-auto w-full max-w-sm bg-white p-5 font-mono text-[13px] leading-snug text-neutral-900 shadow-sm ring-1 ring-neutral-200"
    >
      <header className="space-y-0.5 text-center">
        <p className="text-base font-bold">{business.name}</p>
        {business.legalName && business.legalName !== business.name && <p>{business.legalName}</p>}
        {business.addressLines.map((line) => (
          <p key={line}>{line}</p>
        ))}
        <p>
          {business.branchName}
          {business.branchAddress ? ` · ${business.branchAddress}` : ''}
        </p>
        {business.branchPhone && <p>{business.branchPhone}</p>}
        {business.taxRegistrationNumber && (
          <p>{t('sales.receipt.taxNumber', { number: business.taxRegistrationNumber })}</p>
        )}
      </header>

      <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-3 border-y border-dashed border-neutral-400 py-2">
        <dt>{t('sales.number')}</dt>
        <dd className="text-right font-bold">{sale.number || t('offline.pendingNumber')}</dd>
        <dt>{t('sales.receipt.date')}</dt>
        <dd className="text-right">{dateTime(sale.createdAt)}</dd>
        <dt>{t('sales.receipt.register')}</dt>
        <dd className="text-right">
          {sale.registerName} · {sale.shiftNumber}
        </dd>
        {sale.customerName && (
          <>
            <dt>{t('sales.receipt.customer')}</dt>
            <dd className="text-right">{sale.customerName}</dd>
          </>
        )}
        {sale.cashierName && (
          <>
            <dt>{t('sales.receipt.cashier')}</dt>
            <dd className="text-right">{sale.cashierName}</dd>
          </>
        )}
      </dl>

      <ul className="space-y-1.5 py-2">
        {sale.lines.map((line, index) => (
          <li key={`${line.variantId}-${index}`}>
            <p>
              {line.productName}
              {line.variantLabel ? ` (${line.variantLabel})` : ''}
            </p>
            <p className="flex justify-between gap-2">
              <span>
                {t('sales.receipt.qtyAt', {
                  qty: line.quantity,
                  price: money(line.unitPriceMinor),
                })}
              </span>
              <span>{money(line.grossMinor)}</span>
            </p>
            {line.lineDiscountMinor > 0 && (
              <p className="flex justify-between gap-2 pl-2">
                <span>{t('sales.receipt.lineDiscount')}</span>
                <span>-{money(line.lineDiscountMinor)}</span>
              </p>
            )}
          </li>
        ))}
      </ul>

      <dl className="grid grid-cols-[1fr_auto] gap-x-3 border-t border-dashed border-neutral-400 pt-2">
        <dt>{t('sales.receipt.subtotal')}</dt>
        <dd className="text-right">{money(sale.subtotalMinor)}</dd>
        {sale.discountMinor > 0 && (
          <>
            <dt>{t('sales.receipt.discount')}</dt>
            <dd className="text-right">-{money(sale.discountMinor)}</dd>
          </>
        )}
        {!sale.pricesIncludeTax &&
          sale.taxSummary.map((tax) => (
            <TaxRow
              key={`${tax.name}-${tax.rateBp}`}
              label={t('sales.receipt.taxAddedLine', {
                name: tax.name ?? '',
                rate: formatPercent(tax.rateBp),
              })}
              amount={money(tax.taxMinor)}
            />
          ))}
        <dt className="text-base font-bold">{t('sales.receipt.total')}</dt>
        <dd className="text-right text-base font-bold">{money(sale.totalMinor)}</dd>
        {sale.payments.map((payment, index) => (
          <TaxRow
            key={`${payment.method}-${index}`}
            label={`${t(`paymentMethods.${payment.method}`)}${
              payment.reference
                ? ` (${t('sales.receipt.ref', { reference: payment.reference })})`
                : ''
            }`}
            amount={money(payment.amountMinor)}
          />
        ))}
        {sale.changeMinor > 0 && (
          <TaxRow label={t('sales.receipt.change')} amount={money(sale.changeMinor)} />
        )}
        {sale.pricesIncludeTax &&
          sale.taxSummary.map((tax) => (
            <TaxRow
              key={`${tax.name}-${tax.rateBp}`}
              label={t('sales.receipt.taxIncludedLine', {
                name: tax.name ?? '',
                rate: formatPercent(tax.rateBp),
              })}
              amount={money(tax.taxMinor)}
            />
          ))}
      </dl>

      {(!!sale.pointsEarned ||
        !!sale.pointsRedeemed ||
        typeof receipt.loyaltyBalance === 'number') &&
        sale.customerId && (
          <div className="mt-2 border-t border-dashed border-neutral-400 pt-2 text-center">
            {!!sale.pointsRedeemed && (
              <p>{t('loyalty.redeemed', { points: sale.pointsRedeemed })}</p>
            )}
            {!!sale.pointsEarned && <p>{t('loyalty.earned', { points: sale.pointsEarned })}</p>}
            {typeof receipt.loyaltyBalance === 'number' && (
              <p className="font-semibold">
                {t('loyalty.newBalance', { points: receipt.loyaltyBalance })}
              </p>
            )}
          </div>
        )}

      {business.footer && (
        <p className="mt-3 whitespace-pre-line border-t border-dashed border-neutral-400 pt-2 text-center">
          {business.footer}
        </p>
      )}
    </article>
  );
}

function TaxRow({ label, amount }: { label: string; amount: string }) {
  return (
    <>
      <dt>{label}</dt>
      <dd className="text-right">{amount}</dd>
    </>
  );
}
