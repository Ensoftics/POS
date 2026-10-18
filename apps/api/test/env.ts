import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Loads apps/api/.env.test without overriding variables already set (CI sets its own).
 * Kept dependency-free on purpose.
 */
export function loadTestEnv(): void {
  const file = resolve(__dirname, '../.env.test');
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (!match) continue;
    const [, key, raw] = match as unknown as [string, string, string];
    const value = raw.replace(/^"(.*)"$/, '$1');
    process.env[key] ??= value;
  }
}

loadTestEnv();
