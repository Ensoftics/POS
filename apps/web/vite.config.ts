import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

// The dev server proxies /api to the NestJS API so the app, API and refresh cookie
// share one origin, matching the production reverse-proxy layout.
const apiTarget = process.env.VITE_API_PROXY_TARGET ?? 'http://127.0.0.1:4000';
const proxy = { '/api': { target: apiTarget, changeOrigin: false } };

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: { port: 5180, strictPort: true, proxy },
  preview: { port: 5180, strictPort: true, proxy },
  build: { sourcemap: true },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    css: false,
    // Full user journeys (typing, dialogs) take a few seconds on a loaded CI machine.
    testTimeout: 15_000,
  },
});
