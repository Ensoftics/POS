import { execSync } from 'node:child_process';
import { resolve } from 'node:path';
import { loadTestEnv } from './env';

/** Applies committed migrations to the test database once per run. */
export default function globalSetup(): void {
  loadTestEnv();
  execSync('pnpm exec prisma migrate deploy', {
    cwd: resolve(__dirname, '..'),
    env: process.env,
    stdio: 'pipe',
  });
}
