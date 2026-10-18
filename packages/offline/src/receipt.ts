import type { CreateSaleRequest, Receipt, Shift, TenantSettings } from '@pos/contracts';
import { type Cart, type CartTotals, lineTotalMinor } from '@pos/domain';

/**
 * A receipt for a sale saved on this device and not yet sent. It is built from
 * the same numbers that will be sent, so it matches what the server records; the
 * receipt number is assigned when the sale syncs (shown as pending until then).
 */
export function buildLocalReceipt(input: {
  request: CreateSaleRequest;
  cart: Cart;
  totals: CartTotals;
  changeMinor: number;
  shift: Shift;
  settings: TenantSettings;
  businessName: string;
  cashierName: string;
  customer?: { id: string; name: string } | null;
}): Receipt {
  const { request, cart, totals, settings, shift } = input;
  const offline = request.offline!;
  const taxGroups = new Map<number, { taxableMinor: number; taxMinor: number }>();
  totals.lines.forEach((line, index) => {
    const rate = offline.lines[index]!.taxRateBp;
    const group = taxGroups.get(rate) ?? { taxableMinor: 0, taxMinor: 0 };
    group.taxableMinor += line.totalMinor - line.taxMinor;
    group.taxMinor += line.taxMinor;
    taxGroups.set(rate, group);
  });
  const paid = request.payments.reduce((sum, p) => sum + p.amountMinor, 0);
  return {
    business: {
      name: input.businessName,
      legalName: settings.legalName,
      taxRegistrationNumber: settings.taxRegistrationNumber,
      addressLines: [settings.addressLine1, settings.addressLine2, settings.city].filter(
        (l): l is string => !!l,
      ),
      branchName: shift.branchName,
      branchAddress: null,
      branchPhone: null,
      footer: settings.checkout.receiptFooter,
      timezone: settings.timezone,
    },
    sale: {
      id: request.id,
      number: '',
      status: 'COMPLETED',
      branchId: shift.branchId,
      branchName: shift.branchName,
      registerId: shift.registerId,
      registerName: shift.registerName,
      shiftId: shift.id,
      shiftNumber: shift.number,
      cashierName: input.cashierName,
      customerId: input.customer?.id ?? null,
      customerName: input.customer?.name ?? null,
      currency: settings.currency,
      pricesIncludeTax: offline.pricesIncludeTax,
      discount: cart.discount,
      subtotalMinor: totals.subtotalMinor,
      discountMinor: totals.discountMinor,
      taxMinor: totals.taxMinor,
      totalMinor: totals.totalMinor,
      paidMinor: paid,
      changeMinor: input.changeMinor,
      notes: null,
      createdAt: offline.capturedAt,
      lines: cart.lines.map((line, index) => ({
        id: line.key,
        variantId: line.variantId,
        productName: line.productName,
        sku: line.sku,
        variantLabel: line.variantLabel,
        unit: line.unit,
        quantity: line.quantity,
        unitPriceMinor: line.unitPriceMinor,
        grossMinor: lineTotalMinor(line.unitPriceMinor, line.quantity),
        discount: line.discount,
        lineDiscountMinor: totals.lines[index]!.lineDiscountMinor,
        cartDiscountMinor: totals.lines[index]!.cartDiscountMinor,
        taxName: null,
        taxRateBp: offline.lines[index]!.taxRateBp,
        taxMinor: totals.lines[index]!.taxMinor,
        totalMinor: totals.lines[index]!.totalMinor,
        returnedQuantity: '0',
        refundedMinor: 0,
        refundedTaxMinor: 0,
      })),
      payments: request.payments.map((p) => ({
        method: p.method,
        amountMinor: p.amountMinor,
        reference: p.reference ?? null,
      })),
      taxSummary: [...taxGroups.entries()]
        .filter(([rate]) => rate > 0)
        .map(([rateBp, group]) => ({ name: null, rateBp, ...group })),
      approvedByName: null,
      returnStatus: 'NONE',
      voided: false,
      refundedMinor: 0,
      refundable: [],
      returns: [],
      capturedOffline: true,
      syncedAt: null,
      conflicts: [],
    },
  };
}
