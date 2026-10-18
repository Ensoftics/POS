import { ERROR_CODES } from '@pos/contracts';
import { describe, expect, it } from 'vitest';
import { en, resources } from './index';

function leafKeys(value: unknown, prefix = ''): string[] {
  if (typeof value === 'string') return [prefix];
  return Object.entries(value as Record<string, unknown>).flatMap(([key, child]) =>
    leafKeys(child, prefix ? `${prefix}.${key}` : key),
  );
}

describe('translations', () => {
  const english = new Set(leafKeys(en));

  it('has an English message for every API error code', () => {
    for (const code of ERROR_CODES) expect(english.has(`errors.${code}`)).toBe(true);
  });

  it.each(['si', 'ta'] as const)('%s only uses keys that exist in English', (language) => {
    const unknown = leafKeys(resources[language].translation).filter((key) => !english.has(key));
    expect(unknown).toEqual([]);
  });

  it('keeps interpolation placeholders consistent across languages', () => {
    const placeholders = (text: string) => [...text.matchAll(/{{(\w+)}}/g)].map((m) => m[1]).sort();
    const lookup = (tree: unknown, key: string) =>
      key
        .split('.')
        .reduce<unknown>((node, part) => (node as Record<string, unknown>)?.[part], tree);
    for (const language of ['si', 'ta'] as const) {
      for (const key of leafKeys(resources[language].translation)) {
        const translated = lookup(resources[language].translation, key) as string;
        expect([key, placeholders(translated)]).toEqual([
          key,
          placeholders(lookup(en, key) as string),
        ]);
      }
    }
  });
});
