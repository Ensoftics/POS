import { spawnSync } from 'node:child_process';
import { createHmac } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, type Page, test } from '@playwright/test';

const PASSWORD = 'blue-mango-river-42';
const API_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../../api');

function base32Decode(text: string): Buffer {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const char of text) {
    value = (value << 5) | alphabet.indexOf(char);
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

/** The code an authenticator app would show now (RFC 6238). */
function totp(secret: string): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30_000)));
  const digest = createHmac('sha1', base32Decode(secret)).update(counter).digest();
  const offset = digest[digest.length - 1]! & 15;
  const value = digest.readUInt32BE(offset) & 0x7fffffff;
  return String(value % 1_000_000).padStart(6, '0');
}

/** Runs the operator's CLI against the E2E database, as on a server; returns everything it printed. */
function platformAdminCli(...args: string[]): { status: number | null; output: string } {
  const result = spawnSync(
    'pnpm',
    ['exec', 'dotenv', '-e', '.env.test', '--', 'node', 'dist/scripts/platform-admin.js', ...args],
    { cwd: API_DIR, encoding: 'utf8', shell: process.platform === 'win32' },
  );
  return { status: result.status, output: `${result.stdout}${result.stderr}` };
}

async function register(page: Page, email: string, business: string, owner: string) {
  await page.goto('/register');
  await page.getByLabel('Business name').fill(business);
  await page.getByLabel('Your full name').fill(owner);
  await page.getByLabel('Work email').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await page.getByLabel(/I agree to the Terms/).check();
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByRole('heading', { name: 'Set up your business' })).toBeVisible();
}

test('operator grants console access from the server and suspends a business', async ({
  browser,
  page,
}) => {
  const stamp = `${Date.now()}.${Math.random().toString(36).slice(2, 8)}`;
  const opsEmail = `e2e.ops.${stamp}@example.com`;
  const shopEmail = `e2e.shop.${stamp}@example.com`;
  const shopName = `Negombo Spices ${stamp.slice(-6)}`;

  // A shop that will be suspended, signed in in its own browser.
  const shopContext = await browser.newContext();
  const shop = await shopContext.newPage();
  await register(shop, shopEmail, shopName, 'Chaminda Silva');

  // The operator has an ordinary account; console access is granted only from the server.
  const opsContext = await browser.newContext();
  await register(await opsContext.newPage(), opsEmail, 'Ensoftic Ops', 'Nadeesha Ops');
  expect(platformAdminCli('grant', `nobody.${stamp}@example.com`).output).toContain(
    'No account with e-mail',
  );
  const granted = platformAdminCli('grant', opsEmail);
  expect(granted.status).toBe(0);
  expect(granted.output).toContain('otpauth://totp/');
  const secret = /Key: ([A-Z2-7]+)/.exec(granted.output)?.[1];
  expect(secret).toBeTruthy();

  await page.goto('/platform');
  await expect(page.getByRole('heading', { name: 'Platform console' })).toBeVisible();
  await page.getByLabel('Email').fill(opsEmail);
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await page.getByLabel('Authenticator code').fill('000000');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('alert')).toHaveText(
    'Email, password or authenticator code is incorrect.',
  );
  await page.getByLabel('Authenticator code').fill(totp(secret!));
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: 'Overview' })).toBeVisible();

  await page.getByRole('link', { name: 'Businesses' }).click();
  await page.getByLabel('Search name, slug or owner email').fill(shopEmail);
  await page.getByRole('link', { name: shopName }).click();
  await expect(page.getByRole('heading', { name: shopName })).toBeVisible();
  const suspend = page.getByRole('form', { name: 'Suspend business' });
  await suspend.getByLabel('Reason').fill('E2E fraud review');
  await suspend.getByRole('button', { name: 'Suspend business' }).click();
  await expect(page.getByRole('form', { name: 'Reinstate business' })).toBeVisible();

  // The shop is signed out at once and cannot sign back in.
  await shop.goto('/');
  await expect(shop.getByRole('heading', { name: 'Sign in' })).toBeVisible();
  await shop.getByLabel('Email').fill(shopEmail);
  await shop.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await shop.getByRole('button', { name: 'Sign in' }).click();
  await expect(shop.getByRole('alert')).toContainText('suspended');

  await page.getByRole('link', { name: 'Audit log' }).click();
  // Viewing the business is logged too; find the suspension itself.
  const row = page
    .getByRole('row')
    .filter({ hasText: shopName })
    .filter({ hasText: 'platform.tenant_suspended' });
  await expect(row).toHaveCount(1);
  await expect(row).toContainText(opsEmail);
  await expect(row).toContainText('E2E fraud review');

  // Revoking access from the server ends the console session.
  expect(platformAdminCli('revoke', opsEmail).status).toBe(0);
  // The next request to the server (a new search) finds the session gone.
  await page.getByRole('link', { name: 'Businesses' }).click();
  await page.getByLabel('Search name, slug or owner email').fill(`after-revoke-${stamp}`);
  await expect(page.getByText('Your console session ended. Sign in again.')).toBeVisible();

  await shopContext.close();
  await opsContext.close();
});
