import { expect, type Page, test } from '@playwright/test';

const PASSWORD = 'blue-mango-river-42';

async function registerAndOnboard(page: Page) {
  const email = `e2e.settings.${Date.now()}.${Math.random().toString(36).slice(2, 8)}@example.com`;
  await page.goto('/register');
  await page.getByLabel('Business name').fill('Kandy Fabrics');
  await page.getByLabel('Your full name').fill('Saman Jayasuriya');
  await page.getByLabel('Work email').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await page.getByLabel(/I agree to the Terms/).check();
  await page.getByRole('button', { name: 'Create account' }).click();
  await page.locator('label', { hasText: 'Textiles & clothing' }).click();
  await page.getByRole('button', { name: 'Finish setup' }).click();
  await expect(page.getByRole('heading', { name: 'Hello, Saman Jayasuriya' })).toBeVisible();
}

test('owner configures currency, product options, branches and registers', async ({ page }) => {
  await registerAndOnboard(page);
  // Defaults from onboarding are visible on the dashboard.
  await expect(page.getByText('LKR', { exact: true })).toBeVisible();

  await page.goto('/settings/localization');
  await page.getByLabel('Currency').selectOption('USD');
  await page.getByLabel('Time zone').selectOption('Asia/Dubai');
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByText('Changes saved.')).toBeVisible();

  // The textile preset was applied at onboarding.
  await page.getByRole('link', { name: 'Product options' }).click();
  await expect(page.getByLabel('Allow part quantities')).toBeChecked();
  await expect(
    page.getByRole('group', { name: 'Units of measure' }).getByLabel('Metre'),
  ).toBeChecked();

  await page.getByRole('link', { name: 'Branches & registers' }).click();
  const main = page.getByRole('region', { name: /Main branch/ });
  await expect(main.getByText('Register 1')).toBeVisible();

  await page.getByRole('button', { name: 'Add branch' }).click();
  const form = page.getByRole('region', { name: 'Add branch' });
  await form.getByLabel('Name').fill('Galle Fort');
  await form.getByLabel('Code').fill('galle');
  await form.getByLabel(/City/).fill('Galle');
  await form.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Branch added.')).toBeVisible();

  const galle = page.getByRole('region', { name: /Galle Fort/ });
  await expect(galle.getByText('GALLE', { exact: true })).toBeVisible();
  await galle.getByRole('button', { name: 'Add register' }).click();
  await galle.getByLabel('Name').fill('Front counter');
  await galle.getByLabel('Code').fill('fc1');
  await galle.getByRole('button', { name: 'Save' }).click();
  await expect(galle.getByText('Front counter')).toBeVisible();

  // Archiving the original branch takes its registers with it.
  page.once('dialog', (dialog) => void dialog.accept());
  await main.getByRole('button', { name: 'Archive', exact: true }).click();
  await expect(page.getByRole('region', { name: /Main branch/ })).toHaveCount(0);
  await page.getByLabel('Show archived').check();
  await expect(
    page
      .getByRole('region', { name: /Main branch/ })
      .getByText('Archived')
      .first(),
  ).toBeVisible();

  // Dashboard reflects the new currency.
  await page.goto('/');
  await expect(page.getByText('USD', { exact: true })).toBeVisible();

  // Every change is in the activity log.
  await page.goto('/activity');
  for (const event of [
    'Business settings changed',
    'Branch added',
    'Register added',
    'Branch archived',
  ]) {
    await expect(page.getByRole('cell', { name: event })).toBeVisible();
  }
});
