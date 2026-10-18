import { expect, type Page, test } from '@playwright/test';
import { waitForEmail } from './mailpit';

const PASSWORD = 'blue-mango-river-42';
const CASHIER_PASSWORD = 'saffron-kite-harbour-9';

const uniqueEmail = (tag: string) =>
  `e2e.${tag}.${Date.now()}.${Math.random().toString(36).slice(2, 8)}@example.com`;

async function registerAndOnboard(page: Page) {
  await page.goto('/register');
  await page.getByLabel('Business name').fill('Galle Beauty');
  await page.getByLabel('Your full name').fill('Dilani Fernando');
  await page.getByLabel('Work email').fill(uniqueEmail('owner'));
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await page.getByLabel(/I agree to the Terms/).check();
  await page.getByRole('button', { name: 'Create account' }).click();
  await page.locator('label', { hasText: 'Cosmetics' }).first().click();
  await page.getByRole('button', { name: 'Finish setup' }).click();
  await expect(page.getByRole('heading', { name: 'Hello, Dilani Fernando' })).toBeVisible();
}

test('owner invites a cashier for one branch, who joins by email and is then disabled', async ({
  page,
  browser,
}) => {
  await registerAndOnboard(page);

  // A second branch, so the invitation can be limited to it.
  await page.goto('/settings/locations');
  await page.getByRole('button', { name: 'Add branch' }).click();
  const form = page.getByRole('region', { name: 'Add branch' });
  await form.getByLabel('Name').fill('Galle Fort');
  await form.getByLabel('Code').fill('galle');
  await form.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Branch added.')).toBeVisible();

  await page.getByRole('link', { name: 'Staff' }).click();
  await page.getByRole('button', { name: 'Invite staff' }).click();
  const email = uniqueEmail('cashier');
  await page.getByLabel('Email address').fill(email);
  await page.getByLabel('Role').selectOption('CASHIER');
  await page.getByRole('group', { name: 'Branches' }).getByLabel('Galle Fort').check();
  await page.getByRole('button', { name: 'Send invitation' }).click();
  await expect(page.getByText(`Invitation sent to ${email}.`, { exact: false })).toBeVisible();
  await expect(page.getByText(email, { exact: true })).toBeVisible();

  const body = await waitForEmail(email, "You're invited to join Galle Beauty");
  const link = /https?:\/\/\S+accept-invite\?token=[\w-]+/.exec(body)?.[0];
  expect(link).toBeTruthy();

  // The cashier opens the link in their own browser.
  const cashierContext = await browser.newContext();
  const cashier = await cashierContext.newPage();
  await cashier.goto(link!);
  await expect(cashier).toHaveURL(/\/accept-invite$/);
  await expect(cashier.getByRole('heading', { name: 'Join Galle Beauty' })).toBeVisible();
  await expect(cashier.getByText('You were invited as Cashier.')).toBeVisible();
  await cashier.getByLabel('Your full name').fill('Kamal Perera');
  await cashier.getByLabel('Choose a password').fill(CASHIER_PASSWORD);
  await cashier.getByRole('button', { name: 'Join business' }).click();
  await expect(cashier.getByRole('heading', { name: 'Hello, Kamal Perera' })).toBeVisible();

  // Only their branch is visible to them.
  await cashier.goto('/settings/locations');
  await expect(cashier.getByRole('region', { name: /Galle Fort/ })).toBeVisible();
  await expect(cashier.getByRole('region', { name: /Main branch/ })).toHaveCount(0);
  // And they cannot manage staff.
  await expect(cashier.getByRole('link', { name: 'Staff' })).toHaveCount(0);

  // The owner sees them in the team and disables them.
  await page.reload();
  await expect(page.getByText('Kamal Perera')).toBeVisible();
  await expect(page.getByText('No pending invitations.')).toBeVisible();
  page.once('dialog', (dialog) => void dialog.accept());
  await page.getByRole('button', { name: 'Disable: Kamal Perera' }).click();
  await expect(page.getByText('Access updated. Kamal Perera must sign in again.')).toBeVisible();

  // The cashier's session ends at once.
  await cashier.goto('/');
  await expect(cashier.getByRole('heading', { name: 'Sign in' })).toBeVisible();
  await cashierContext.close();
});
