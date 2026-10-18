import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';

test('dashboard, sales and profit reports, CSV export and a Z report', async ({ page }) => {
  test.setTimeout(150_000);
  const suffix = `${Date.now()}${Math.random().toString(36).slice(2, 6)}`;
  const sku = `MUG-${suffix.slice(-5).toUpperCase()}`;

  await page.goto('/register');
  await page.getByLabel('Business name').fill('Hill Country Crafts');
  await page.getByLabel('Your full name').fill('Asha Bandara');
  await page.getByLabel('Work email').fill(`e2e.reports.${suffix}@example.com`);
  await page.getByLabel('Password', { exact: true }).fill('blue-mango-river-42');
  await page.getByLabel(/I agree to the Terms/).check();
  await page.getByRole('button', { name: 'Create account' }).click();
  await page.locator('label', { hasText: 'General retail' }).click();
  await page.getByRole('button', { name: 'Finish setup' }).click();
  await expect(page.getByRole('heading', { name: 'Hello, Asha Bandara' })).toBeVisible();

  // One mug at 1,000.00; received 10 at 400.00 and 10 at 600.00 (average 500.00).
  await page.goto('/products/new');
  await page.getByLabel('Product name').fill('Clay Mug');
  await page.getByLabel('SKU').fill(sku);
  await page.getByLabel(/Selling price/).fill('1000');
  await page.getByLabel(/Cost price/).fill('400');
  await page.getByRole('button', { name: 'Save product' }).click();
  await expect(page.getByText('Product created.')).toBeVisible();
  for (const cost of ['400', '600']) {
    await page.goto('/inventory/receive');
    await page.getByLabel('Add an item').fill(sku);
    await page.getByLabel('Add an item').press('Enter');
    await page.getByLabel(new RegExp(`^Quantity .*${sku}`)).fill('10');
    await page.getByLabel(new RegExp(`^Unit cost .*${sku}`)).fill(cost);
    await page.getByRole('button', { name: 'Post receipt' }).click();
    await expect(page.getByText(/Receipt GRN-\d{6} posted\./)).toBeVisible();
  }

  // Sell three mugs for cash.
  await page.goto('/pos');
  await page.getByLabel(/Opening cash in drawer/).fill('500');
  await page.getByRole('button', { name: 'Open shift' }).click();
  await page.getByLabel('Scan or search items').fill(sku);
  await page.getByLabel('Scan or search items').press('Enter');
  await page.getByLabel('Quantity for Clay Mug').fill('3');
  await page.getByRole('button', { name: 'Exact' }).click();
  await page.getByRole('button', { name: /Complete sale/ }).click();
  await expect(page.getByText(/Sale INV-000001 completed/)).toBeVisible();

  // Dashboard: today's tile and the item list.
  await page.goto('/');
  await expect(page.getByText('Sales today').locator('..')).toContainText('3,000.00');
  await expect(page.getByRole('region', { name: 'Top items today' })).toContainText('Clay Mug');

  // Sales report by item, exported as CSV.
  await page.goto('/reports');
  await page.getByLabel('Group by').selectOption('product');
  const sales = page.getByRole('table', { name: 'Sales' });
  await expect(sales).toContainText('Clay Mug');
  await expect(sales.locator('tfoot')).toContainText('3,000.00');
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Download CSV' }).click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/^sales-product-.*\.csv$/);
  const csv = await readFile((await download.path())!, 'utf8');
  expect(csv).toContain('Clay Mug,1,3,0.00,0.00,3000.00,0.00,3000.00');

  // Profit: 3 × 1,000.00 revenue against 3 × 500.00 average cost.
  await page.getByRole('button', { name: 'Profit' }).click();
  await page.getByLabel('Group by').selectOption('product');
  const profit = page.getByRole('table', { name: 'Profit' });
  await expect(profit).toContainText('1,500.00');
  await expect(profit).toContainText('50%');

  // Stock value: 17 left at 500.00.
  await page.getByRole('button', { name: 'Stock value' }).click();
  await expect(page.getByRole('table', { name: 'Stock value' }).locator('tfoot')).toContainText(
    '8,500.00',
  );

  // Close the shift and open its Z report.
  await page.goto('/pos');
  await page.getByRole('button', { name: 'Close shift' }).click();
  await page.getByLabel(/Cash counted in drawer/).fill('3500');
  await page.getByRole('button', { name: 'Close shift' }).click();
  await expect(page.getByText(/Shift SHF-000001 closed\./)).toBeVisible();
  await page.goto('/reports?tab=shifts');
  await page.getByRole('link', { name: 'SHF-000001' }).click();
  const z = page.getByRole('article', { name: 'Shift report (Z)' });
  await expect(z).toContainText('Hill Country Crafts');
  await expect(page.getByTestId('z-difference')).toContainText('0.00');
});
