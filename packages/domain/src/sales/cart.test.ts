import { describe, expect, it } from 'vitest';
import {
  addToCart,
  type CartItem,
  emptyCart,
  priceCart,
  removeLine,
  repriceCart,
  resolveTaxRateBp,
  setCartDiscount,
  setLineDiscount,
  setLineQuantity,
} from './cart';

const soap: CartItem = {
  variantId: 'v1',
  productName: 'Soap',
  sku: 'SOAP',
  variantLabel: '',
  unit: 'piece',
  unitPriceMinor: 11_800,
  taxRateId: null,
};
const fabric: CartItem = {
  ...soap,
  variantId: 'v2',
  sku: 'FAB',
  unit: 'metre',
  unitPriceMinor: 45_000,
  taxRateId: 'zero',
};
const rates = [
  { id: 'vat', rateBp: 1800, isDefault: true, status: 'ACTIVE' as const },
  { id: 'zero', rateBp: 0, isDefault: false, status: 'ACTIVE' as const },
];

describe('cart', () => {
  it('merges repeated scans and keeps the sale id', () => {
    let cart = addToCart(emptyCart('sale-1'), soap);
    cart = addToCart(cart, soap);
    cart = addToCart(cart, fabric, '2.5');
    expect(cart.saleId).toBe('sale-1');
    expect(cart.lines.map((l) => [l.sku, l.quantity])).toEqual([
      ['SOAP', '2'],
      ['FAB', '2.5'],
    ]);
  });

  it('starts a new line when the existing one has its own discount', () => {
    let cart = addToCart(emptyCart('s'), soap);
    cart = setLineDiscount(cart, cart.lines[0]!.key, { kind: 'PERCENT', value: 500 });
    cart = addToCart(cart, soap);
    expect(cart.lines).toHaveLength(2);
  });

  it('prices with resolved tax rates and discounts', () => {
    let cart = addToCart(emptyCart('s'), soap, '2');
    cart = addToCart(cart, fabric, '1');
    cart = setCartDiscount(cart, { kind: 'AMOUNT', value: 0 });
    expect(cart.discount).toBeNull();
    const totals = priceCart(cart, rates, true);
    expect(totals.totalMinor).toBe(68_600);
    expect(totals.taxMinor).toBe(3_600); // 18 % contained in 236.00
  });

  it('treats invalid quantities as zero while editing', () => {
    let cart = addToCart(emptyCart('s'), soap);
    cart = setLineQuantity(cart, cart.lines[0]!.key, '');
    expect(priceCart(cart, rates, true).totalMinor).toBe(0);
    cart = removeLine(cart, cart.lines[0]!.key);
    expect(cart.lines).toEqual([]);
  });

  it('reprices from fresh catalogue data', () => {
    const cart = repriceCart(
      addToCart(emptyCart('s'), soap),
      new Map([['v1', { ...soap, unitPriceMinor: 1 }]]),
    );
    expect(cart.lines[0]!.unitPriceMinor).toBe(1);
  });

  it('resolves the default rate only for products without their own', () => {
    expect(resolveTaxRateBp(null, rates)).toBe(1800);
    expect(resolveTaxRateBp('zero', rates)).toBe(0);
    expect(resolveTaxRateBp(null, [])).toBe(0);
  });
});
