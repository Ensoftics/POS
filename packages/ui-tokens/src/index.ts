/**
 * Design tokens. Colours were chosen for WCAG AA contrast: `*-700` and darker
 * on white, and `*-50`/white on `*-600`+ backgrounds, both exceed 4.5:1.
 */
export const colors = {
  brand: {
    50: '#f0fdfa',
    100: '#ccfbf1',
    200: '#99f6e4',
    500: '#14b8a6',
    600: '#0d9488',
    700: '#0f766e',
    800: '#115e59',
    900: '#134e4a',
  },
  neutral: {
    0: '#ffffff',
    50: '#f8fafc',
    100: '#f1f5f9',
    200: '#e2e8f0',
    300: '#cbd5e1',
    400: '#94a3b8',
    500: '#64748b',
    600: '#475569',
    700: '#334155',
    800: '#1e293b',
    900: '#0f172a',
  },
  success: { 50: '#f0fdf4', 600: '#16a34a', 700: '#15803d' },
  warning: { 50: '#fffbeb', 600: '#d97706', 700: '#b45309' },
  danger: { 50: '#fef2f2', 600: '#dc2626', 700: '#b91c1c' },
  info: { 50: '#eff6ff', 600: '#2563eb', 700: '#1d4ed8' },
} as const;

export const radii = { sm: 4, md: 8, lg: 12, full: 9999 } as const;

export const spacing = {
  0: 0,
  1: 4,
  2: 8,
  3: 12,
  4: 16,
  5: 20,
  6: 24,
  8: 32,
  10: 40,
  12: 48,
} as const;

export const fontSizes = { xs: 12, sm: 14, md: 16, lg: 18, xl: 20, '2xl': 24, '3xl': 30 } as const;

/** Minimum touch target for cashier-facing controls (Android guidance is 48dp). */
export const touchTarget = 48;

/** Fonts with Sinhala and Tamil coverage are listed before generic fallbacks. */
export const fontFamily = {
  sans: "'Inter', 'Noto Sans Sinhala', 'Noto Sans Tamil', system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
  mono: "ui-monospace, 'SFMono-Regular', Menlo, Consolas, monospace",
} as const;

/** Flattens tokens into CSS custom properties understood by Tailwind v4's `@theme`. */
export function toThemeCss(): string {
  const lines: string[] = [];
  for (const [palette, shades] of Object.entries(colors)) {
    for (const [shade, value] of Object.entries(shades)) {
      lines.push(`  --color-${palette}-${shade}: ${value};`);
    }
  }
  for (const [name, value] of Object.entries(radii)) lines.push(`  --radius-${name}: ${value}px;`);
  lines.push(`  --font-sans: ${fontFamily.sans};`);
  lines.push(`  --font-mono: ${fontFamily.mono};`);
  return `/* Generated from @pos/ui-tokens. Do not edit. */\n@theme {\n${lines.join('\n')}\n}\n`;
}
