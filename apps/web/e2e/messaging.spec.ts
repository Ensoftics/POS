import { expect, test } from '@playwright/test';
import { waitForEmail } from './mailpit';

test('record consent, e-mail customers who agreed, and let one stop messages', async ({ page }) => {
  test.setTimeout(150_000);
  const suffix = `${Date.now()}${Math.random().toString(36).slice(2, 6)}`;
  const customerEmail = `e2e.customer.${suffix}@example.com`;

  await page.goto('/register');
  await page.getByLabel('Business name').fill('Kandy Silks');
  await page.getByLabel('Your full name').fill('Ruwan Jayasinghe');
  await page.getByLabel('Work email').fill(`e2e.messaging.${suffix}@example.com`);
  await page.getByLabel('Password', { exact: true }).fill('blue-mango-river-42');
  await page.getByLabel(/I agree to the Terms/).check();
  await page.getByRole('button', { name: 'Create account' }).click();
  await page.locator('label', { hasText: 'Textiles & clothing' }).click();
  await page.getByRole('button', { name: 'Finish setup' }).click();
  await expect(page.getByRole('heading', { name: 'Hello, Ruwan Jayasinghe' })).toBeVisible();

  // A customer agrees at the till; staff note how.
  await page.goto('/customers');
  await page.getByRole('button', { name: 'Add customer' }).click();
  await page.getByLabel('Name', { exact: true }).fill('Nimali Perera');
  await page.getByLabel(/^Email/).fill(customerEmail);
  await page.getByLabel('Agrees to receive offers and news').check();
  await page.getByLabel(/How was this agreed/).fill('Asked at the till');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Customer added.')).toBeVisible();

  // Send an e-mail to everyone who agreed.
  await page.getByRole('link', { name: 'Customer messages' }).click();
  await page.getByLabel(/E-mail · 1 customer/).check();
  await page.getByLabel('Subject').fill(`New sarees ${suffix}`);
  await page
    .getByRole('textbox', { name: 'Message' })
    .fill('Hi {name}, our new silk sarees are in.');
  page.once('dialog', (dialog) => void dialog.accept());
  await page.getByRole('button', { name: 'Send to 1 customer' }).click();
  await expect(page.getByText(/Sending to 1 customer/)).toBeVisible();

  const text = await waitForEmail(customerEmail, `New sarees ${suffix}`, 30_000);
  expect(text).toContain('Hi Nimali, our new silk sarees are in.');
  const link = /Stop these messages: (\S+)/.exec(text)?.[1];
  expect(link).toMatch(/\/u\/\w{12}$/);
  await expect(page.getByText(/1 of 1 sent/)).toBeVisible({ timeout: 30_000 });

  // The customer stops messages from the link, without signing in.
  const customerPage = await page.context().browser()!.newPage();
  await customerPage.goto(new URL(link!).pathname);
  await expect(
    customerPage.getByText('Stop receiving offers and news from Kandy Silks?'),
  ).toBeVisible();
  await customerPage.getByRole('button', { name: 'Stop messages' }).click();
  await expect(customerPage.getByText(/Kandy Silks will not send you any more/)).toBeVisible();
  await customerPage.close();

  // Staff see it in the consent history.
  await page.goto('/customers');
  await page.getByRole('link', { name: 'Nimali Perera' }).click();
  const history = page.getByRole('list', { name: 'Consent history' });
  await expect(history.getByText(/by the customer, using the link in a message/)).toBeVisible();
  await expect(history.getByText('“Asked at the till”')).toBeVisible();
  await expect(page.getByText('Has not agreed to messages')).toBeVisible();
});
