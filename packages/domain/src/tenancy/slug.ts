export const TENANT_SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]{1,46}[a-z0-9])?$/;

/**
 * Builds a URL-safe slug from a business name. Non-Latin names (Sinhala, Tamil)
 * produce an empty base, in which case a neutral prefix is used. Callers append
 * a random suffix to guarantee uniqueness.
 */
export function slugifyBusinessName(name: string): string {
  const base = name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/g, '');
  return base.length >= 2 ? base : 'shop';
}

export function withSlugSuffix(base: string, suffix: string): string {
  return `${base}-${suffix.toLowerCase()}`;
}
