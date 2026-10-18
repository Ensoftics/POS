import { fromMilli, toMilli } from '../inventory/inventory';
import { type CartTotals, computeCart, type Discount } from './sales';

/**
 * Till cart state shared by the web and Android checkouts. Pure functions that
 * return a new cart, so either UI can keep it in React state. The `saleId` is
 * generated once per cart and reused for every submission attempt, which is what
 * makes retries after a timeout safe.
 */
export interface CartItem {
  variantId: string;
  productName: string;
  sku: string;
  variantLabel: string;
  unit: string;
  unitPriceMinor: number;
  /** The product's own rate; null means the tenant default applies. */
  taxRateId: string | null;
}

export interface CartLine extends CartItem {
  /** Stable key for list rendering. */
  key: string;
  quantity: string;
  discount: Discount | null;
}

export interface Cart {
  saleId: string;
  lines: CartLine[];
  discount: Discount | null;
}

export interface TaxRateInfo {
  id: string;
  rateBp: number;
  isDefault: boolean;
  status: 'ACTIVE' | 'ARCHIVED';
}

export const emptyCart = (saleId: string): Cart => ({ saleId, lines: [], discount: null });

/**
 * Adds an item. Scanning an item already in the cart (without its own discount)
 * increases that line instead of adding a new one.
 */
export function addToCart(cart: Cart, item: CartItem, quantity = '1'): Cart {
  const index = cart.lines.findIndex((l) => l.variantId === item.variantId && !l.discount);
  if (index >= 0) {
    const line = cart.lines[index]!;
    return replaceLine(cart, index, {
      ...line,
      ...item,
      quantity: fromMilli(toMilli(line.quantity) + toMilli(quantity)),
    });
  }
  const key = `${item.variantId}:${cart.lines.length}:${Date.now().toString(36)}`;
  return { ...cart, lines: [...cart.lines, { ...item, key, quantity, discount: null }] };
}

export function setLineQuantity(cart: Cart, key: string, quantity: string): Cart {
  return mapLine(cart, key, (line) => ({ ...line, quantity }));
}

export function setLineDiscount(cart: Cart, key: string, discount: Discount | null): Cart {
  return mapLine(cart, key, (line) => ({ ...line, discount: discount?.value ? discount : null }));
}

export function removeLine(cart: Cart, key: string): Cart {
  return { ...cart, lines: cart.lines.filter((l) => l.key !== key) };
}

export function setCartDiscount(cart: Cart, discount: Discount | null): Cart {
  return { ...cart, discount: discount?.value ? discount : null };
}

/** Refreshes prices and tax assignment (e.g. after the API reported TOTAL_MISMATCH). */
export function repriceCart(cart: Cart, items: Map<string, CartItem>): Cart {
  return {
    ...cart,
    lines: cart.lines.map((line) => {
      const fresh = items.get(line.variantId);
      return fresh ? { ...line, ...fresh } : line;
    }),
  };
}

/** The product's rate if set, otherwise the active default, otherwise no tax. */
export function resolveTaxRateBp(taxRateId: string | null, rates: TaxRateInfo[]): number {
  const rate = taxRateId
    ? rates.find((r) => r.id === taxRateId)
    : rates.find((r) => r.isDefault && r.status === 'ACTIVE');
  return rate?.rateBp ?? 0;
}

/** True when every quantity is a positive number with at most 3 decimals. */
export function cartQuantitiesValid(cart: Cart): boolean {
  return cart.lines.every(
    (l) => /^\d{1,9}(\.\d{1,3})?$/.test(l.quantity) && Number(l.quantity) > 0,
  );
}

export function priceCart(cart: Cart, rates: TaxRateInfo[], pricesIncludeTax: boolean): CartTotals {
  return computeCart({
    pricesIncludeTax,
    discount: cart.discount,
    lines: cart.lines.map((line) => ({
      unitPriceMinor: line.unitPriceMinor,
      quantity: cartQuantitiesValid({ ...cart, lines: [line] }) ? line.quantity : '0',
      discount: line.discount,
      taxRateBp: resolveTaxRateBp(line.taxRateId, rates),
    })),
  });
}

function mapLine(cart: Cart, key: string, fn: (line: CartLine) => CartLine): Cart {
  return { ...cart, lines: cart.lines.map((line) => (line.key === key ? fn(line) : line)) };
}

function replaceLine(cart: Cart, index: number, line: CartLine): Cart {
  const lines = [...cart.lines];
  lines[index] = line;
  return { ...cart, lines };
}
