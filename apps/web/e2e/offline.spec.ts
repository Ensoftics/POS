import { expect, test } from '@playwright/test';

test('sell without a connection, sync when it returns, and review the price difference', async ({
  page,
  context,
}) => {
  test.setTimeout(150_000);
  const suffix = `${Date.now()}${Math.random().toString(36).slice(2, 6)}`;
  const sku = `CANDLE-${suffix.slice(-5).toUpperCase()}`;

  await page.goto('/register');
  await page.getByLabel('Business name').fill('Galle Gifts');
  await page.getByLabel('Your full name').fill('Ruwan Jayasuriya');
  await page.getByLabel('Work email').fill(`e2e.offline.${suffix}@example.com`);
  await page.getByLabel('Password', { exact: true }).fill('blue-mango-river-42');
  await page.getByLabel(/I agree to the Terms/).check();
  await page.getByRole('button', { name: 'Create account' }).click();
  await page.locator('label', { hasText: 'General retail' }).click();
  await page.getByRole('button', { name: 'Finish setup' }).click();
  await expect(page.getByRole('heading', { name: 'Hello, Ruwan Jayasuriya' })).toBeVisible();

  await page.goto('/products/new');
  await page.getByLabel('Product name').fill('Soy Candle');
  await page.getByLabel('SKU').fill(sku);
  await page.getByLabel(/Selling price/).fill('800');
  await page.getByLabel(/Cost price/).fill('300');
  await page.getByRole('button', { name: 'Save product' }).click();
  await expect(page.getByText('Product created.')).toBeVisible();
  const productUrl = page.url();
  await page.goto('/inventory/receive');
  await page.getByLabel('Add an item').fill(sku);
  await page.getByLabel('Add an item').press('Enter');
  await page.getByLabel(new RegExp(`^Quantity .*${sku}`)).fill('3');
  await page.getByRole('button', { name: 'Post receipt' }).click();
  await expect(page.getByText(/Receipt GRN-\d{6} posted\./)).toBeVisible();

  // Open the till: it copies the catalogue to this browser.
  await page.goto('/pos');
  await page.getByLabel(/Opening cash in drawer/).fill('1000');
  await page.getByRole('button', { name: 'Open shift' }).click();
  await expect(page.getByLabel('Scan or search items')).toBeVisible();

  // Meanwhile the price goes up in the back office (another tab); the till's copy still says 800.
  const office = await context.newPage();
  await office.goto(productUrl);
  await office.getByRole('button', { name: `Edit ${sku}` }).click();
  await office.getByLabel(/Selling price/).fill('850');
  await office.getByRole('button', { name: 'Save variant' }).click();
  await expect(office.getByText('Saved.')).toBeVisible();
  await office.close();

  // The connection drops.
  await context.setOffline(true);
  const scan = page.getByLabel('Scan or search items');
  await scan.fill(sku);
  await scan.press('Enter');
  await expect(page.getByLabel('Quantity for Soy Candle')).toHaveValue('1');
  await expect(page.getByTestId('cart-total')).toContainText('800.00');
  await page.getByLabel(/^Amount/).fill('1000');
  await page.getByRole('button', { name: /Complete sale/ }).click();
  await expect(page.getByText('Sale saved on this device')).toBeVisible();
  await expect(page.getByText('Pending (offline)')).toBeVisible();
  await expect(page.getByTestId('sale-change')).toContainText('200.00');
  await page.getByRole('button', { name: 'New sale' }).click();
  await expect(page.getByText(/1 sale\(s\) saved on this device/)).toBeVisible();

  // Back online: the queued sale is sent and recorded at the price the customer paid.
  await context.setOffline(false);
  await page.getByRole('button', { name: 'Send now' }).click();
  await expect(page.getByText(/saved on this device will be sent/)).toHaveCount(0);

  await page.goto('/sales');
  await page.getByRole('link', { name: 'INV-000001' }).click();
  await expect(page.getByRole('article', { name: 'Receipt' })).toContainText('800.00');

  await page.goto('/sales/review');
  await expect(page.getByText('Price changed')).toBeVisible();
  await expect(
    page.getByText(new RegExp(`${sku}: charged .*800\\.00, current .*850\\.00`)),
  ).toBeVisible();
  await page.getByLabel('What was done').fill('Old shelf price honoured.');
  await page.getByRole('button', { name: 'Mark resolved' }).click();
  await expect(page.getByText('Nothing to review.')).toBeVisible();
});
