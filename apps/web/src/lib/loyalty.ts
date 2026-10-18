import type { TenantSettings } from '@pos/contracts';
import type { LoyaltyRules } from '@pos/domain';

/**
 * The business's loyalty rules, or null when the programme is off (owner's
 * setting) or unavailable (platform feature flag). The server re-checks both.
 */
export function loyaltyRules(
  settings: Pick<TenantSettings, 'loyalty'> | undefined,
  features: readonly string[] | undefined,
): LoyaltyRules | null {
  const loyalty = settings?.loyalty;
  if (!loyalty?.enabled || !(features ?? []).includes('loyalty')) return null;
  return loyalty;
}
