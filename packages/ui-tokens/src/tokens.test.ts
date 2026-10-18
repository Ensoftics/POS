import { describe, expect, it } from 'vitest';
import { colors, toThemeCss } from './index';

describe('toThemeCss', () => {
  it('emits a Tailwind theme block with every colour token', () => {
    const css = toThemeCss();
    expect(css).toMatch(/^\/\* Generated/);
    expect(css).toContain('@theme {');
    expect(css).toContain(`--color-brand-600: ${colors.brand[600]};`);
    expect(css).toContain('--radius-md: 8px;');
  });
});
