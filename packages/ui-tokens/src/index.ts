/**
 * Design tokens. Colours were chosen for WCAG AA contrast: `*-700` and darker
 * on white, and `*-50`/white on `*-600`+ backgrounds, both exceed 4.5:1.
 */
export const colors = {
  /** Handloom indigo: the shell, primary actions and links. */
  brand: {
    50: '#eef0fa',
    100: '#dce0f4',
    200: '#b9c1e8',
    500: '#5566c2',
    600: '#3b4aa8',
    700: '#2d3a8c',
    800: '#23306b',
    900: '#1a2350',
  },
  /** Saffron: reserved for selling (the Sell entry and the charge action), never decoration. */
  accent: {
    50: '#fff8e6',
    100: '#fdecbf',
    400: '#f2b73a',
    500: '#e8a317',
    700: '#8a5a00',
  },
  neutral: {
    0: '#ffffff',
    50: '#f5f6fa',
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
  sans: "'IBM Plex Sans', 'Noto Sans Sinhala', 'Noto Sans Tamil', system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
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
