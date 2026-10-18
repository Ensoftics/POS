import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, type Page, test } from '@playwright/test';

async function registerTextileShop(page: Page) {
  const email = `e2e.products.${Date.now()}.${Math.random().toString(36).slice(2, 8)}@example.com`;
  await page.goto('/register');
  await page.getByLabel('Business name').fill('Colombo Threads');
  await page.getByLabel('Your full name').fill('Dilani Fernando');
  await page.getByLabel('Work email').fill(email);
  await page.getByLabel('Password', { exact: true }).fill('blue-mango-river-42');
  await page.getByLabel(/I agree to the Terms/).check();
  await page.getByRole('button', { name: 'Create account' }).click();
  await page.locator('label', { hasText: 'Textiles & clothing' }).click();
  await page.getByRole('button', { name: 'Finish setup' }).click();
  await expect(page.getByRole('heading', { name: 'Hello, Dilani Fernando' })).toBeVisible();
}

test('owner builds a catalogue, scans a barcode, imports and exports CSV', async ({ page }) => {
  await registerTextileShop(page);
  const suffix = Date.now().toString(36).toUpperCase();

  // Create a product with two variants.
  await page.goto('/products/new');
  await page.getByLabel('Product name').fill('Linen Shirt');
  await page.getByLabel('Unit of measure').selectOption('piece');
  const first = page.getByRole('listitem').filter({ hasText: '#1' });
  await first.getByLabel(/Colour/).fill('White');
  await first.getByLabel(/Size/).fill('M');
  await first.getByLabel('SKU').fill(`LS-W-M-${suffix}`);
  await first.getByLabel(/Barcode/).fill('4006381333931');
  await first.getByLabel(/Selling price/).fill('4,500');
  await page.getByRole('button', { name: 'Add variant' }).click();
  const second = page.getByRole('listitem').filter({ hasText: '#2' });
  await second.getByLabel(/Colour/).fill('White');
  await second.getByLabel(/Size/).fill('L');
  await second.getByLabel('SKU').fill(`LS-W-L-${suffix}`);
  await second.getByLabel(/Selling price/).fill('4750.50');
  await page.getByRole('button', { name: 'Save product' }).click();
  await expect(page.getByText('Product created.')).toBeVisible();
  await expect(page.getByText('LKR 4,750.50')).toBeVisible();

  // Barcode-first: type (or scan) the code and press Enter.
  await page.goto('/products');
  await page.getByLabel('Search products').fill('4006381333931');
  await page.getByLabel('Search products').press('Enter');
  await expect(page.getByRole('heading', { name: 'Linen Shirt' })).toBeVisible();

  // Import: a file with a mistake is rejected entirely, the fixed file applies.
  await page.goto('/products/import');
  const csv = (price: string) =>
    [
      'product_name,category,unit,sku,price,attr:colour,attr:size,reorder_level',
      `Cotton Fabric,Fabric,metre,CF-${suffix},${price},Blue,,12.5`,
      `Linen Shirt,,piece,LS-W-M-${suffix},4600,White,M,`,
    ].join('\n');
  await page.getByLabel('CSV file').setInputFiles({
    name: 'bad.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(csv('12.345')),
  });
  await page.getByRole('button', { name: 'Check file' }).click();
  await expect(
    page.getByRole('cell', { name: 'Too many decimal places for this currency' }),
  ).toBeVisible();

  await page
    .getByLabel('CSV file')
    .setInputFiles({ name: 'good.csv', mimeType: 'text/csv', buffer: Buffer.from(csv('950')) });
  await page.getByRole('button', { name: 'Check file' }).click();
  await expect(
    page.getByText('1 new products, 1 new variants, 1 updated.', { exact: false }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Import 2 rows' }).click();
  await expect(page.getByText('Import complete.')).toBeVisible();

  // The update by SKU changed the shirt's price; the new fabric is searchable.
  await page.goto('/products');
  await page.getByLabel('Search products').fill('cotton');
  await expect(page.getByRole('link', { name: 'Cotton Fabric' })).toBeVisible();
  await page.getByRole('link', { name: 'Cotton Fabric' }).click();
  // The list shows prices too (in two layouts): check the editor once it has opened.
  await page.waitForURL(/\/products\/[0-9a-f-]{36}$/);
  await expect(page.getByText('LKR 950.00')).toBeVisible();

  // Export downloads a CSV containing both products.
  await page.goto('/products');
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export CSV' }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/^products-\d{8}\.csv$/);
  const text = (await (await download.createReadStream()).toArray()).join('');
  expect(text).toContain(`LS-W-M-${suffix}`);
  expect(text).toContain('4600.00');
  expect(text).toContain(`CF-${suffix}`);
});

test('manager adds a product photo that shows in the catalogue', async ({ page }) => {
  await registerTextileShop(page);
  const suffix = Date.now().toString(36).toUpperCase();
  await page.goto('/products/new');
  await page.getByLabel('Product name').fill('Batik Sarong');
  await page.getByLabel('Unit of measure').selectOption('piece');
  const first = page.getByRole('listitem').filter({ hasText: '#1' });
  await first.getByLabel('SKU').fill(`BS-${suffix}`);
  await first.getByLabel(/Selling price/).fill('3,200');
  await page.getByRole('button', { name: 'Save product' }).click();
  await expect(page.getByText('Product created.')).toBeVisible();

  await page
    .locator('input[type="file"]')
    .setInputFiles(resolve(dirname(fileURLToPath(import.meta.url)), 'fixtures/product-photo.jpg'));
  await expect(page.getByText('Photo added.')).toBeVisible();
  const photo = page.getByRole('img', { name: 'Batik Sarong, photo 1' });
  await expect(photo).toBeVisible();
  // Loaded for real: signed link, redirect, private bucket.
  await expect
    .poll(() => photo.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth))
    .toBe(400);
  await expect(page.getByText('Main photo')).toBeVisible();

  await page.goto('/products');
  const row = page.getByRole('link', { name: 'Batik Sarong' }).first();
  await expect(row).toBeVisible();
  const thumbs = page.locator('img[src*="/media/t/"]');
  await expect
    .poll(async () =>
      thumbs.evaluateAll((imgs) =>
        imgs.some(
          (img) => (img as HTMLImageElement).complete && (img as HTMLImageElement).naturalWidth > 0,
        ),
      ),
    )
    .toBe(true);
});
