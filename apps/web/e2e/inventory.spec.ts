import { expect, type Page, test } from '@playwright/test';

async function cosmeticsShop(page: Page, suffix: string) {
  await page.goto('/register');
  await page.getByLabel('Business name').fill('Glow Cosmetics');
  await page.getByLabel('Your full name').fill('Ruwani Dias');
  await page.getByLabel('Work email').fill(`e2e.inventory.${suffix}@example.com`);
  await page.getByLabel('Password', { exact: true }).fill('blue-mango-river-42');
  await page.getByLabel(/I agree to the Terms/).check();
  await page.getByRole('button', { name: 'Create account' }).click();
  await page.locator('label', { hasText: 'Cosmetics & beauty' }).click();
  await page.getByRole('button', { name: 'Finish setup' }).click();
  await expect(page.getByRole('heading', { name: 'Hello, Ruwani Dias' })).toBeVisible();
}

test('buy, receive with batches, write off, transfer and count stock', async ({ page }) => {
  const suffix = `${Date.now()}${Math.random().toString(36).slice(2, 6)}`;
  const sku = `SER-${suffix.slice(-6).toUpperCase()}`;
  await cosmeticsShop(page, suffix);

  // Catalogue: one serum.
  await page.goto('/products/new');
  await page.getByLabel('Product name').fill('Vitamin C Serum');
  await page.getByLabel('SKU').fill(sku);
  await page.getByLabel(/Selling price/).fill('3450');
  await page.getByLabel(/Cost price/).fill('1800');
  await page.getByRole('button', { name: 'Save product' }).click();
  await expect(page.getByText('Product created.')).toBeVisible();

  // Second branch for the transfer.
  await page.goto('/settings/locations');
  await page.getByRole('button', { name: 'Add branch' }).click();
  const branchForm = page.getByRole('region', { name: 'Add branch' });
  await branchForm.getByLabel('Name').fill('Kandy');
  await branchForm.getByLabel('Code').fill('KANDY');
  await branchForm.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Branch added.')).toBeVisible();

  // Supplier and purchase order.
  await page.goto('/purchasing/suppliers');
  await page.getByRole('button', { name: 'Add supplier' }).click();
  await page.getByLabel('Supplier name').fill('Beauty Imports');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Supplier added.')).toBeVisible();

  await page.goto('/purchasing/orders/new');
  await page.getByLabel('Deliver to').selectOption({ label: 'Main branch' });
  await page.getByLabel('Add an item').fill(sku);
  await page.getByLabel('Add an item').press('Enter');
  await page.getByLabel(new RegExp(`^Quantity .*${sku}`)).fill('10');
  await page.getByRole('button', { name: 'Save draft' }).click();
  await expect(page.getByText(/Purchase order PO-\d{6} created\./)).toBeVisible();
  await page.getByRole('button', { name: 'Mark as sent to supplier' }).click();
  await expect(page.getByText('Ordered', { exact: true })).toBeVisible();

  // Receive 6 of 10 against the order, with batch and expiry (required for cosmetics).
  await page.getByRole('link', { name: 'Receive against this order' }).click();
  await expect(page.getByLabel(new RegExp(`^Quantity .*${sku}`))).toHaveValue('10');
  await page.getByLabel(new RegExp(`^Quantity .*${sku}`)).fill('6');
  await page.getByRole('button', { name: 'Post receipt' }).click();
  await expect(page.getByText('Enter the batch / lot number')).toBeVisible();
  await page.getByLabel(new RegExp(`^Batch / lot: .*${sku}`)).fill('LOT-A1');
  await page.getByLabel(new RegExp(`^Expiry date: .*${sku}`)).fill('2027-03-31');
  await page.getByRole('button', { name: 'Post receipt' }).click();
  await expect(page.getByText(/Receipt GRN-\d{6} posted\. Stock updated\./)).toBeVisible();

  await page.goto('/purchasing/orders');
  await expect(page.getByText('Partly received')).toBeVisible();

  // Write off one damaged unit.
  await page.goto('/inventory/adjust');
  await page.getByLabel('Branch').selectOption({ label: 'Main branch' });
  await page.getByLabel('Add an item').fill(sku);
  await page.getByLabel('Add an item').press('Enter');
  await page.getByRole('button', { name: 'Post adjustment' }).click();
  await expect(page.getByText(/Adjustment ADJ-\d{6} posted\./)).toBeVisible();

  // Transfer two units to Kandy and receive them there.
  await page.goto('/inventory/transfers');
  await page.getByRole('button', { name: 'New transfer' }).click();
  await page.getByLabel('From branch').selectOption({ label: 'Main branch' });
  await page.getByLabel('To branch').selectOption({ label: 'Kandy' });
  await page.getByLabel('Add an item').fill(sku);
  await page.getByLabel('Add an item').press('Enter');
  await page.getByLabel(new RegExp(`^Quantity .*${sku}`)).fill('2');
  await page.getByRole('button', { name: 'Send transfer' }).click();
  await expect(page.getByText(/Transfer TRF-\d{6} sent\./)).toBeVisible();
  await page.getByRole('button', { name: 'Receive', exact: true }).click();
  await expect(page.getByText(/TRF-\d{6}: Received/)).toBeVisible();

  // Main branch: 6 received - 1 damaged - 2 transferred = 3, in batch LOT-A1.
  await page.goto('/inventory');
  await page.getByLabel('Branch').selectOption({ label: 'Main branch' });
  const row = page.getByRole('listitem').filter({ hasText: sku });
  await expect(row.getByText('3 Piece')).toBeVisible();
  await row.getByRole('button', { name: 'History' }).click();
  await expect(row.getByText('LOT-A1').first()).toBeVisible();
  await expect(row.getByText('Transferred out')).toBeVisible();

  // Count finds 2 on the shelf: completing posts a -1 correction.
  await page.goto('/inventory/counts');
  await page.getByLabel('Branch').selectOption({ label: 'Main branch' });
  await page.getByRole('button', { name: 'Start count' }).click();
  await page.getByLabel(new RegExp(`^Counted: .*${sku}`)).fill('2');
  page.once('dialog', (dialog) => void dialog.accept());
  await page.getByRole('button', { name: 'Complete count' }).click();
  await expect(page.getByText('Count completed. 1 corrections posted.')).toBeVisible();

  await page.goto('/inventory');
  await page.getByLabel('Branch').selectOption({ label: 'Main branch' });
  await expect(
    page.getByRole('listitem').filter({ hasText: sku }).getByText('2 Piece'),
  ).toBeVisible();
});
