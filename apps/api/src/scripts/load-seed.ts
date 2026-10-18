import { randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';

/**
 * Builds businesses for the load tests through the public API, so seeding uses the
 * same validation and business logic as real use. Each shop gets:
 * - prices that include 18 % VAT;
 * - LOAD_PRODUCTS products with valid EAN-13 barcodes, imported by CSV;
 * - stock for all of them;
 * - a second till, and an open shift on each till.
 * Writes the fixture the k6 scripts read.
 *
 *   LOAD_API_URL=http://127.0.0.1:4200/api/v1 LOAD_SHOPS=20 LOAD_PRODUCTS=500 \
 *   LOAD_OUT=../../infra/load/fixture.json node dist/scripts/load-seed.js
 *
 * Only for the load-test database: it creates many accounts.
 */
const API = process.env.LOAD_API_URL ?? 'http://127.0.0.1:4200/api/v1';
const SHOPS = Number(process.env.LOAD_SHOPS ?? 20);
const PRODUCTS = Number(process.env.LOAD_PRODUCTS ?? 500);
const OUT = process.env.LOAD_OUT ?? 'load-fixture.json';
const PASSWORD = 'load-test-river-42';

interface Till {
  shop: number;
  token: string;
  shiftId: string;
  branchId: string;
}
interface Item {
  variantId: string;
  barcode: string;
  priceMinor: number;
}

async function call<T>(method: string, path: string, body?: unknown, token?: string): Promise<T> {
  const response = await fetch(`${API}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'X-POS-Client': 'mobile',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  if (!response.ok)
    throw new Error(`${method} ${path} -> ${response.status}: ${text.slice(0, 300)}`);
  return (text ? JSON.parse(text) : undefined) as T;
}

/** EAN-13 in the 200–299 "in-store" range, with its check digit. */
function ean13(shop: number, item: number): string {
  const body = `2${String(shop).padStart(4, '0')}${String(item).padStart(7, '0')}`;
  const sum = [...body].reduce((total, digit, i) => total + Number(digit) * (i % 2 ? 3 : 1), 0);
  return `${body}${(10 - (sum % 10)) % 10}`;
}

async function seedShop(
  shop: number,
  run: string,
): Promise<{ tills: Till[]; items: Item[]; managerToken: string }> {
  const email = `load.${run}.${shop}@example.com`;
  const session = await call<{ accessToken: string; tenant: { name: string } }>(
    'POST',
    '/auth/register',
    {
      businessName: `Load Shop ${shop}`,
      ownerFullName: `Owner ${shop}`,
      email,
      password: PASSWORD,
      acceptTerms: true,
      clientType: 'MOBILE',
    },
  );
  const owner = session.accessToken;
  await call(
    'POST',
    '/tenant/onboarding',
    { businessName: `Load Shop ${shop}`, businessType: 'GENERAL_RETAIL' },
    owner,
  );
  const settings = await call<{ version: number }>('GET', '/settings', undefined, owner);
  await call(
    'PATCH',
    '/settings',
    { version: settings.version, checkout: { pricesIncludeTax: true } },
    owner,
  );
  await call('POST', '/tax-rates', { name: 'VAT', rateBp: 1800, isDefault: true }, owner);

  const rows = Array.from({ length: PRODUCTS }, (_, i) => {
    const price = (100 + ((i * 37) % 4900)).toFixed(2);
    return `Item ${shop}-${i},General,Brand ${i % 25},piece,S${shop}-${i},${ean13(shop, i)},${price},${(Number(price) * 0.6).toFixed(2)},,,ACTIVE`;
  });
  const csv = [
    'product_name,category,brand,unit,sku,barcode,price,cost,pack_size,reorder_level,status',
    ...rows,
  ].join('\n');
  await call('POST', '/products/import', { csv, dryRun: false }, owner);

  const items: Item[] = [];
  let cursor: string | null = null;
  do {
    const page: {
      items: Array<{ variants: Array<{ id: string; barcode: string; priceMinor: number }> }>;
      nextCursor: string | null;
    } = await call(
      'GET',
      `/products?limit=100${cursor ? `&cursor=${cursor}` : ''}`,
      undefined,
      owner,
    );
    for (const product of page.items)
      for (const variant of product.variants)
        items.push({
          variantId: variant.id,
          barcode: variant.barcode,
          priceMinor: variant.priceMinor,
        });
    cursor = page.nextCursor;
  } while (cursor);

  const branches = await call<{ items: Array<{ id: string; registers: Array<{ id: string }> }> }>(
    'GET',
    '/branches',
    undefined,
    owner,
  );
  const branch = branches.items[0]!;
  for (let start = 0; start < items.length; start += 500)
    await call(
      'POST',
      '/goods-receipts',
      {
        id: randomUUID(),
        branchId: branch.id,
        lines: items.slice(start, start + 500).map((item) => ({
          variantId: item.variantId,
          quantity: '100000',
          unitCostMinor: Math.round(item.priceMinor * 0.6),
        })),
      },
      owner,
    );
  const second = await call<{ id: string }>(
    'POST',
    '/registers',
    { branchId: branch.id, code: 'TILL2', name: 'Till 2' },
    owner,
  );

  // One sign-in per till, as each device would have its own session.
  const tills: Till[] = [];
  for (const registerId of [branch.registers[0]!.id, second.id]) {
    const login = await call<{ accessToken: string }>('POST', '/auth/login', {
      email,
      password: PASSWORD,
      clientType: 'MOBILE',
    });
    const shift = await call<{ id: string }>(
      'POST',
      '/shifts',
      { registerId, openingFloatMinor: 500_000 },
      login.accessToken,
    );
    tills.push({ shop, token: login.accessToken, shiftId: shift.id, branchId: branch.id });
  }
  return { tills, items, managerToken: owner };
}

async function main(): Promise<void> {
  const run = Date.now().toString(36);
  const started = Date.now();
  const shops = [];
  // A few shops at a time: registration and sign-in hash passwords (expensive by design).
  for (let i = 0; i < SHOPS; i += 4) {
    const batch = await Promise.all(
      Array.from({ length: Math.min(4, SHOPS - i) }, (_, j) => seedShop(i + j, run)),
    );
    shops.push(...batch);
    process.stdout.write(`seeded ${shops.length}/${SHOPS} shops\n`);
  }
  writeFileSync(
    OUT,
    JSON.stringify(
      shops.map((shop) => ({
        tills: shop.tills,
        items: shop.items,
        managerToken: shop.managerToken,
      })),
    ),
  );
  process.stdout.write(`wrote ${OUT} in ${Math.round((Date.now() - started) / 1000)} s\n`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
