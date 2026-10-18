import { expect, type Page, test } from '@playwright/test';
import { waitForEmail } from './mailpit';

const PASSWORD = 'blue-mango-river-42';

async function registerAndOnboard(page: Page, email: string) {
  await page.goto('/register');
  await page.getByLabel('Business name').fill('Matara Mart');
  await page.getByLabel('Your full name').fill('Ruwan Jayasena');
  await page.getByLabel('Work email').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await page.getByLabel(/I agree to the Terms/).check();
  await page.getByRole('button', { name: 'Create account' }).click();
  await page.locator('label', { hasText: 'General retail' }).first().click();
  await page.getByRole('button', { name: 'Finish setup' }).click();
  await expect(page.getByRole('heading', { name: 'Hello, Ruwan Jayasena' })).toBeVisible();
}

async function addBranch(page: Page, name: string, code: string) {
  await page.getByRole('button', { name: 'Add branch' }).click();
  const form = page.getByRole('region', { name: 'Add branch' });
  await form.getByLabel('Name').fill(name);
  await form.getByLabel('Code').fill(code);
  await form.getByRole('button', { name: 'Save' }).click();
}

test('owner confirms their e-mail, sees the trial and hits the plan limit', async ({ page }) => {
  const email = `e2e.billing.${Date.now()}.${Math.random().toString(36).slice(2, 8)}@example.com`;
  await registerAndOnboard(page, email);
  await expect(
    page.getByText(`Confirm your email address. We sent a link to ${email}.`),
  ).toBeVisible();

  const body = await waitForEmail(email, 'Confirm your email address');
  const link = /https?:\/\/\S+verify-email\?token=[\w-]+/.exec(body)?.[0];
  expect(link).toBeTruthy();
  await page.goto(link!);
  await expect(page.getByText('Your email address is confirmed.')).toBeVisible();
  await expect(page).toHaveURL(/\/verify-email$/);
  await page.getByRole('link', { name: 'Continue' }).click();
  await expect(page.getByRole('heading', { name: 'Hello, Ruwan Jayasena' })).toBeVisible();
  await expect(page.getByText(/Confirm your email address\./)).toHaveCount(0);

  await page.goto('/settings/billing');
  await expect(page.getByText(/Free trial until .* \(14 days left\)/)).toBeVisible();
  await expect(page.getByText('1 of 3').first()).toBeVisible();
  // This test server has no payment provider configured: say so, never fake a payment.
  await expect(
    page.getByText('Online payment is not set up yet. Please contact support to pay.'),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Pay for Growth' })).toBeDisabled();

  // The Growth trial includes three branches.
  await page.getByRole('link', { name: 'Branches & registers' }).click();
  await addBranch(page, 'Galle', 'GLE');
  await expect(page.getByText('Branch added.')).toBeVisible();
  await addBranch(page, 'Kandy', 'KDY');
  await expect(page.getByRole('region', { name: /Kandy/ })).toBeVisible();
  await addBranch(page, 'Jaffna', 'JAF');
  await expect(
    page.getByText('Your plan does not include more of these. Upgrade in Plan & billing.'),
  ).toBeVisible();
});
