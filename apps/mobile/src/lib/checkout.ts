import type { Product, Variant } from '@pos/contracts';
import { type Cart, type CartItem, emptyCart } from '@pos/domain';
import { useSyncExternalStore } from 'react';

/**
 * The cart in progress on this device. Kept in memory outside the screen so it
 * survives navigating to the camera scanner and back. The sale id inside it is
 * reused for every submission attempt until the sale is confirmed, which makes
 * retries after a lost response safe. (Surviving an app restart arrives with
 * offline sales in Slice 7.)
 */
let cart: Cart = emptyCart(newSaleId());
const listeners = new Set<() => void>();

export const cartStore = {
  get: () => cart,
  set(next: Cart) {
    cart = next;
    listeners.forEach((listener) => listener());
  },
  reset() {
    cartStore.set(emptyCart(newSaleId()));
  },
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
};

export function useCart(): Cart {
  return useSyncExternalStore(cartStore.subscribe, cartStore.get, cartStore.get);
}

/** Codes read by the camera screen, delivered to whichever screen is listening. */
const scanListeners = new Set<(code: string) => void>();
export const scanBus = {
  publish(code: string) {
    scanListeners.forEach((listener) => listener(code));
  },
  subscribe(listener: (code: string) => void) {
    scanListeners.add(listener);
    return () => {
      scanListeners.delete(listener);
    };
  },
};

export function toCartItem(product: Product, variant: Variant): CartItem {
  return {
    variantId: variant.id,
    productName: product.name,
    sku: variant.sku,
    variantLabel: Object.values(variant.attributes).join(' / '),
    unit: product.unit,
    unitPriceMinor: variant.priceMinor,
    taxRateId: product.taxRateId,
  };
}

export function newSaleId(): string {
  const cryptoApi = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (cryptoApi?.randomUUID) return cryptoApi.randomUUID();
  // RFC 4122 v4 layout from Math.random when the platform lacks crypto.randomUUID.
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}
