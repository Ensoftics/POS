// Shared helpers for the k6 scripts.
import { SharedArray } from 'k6/data';

export const API = __ENV.API_URL || 'http://host.docker.internal:4200/api/v1';

export const shops = new SharedArray('shops', () => JSON.parse(open('../fixture.json')));
export const tills = new SharedArray('tills', () =>
  JSON.parse(open('../fixture.json')).flatMap((shop, index) =>
    shop.tills.map((till) => ({ ...till, shopIndex: index })),
  ),
);

export const uuid = () =>
  'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });

export const pick = (list) => list[Math.floor(Math.random() * list.length)];

export function params(token, name) {
  return {
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'X-POS-Client': 'mobile',
    },
    tags: { name },
  };
}

export function basket(items, size) {
  const lines = [];
  for (let i = 0; i < size; i += 1) lines.push({ item: pick(items), quantity: 1 + (i % 2) });
  return lines;
}

/** A cash sale as a till sends it; prices include tax, so the total is the shelf total. */
export function saleBody(till, lines, offline) {
  const total = lines.reduce((sum, line) => sum + line.item.priceMinor * line.quantity, 0);
  return JSON.stringify({
    id: uuid(),
    shiftId: till.shiftId,
    lines: lines.map((line) => ({
      variantId: line.item.variantId,
      quantity: String(line.quantity),
    })),
    payments: [{ method: 'CASH', amountMinor: total }],
    expectedTotalMinor: total,
    ...(offline
      ? {
          offline: {
            capturedAt: new Date(Date.now() - 60_000).toISOString(),
            pricesIncludeTax: true,
            lines: lines.map((line) => ({ unitPriceMinor: line.item.priceMinor, taxRateBp: 1800 })),
          },
        }
      : {}),
  });
}
