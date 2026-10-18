import { expect, test } from '@playwright/test';

test('set up VAT, sell with a discount and split payment, print and close the shift', async ({
  page,
}) => {
  // A long journey across several pages; the default 30 s is too tight on slow machines.
  test.setTimeout(120_000);
  const suffix = `${Date.now()}${Math.random().toString(36).slice(2, 6)}`;
  const sku = `TEA-${suffix.slice(-6).toUpperCase()}`;

  await page.goto('/register');
  await page.getByLabel('Business name').fill('Lanka Grocers');
  await page.getByLabel('Your full name').fill('Saman Kumara');
  await page.getByLabel('Work email').fill(`e2e.checkout.${suffix}@example.com`);
  await page.getByLabel('Password', { exact: true }).fill('blue-mango-river-42');
  await page.getByLabel(/I agree to the Terms/).check();
  await page.getByRole('button', { name: 'Create account' }).click();
  await page.locator('label', { hasText: 'General retail' }).click();
  await page.getByRole('button', { name: 'Finish setup' }).click();
  await expect(page.getByRole('heading', { name: 'Hello, Saman Kumara' })).toBeVisible();

  // VAT 18 % as the default rate; shelf prices include tax (the default).
  await page.goto('/settings/checkout');
  await page.getByRole('button', { name: 'Add tax rate' }).click();
  await page.getByLabel('Name', { exact: true }).fill('VAT');
  await page.getByLabel('Rate (%)').fill('18');
  await page.getByLabel('Default for products').check();
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText('Tax rate added.')).toBeVisible();
  await page.getByLabel('Receipt footer').fill('Thank you for shopping with us');
  await page
    .getByRole('region', { name: 'At the till' })
    .getByRole('button', { name: 'Save changes' })
    .click();
  await expect(page.getByText('Changes saved.')).toBeVisible();

  // One product with 5 in stock.
  await page.goto('/products/new');
  await page.getByLabel('Product name').fill('Ceylon Tea 400g');
  await page.getByLabel('SKU').fill(sku);
  await page.getByLabel(/Selling price/).fill('1180');
  await page.getByLabel(/Cost price/).fill('800');
  await page.getByRole('button', { name: 'Save product' }).click();
  await expect(page.getByText('Product created.')).toBeVisible();

  await page.goto('/inventory/receive');
  await page.getByLabel('Add an item').fill(sku);
  await page.getByLabel('Add an item').press('Enter');
  await page.getByLabel(new RegExp(`^Quantity .*${sku}`)).fill('5');
  await page.getByRole('button', { name: 'Post receipt' }).click();
  await expect(page.getByText(/Receipt GRN-\d{6} posted\./)).toBeVisible();

  // Open a shift with a 5,000.00 float.
  await page.goto('/pos');
  await page.getByLabel(/Opening cash in drawer/).fill('5000');
  await page.getByRole('button', { name: 'Open shift' }).click();

  // Scan the item three times: 3 × 1,180.00 = 3,540.00, then 40.00 off the sale.
  const scan = page.getByLabel('Scan or search items');
  for (let i = 0; i < 3; i += 1) {
    await scan.fill(sku);
    await scan.press('Enter');
  }
  await expect(page.getByLabel('Quantity for Ceylon Tea 400g')).toHaveValue('3');
  await page.getByRole('combobox', { name: 'Sale discount: Discount' }).selectOption('AMOUNT');
  await page.getByRole('textbox', { name: 'Sale discount' }).fill('40');
  await expect(page.getByTestId('cart-total')).toContainText('3,500.00');

  // 2,000.00 by card, the rest in cash with change from 2,000.00.
  await page.getByLabel(/^Amount/).fill('2000');
  await page.getByRole('combobox', { name: 'Method' }).first().selectOption('CARD');
  await page.getByRole('button', { name: 'Add payment' }).click();
  await page.getByRole('combobox', { name: 'Method' }).nth(1).selectOption('CASH');
  await page
    .getByLabel(/^Amount/)
    .nth(1)
    .fill('2000');
  await expect(page.getByTestId('change-due')).toContainText('500.00');
  await page.getByRole('button', { name: /Complete sale/ }).click();

  await expect(page.getByText(/Sale INV-000001 completed/)).toBeVisible();
  await expect(page.getByTestId('sale-change')).toContainText('500.00');
  const receipt = page.getByRole('article', { name: 'Receipt' });
  await expect(receipt.getByText('Thank you for shopping with us')).toBeVisible();
  await expect(receipt.getByText(/Includes VAT 18%/)).toBeVisible();

  // Stock went down by three.
  await page.goto('/inventory');
  await expect(
    page.getByRole('listitem').filter({ hasText: sku }).getByText('2 Piece'),
  ).toBeVisible();

  // The sale is listed and its receipt can be reopened.
  await page.goto('/sales');
  await page.getByRole('link', { name: 'INV-000001' }).click();
  await expect(page.getByRole('article', { name: 'Receipt' })).toContainText('3,500.00');

  // Close the shift: expected 5,000 + 2,000 − 500 = 6,500.00 in the drawer.
  await page.goto('/pos');
  await page.getByRole('button', { name: 'Close shift' }).click();
  await expect(page.getByText('Expected cash').locator('..')).toContainText('6,500.00');
  await page.getByLabel(/Cash counted in drawer/).fill('6500');
  await page.getByRole('button', { name: 'Close shift' }).click();
  await expect(page.getByText(/Shift SHF-000001 closed\./)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Open shift' })).toBeVisible();
});
