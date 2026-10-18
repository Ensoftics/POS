import { expect, test } from '@playwright/test';

test('add a customer with credit, sell on account, collect a payment and read the statement', async ({
  page,
}) => {
  test.setTimeout(150_000);
  const suffix = `${Date.now()}${Math.random().toString(36).slice(2, 6)}`;
  const sku = `SUGAR-${suffix.slice(-5).toUpperCase()}`;

  await page.goto('/register');
  await page.getByLabel('Business name').fill('Matara Stores');
  await page.getByLabel('Your full name').fill('Chamari Wickramasinghe');
  await page.getByLabel('Work email').fill(`e2e.customers.${suffix}@example.com`);
  await page.getByLabel('Password', { exact: true }).fill('blue-mango-river-42');
  await page.getByLabel(/I agree to the Terms/).check();
  await page.getByRole('button', { name: 'Create account' }).click();
  await page.locator('label', { hasText: 'General retail' }).click();
  await page.getByRole('button', { name: 'Finish setup' }).click();
  await expect(page.getByRole('heading', { name: 'Hello, Chamari Wickramasinghe' })).toBeVisible();

  await page.goto('/products/new');
  await page.getByLabel('Product name').fill('Sugar 1kg');
  await page.getByLabel('SKU').fill(sku);
  await page.getByLabel(/Selling price/).fill('300');
  await page.getByLabel(/Cost price/).fill('250');
  await page.getByRole('button', { name: 'Save product' }).click();
  await expect(page.getByText('Product created.')).toBeVisible();
  await page.goto('/inventory/receive');
  await page.getByLabel('Add an item').fill(sku);
  await page.getByLabel('Add an item').press('Enter');
  await page.getByLabel(new RegExp(`^Quantity .*${sku}`)).fill('20');
  await page.getByRole('button', { name: 'Post receipt' }).click();
  await expect(page.getByText(/Receipt GRN-\d{6} posted\./)).toBeVisible();

  // A regular customer who may owe up to 5,000.00.
  await page.goto('/customers');
  await page.getByRole('button', { name: 'Add customer' }).click();
  await page.getByLabel('Name', { exact: true }).fill('Sunil Fernando');
  await page.getByLabel(/^Phone/).fill('071 555 1234');
  await page.getByLabel(/Credit limit/).fill('5000');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Customer added.')).toBeVisible();

  // Sell four packets on account at the till, finding him by phone.
  await page.goto('/pos');
  await page.getByLabel(/Opening cash in drawer/).fill('1000');
  await page.getByRole('button', { name: 'Open shift' }).click();
  const scan = page.getByLabel('Scan or search items');
  await scan.fill(sku);
  await scan.press('Enter');
  await page.getByLabel('Quantity for Sugar 1kg').fill('4');
  await page.getByLabel('Customer').fill('+94715551234');
  await page.getByRole('button', { name: /Sunil Fernando/ }).click();
  await expect(page.getByTestId('attached-customer')).toContainText('5,000.00');
  await page.getByLabel('Method').selectOption('ACCOUNT');
  await page.getByRole('button', { name: 'Exact' }).click();
  await page.getByRole('button', { name: /Complete sale/ }).click();
  await expect(page.getByText(/Sale INV-000001 completed/)).toBeVisible();
  await expect(page.getByRole('article', { name: 'Receipt' })).toContainText('Sunil Fernando');

  // He pays 500.00 in cash later; it goes into the drawer.
  await page.goto('/customers');
  await page.getByRole('link', { name: 'Sunil Fernando' }).click();
  await expect(page.getByTestId('customer-balance')).toContainText('Owes LKR 1,200.00');
  await page.getByRole('button', { name: 'Record payment' }).click();
  await page.getByLabel(/^Amount/).fill('500');
  await page.getByRole('button', { name: 'Record payment' }).last().click();
  await expect(page.getByRole('status').filter({ hasText: 'PAY-000001' })).toContainText(
    'Balance now LKR 700.00',
  );
  await expect(page.getByTestId('customer-balance')).toContainText('Owes LKR 700.00');
  await expect(page.getByText('INV-000001').first()).toBeVisible();
  await expect(page.getByTestId('closing-balance')).toContainText('700.00');

  // The drawer expects the float plus the collected cash.
  await page.goto('/pos');
  await page.getByRole('button', { name: 'Close shift' }).click();
  await expect(page.getByText('Expected cash').locator('..')).toContainText('1,500.00');
});
