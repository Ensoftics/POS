import { expect, type Page, test } from '@playwright/test';
import { waitForEmail } from './mailpit';

const PASSWORD = 'blue-mango-river-42';
const NEW_PASSWORD = 'violet-harbour-lantern-7';

function uniqueEmail(tag: string) {
  return `e2e.${tag}.${Date.now()}.${Math.random().toString(36).slice(2, 8)}@example.com`;
}

async function register(page: Page, email: string, businessName = 'Nimal Textiles') {
  await page.goto('/register');
  await page.getByLabel('Business name').fill(businessName);
  await page.getByLabel('Your full name').fill('Nimal Perera');
  await page.getByLabel('Work email').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await page.getByLabel(/I agree to the Terms/).check();
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByRole('heading', { name: 'Set up your business' })).toBeVisible();
}

async function signOut(page: Page) {
  const menu = page.getByRole('button', { name: 'Open menu' });
  if (await menu.isVisible()) await menu.click();
  await page.getByRole('button', { name: 'Sign out' }).first().click();
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
}

async function signIn(page: Page, email: string, password: string) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
}

test('owner registers, onboards, keeps the session across reloads, and signs back in', async ({
  page,
}) => {
  const email = uniqueEmail('owner');
  await register(page, email);

  await page.locator('label', { hasText: 'Textiles & clothing' }).click();
  await expect(page.getByRole('radio', { name: /Textiles & clothing/ })).toBeChecked();
  await page.getByLabel(/Contact phone/).fill('+94 77 123 4567');
  await page.getByRole('button', { name: 'Finish setup' }).click();

  await expect(page.getByRole('heading', { name: 'Hello, Nimal Perera' })).toBeVisible();
  await expect(page.getByText('Textiles & clothing')).toBeVisible();

  // The refresh cookie restores the session after a full reload.
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Hello, Nimal Perera' })).toBeVisible();

  await page.goto('/activity');
  await expect(page.getByRole('cell', { name: 'Business account created' })).toBeVisible();
  await expect(page.getByRole('cell', { name: 'Business profile updated' })).toBeVisible();

  await signOut(page);
  await page.goto('/');
  await expect(page).toHaveURL(/\/login$/);

  await signIn(page, email, 'wrong-password-123');
  await expect(page.getByRole('alert')).toHaveText('Email or password is incorrect.');
  await signIn(page, email, PASSWORD);
  await expect(page.getByRole('heading', { name: 'Hello, Nimal Perera' })).toBeVisible();
});

test('owner resets a forgotten password from the emailed link', async ({ page }) => {
  const email = uniqueEmail('reset');
  await register(page, email, 'Lotus Cosmetics');
  await page.locator('label', { hasText: 'Cosmetics & beauty' }).click();
  await page.getByRole('button', { name: 'Finish setup' }).click();
  await expect(page.getByRole('heading', { name: 'Hello, Nimal Perera' })).toBeVisible();
  await signOut(page);

  await page.getByRole('link', { name: 'Forgot password?' }).click();
  await page.getByLabel('Email').fill(email);
  await page.getByRole('button', { name: 'Send reset link' }).click();
  await expect(page.getByRole('heading', { name: 'Check your email' })).toBeVisible();

  const body = await waitForEmail(email, 'Reset your password');
  const link = /https?:\/\/\S+reset-password\?token=[\w-]+/.exec(body)?.[0];
  expect(link).toBeTruthy();
  await page.goto(link!);
  // The token is removed from the address bar once read.
  await expect(page).toHaveURL(/\/reset-password$/);

  await page.getByLabel('New password', { exact: true }).fill(NEW_PASSWORD);
  await page.getByLabel('Confirm new password').fill('something-else-entirely');
  await page.getByRole('button', { name: 'Update password' }).click();
  await expect(page.getByText('Passwords do not match')).toBeVisible();

  await page.getByLabel('Confirm new password').fill(NEW_PASSWORD);
  await page.getByRole('button', { name: 'Update password' }).click();
  await expect(page.getByText('Password updated. Sign in with your new password.')).toBeVisible();

  await signIn(page, email, PASSWORD);
  await expect(page.getByRole('alert')).toHaveText('Email or password is incorrect.');
  await signIn(page, email, NEW_PASSWORD);
  await expect(page.getByRole('heading', { name: 'Hello, Nimal Perera' })).toBeVisible();
  await waitForEmail(email, 'Your password was changed');
});

test('language can be switched to Sinhala and Tamil', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('Language').selectOption('si');
  await expect(page.getByRole('heading', { name: 'පිවිසෙන්න' })).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('lang', 'si');
  await page.getByLabel('භාෂාව').selectOption('ta');
  await expect(page.getByRole('heading', { name: 'உள்நுழைக' })).toBeVisible();
  await page.getByLabel('மொழி').selectOption('en');
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
});
