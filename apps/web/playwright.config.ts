import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end tests run the real stack: built API (against the pos_test database
 * and Mailpit for email) plus the Vite dev server. Ports differ from `pnpm dev`
 * so both can run side by side. Requires `pnpm db:up` and `pnpm build`.
 */
const API_PORT = 4100;
const WEB_PORT = 5190;
export const WEB_URL = `http://localhost:${WEB_PORT}`;

export default defineConfig({
  testDir: './e2e',
  // Each spec is a whole user journey across many pages; 30 s is too tight on a busy machine.
  timeout: 90_000,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: WEB_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'desktop-chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile-chromium', use: { ...devices['Pixel 7'] } },
  ],
  webServer: [
    {
      command: 'pnpm --filter @pos/api exec dotenv -e .env.test -- node dist/main.js',
      url: `http://127.0.0.1:${API_PORT}/health/ready`,
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
      env: {
        PORT: String(API_PORT),
        CORS_ORIGINS: WEB_URL,
        WEB_APP_URL: WEB_URL,
        // Signed image links point here.
        API_PUBLIC_URL: `http://127.0.0.1:${API_PORT}`,
        LOG_FORMAT: 'silent',
        // Customer messages go out promptly so journeys can read them in Mailpit.
        MESSAGING_SWEEP_SECONDS: '2',
        RATE_LIMIT_AUTH_PER_MINUTE: '1000',
      },
    },
    {
      command: `pnpm exec vite --port ${WEB_PORT}`,
      url: WEB_URL,
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
      env: { VITE_API_PROXY_TARGET: `http://127.0.0.1:${API_PORT}` },
    },
  ],
});
