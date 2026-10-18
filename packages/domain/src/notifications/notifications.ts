/**
 * Feature flags and notifications shared by the API and the apps.
 */

/** Every flag the code knows. The database holds each flag's default and per-business overrides. */
export const FEATURE_FLAGS = [
  'notifications.daily_summary',
  'notifications.email',
  'loyalty',
  'messaging',
] as const;
export type FeatureFlagKey = (typeof FEATURE_FLAGS)[number];

export function isFeatureFlagKey(value: string): value is FeatureFlagKey {
  return (FEATURE_FLAGS as readonly string[]).includes(value);
}

/** A business's override wins over the default; unknown keys are ignored. */
export function resolveFeatureFlags(
  defaults: ReadonlyArray<{ key: string; defaultEnabled: boolean }>,
  overrides: ReadonlyArray<{ flagKey: string; enabled: boolean }>,
): FeatureFlagKey[] {
  const override = new Map(overrides.map((o) => [o.flagKey, o.enabled]));
  return defaults
    .filter((flag) => isFeatureFlagKey(flag.key))
    .filter((flag) => override.get(flag.key) ?? flag.defaultEnabled)
    .map((flag) => flag.key as FeatureFlagKey);
}

export const NOTIFICATION_KINDS = [
  'INVENTORY_ALERT',
  'DAILY_SUMMARY',
  'SALE_CONFLICT',
  'SUBSCRIPTION',
] as const;
export type NotificationKind = (typeof NOTIFICATION_KINDS)[number];

/** Daily work (stock alerts, digest) runs once the business's local clock reaches this hour. */
export const DIGEST_LOCAL_HOUR = 7;
/** Batches expiring within this many days (or already expired) are reported. */
export const EXPIRY_ALERT_DAYS = 30;
/** Notifications older than this are removed. */
export const NOTIFICATION_RETENTION_DAYS = 90;

/** True when the daily run for `localDate` may start (local time at or after the digest hour). */
export function isDailyRunDue(localHour: number): boolean {
  return localHour >= DIGEST_LOCAL_HOUR;
}

/** "2026-10-17" → "2026-10-16". */
export function previousDate(isoDate: string): string {
  const date = new Date(`${isoDate}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}
