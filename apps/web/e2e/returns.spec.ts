import { expect, type Page, test } from '@playwright/test';

async function sellOne(page: Page, sku: string, cash: string) {
  await page.goto('/pos');
  const scan = page.getByLabel('Scan or search items');
  await scan.fill(sku);
  await scan.press('Enter');
  await expect(page.getByLabel(/^Quantity for/)).toHaveValue('1');
  await page.getByLabel(/^Amount/).fill(cash);
  await page.getByRole('button', { name: /Complete sale/ }).click();
  const done = page.getByText(/Sale (INV-\d{6}) completed/);
  await expect(done).toBeVisible();
  const number = /INV-\d{6}/.exec((await done.textContent()) ?? '')![0];
  await page.getByRole('button', { name: 'New sale' }).click();
  return number;
}

test('return part of a sale, void another, pay out cash and reconcile the shift', async ({
  page,
}) => {
  test.setTimeout(150_000);
  const suffix = `${Date.now()}${Math.random().toString(36).slice(2, 6)}`;
  const sku = `MUG-${suffix.slice(-6).toUpperCase()}`;

  await page.goto('/register');
  await page.getByLabel('Business name').fill('Kandy Crafts');
  await page.getByLabel('Your full name').fill('Dilani Herath');
  await page.getByLabel('Work email').fill(`e2e.returns.${suffix}@example.com`);
  await page.getByLabel('Password', { exact: true }).fill('blue-mango-river-42');
  await page.getByLabel(/I agree to the Terms/).check();
  await page.getByRole('button', { name: 'Create account' }).click();
  await page.locator('label', { hasText: 'General retail' }).click();
  await page.getByRole('button', { name: 'Finish setup' }).click();
  await expect(page.getByRole('heading', { name: 'Hello, Dilani Herath' })).toBeVisible();

  // The owner sets an approval PIN (owners approve their own actions at the till).
  await page.goto('/settings/checkout');
  await page.getByLabel('New PIN').fill('2468');
  await page.getByLabel('Your password').fill('blue-mango-river-42');
  await page.getByRole('button', { name: 'Save PIN' }).click();
  await expect(page.getByText('Approval PIN saved.')).toBeVisible();

  await page.goto('/products/new');
  await page.getByLabel('Product name').fill('Clay Mug');
  await page.getByLabel('SKU').fill(sku);
  await page.getByLabel(/Selling price/).fill('1500');
  await page.getByLabel(/Cost price/).fill('600');
  await page.getByRole('button', { name: 'Save product' }).click();
  await expect(page.getByText('Product created.')).toBeVisible();
  await page.goto('/inventory/receive');
  await page.getByLabel('Add an item').fill(sku);
  await page.getByLabel('Add an item').press('Enter');
  await page.getByLabel(new RegExp(`^Quantity .*${sku}`)).fill('5');
  await page.getByRole('button', { name: 'Post receipt' }).click();
  await expect(page.getByText(/Receipt GRN-\d{6} posted\./)).toBeVisible();

  await page.goto('/pos');
  await page.getByLabel(/Opening cash in drawer/).fill('2000');
  await page.getByRole('button', { name: 'Open shift' }).click();
  await expect(page.getByLabel('Scan or search items')).toBeVisible();

  // Two sales of one mug each, paid in cash.
  const first = await sellOne(page, sku, '1500');
  const second = await sellOne(page, sku, '2000');

  // Return the first sale's mug, found by its receipt number.
  await page.goto('/sales');
  await page.getByLabel('Find a receipt to return items').fill(first);
  await page.getByRole('button', { name: 'Find' }).click();
  await page.getByRole('button', { name: 'Return items' }).click();
  await page.getByLabel('Return quantity for Clay Mug').fill('1');
  await expect(page.getByTestId('refund-total')).toContainText('1,500.00');
  await page.getByLabel('Reason').fill('Chipped rim');
  await page.getByRole('button', { name: 'Record return and refund' }).click();
  await expect(page.getByText(/Return RET-000001 recorded\. Refund .*1,500\.00/)).toBeVisible();
  await expect(page.getByText('Returned', { exact: true })).toBeVisible();

  // Void the second sale.
  await page.goto('/sales');
  await page.getByRole('link', { name: second }).click();
  await page.getByRole('button', { name: 'Void sale' }).click();
  await page.getByLabel('Reason').fill('Rang up by mistake');
  await page.getByRole('button', { name: 'Void sale' }).last().click();
  await expect(page.getByText(/Sale voided \(RET-000002\)/)).toBeVisible();

  // Both mugs are back on the shelf.
  await page.goto('/inventory');
  await expect(
    page.getByRole('listitem').filter({ hasText: sku }).getByText('5 Piece'),
  ).toBeVisible();

  // Pay out 300.00 for a courier.
  await page.goto('/pos');
  await page.getByRole('button', { name: 'Cash in / out' }).click();
  await page.getByLabel('Pay out').check();
  await page.getByLabel(/^Amount/).fill('300');
  await page.getByLabel('Reason').fill('Courier');
  await page.getByRole('button', { name: 'Record' }).click();
  await expect(page.getByText('Cash movement recorded.')).toBeVisible();

  // Expected: 2,000 float + 3,500 cash − 500 change − 1,500 refund − 1,500 void − 300 out = 1,700.
  await page.getByRole('button', { name: 'Close shift' }).click();
  await expect(page.getByText('Expected cash').locator('..')).toContainText('1,700.00');
  await page.getByLabel(/Cash counted in drawer/).fill('1700');
  await page.getByRole('button', { name: 'Close shift' }).click();
  await expect(page.getByText(/Shift SHF-000001 closed\./)).toBeVisible();
});
