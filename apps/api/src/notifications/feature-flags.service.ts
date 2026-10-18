import { Injectable } from '@nestjs/common';
import { type FeatureFlagKey, resolveFeatureFlags } from '@pos/domain';
import type { Tx } from '../prisma/prisma.service';

/**
 * Feature flags: a default per flag (set by platform staff) and optional
 * per-business overrides. Read inside the caller's transaction.
 */
@Injectable()
export class FeatureFlags {
  async enabledFor(tx: Tx, tenantId: string): Promise<FeatureFlagKey[]> {
    const [defaults, overrides] = await Promise.all([
      tx.featureFlag.findMany({ select: { key: true, defaultEnabled: true } }),
      tx.tenantFeatureFlag.findMany({
        where: { tenantId },
        select: { flagKey: true, enabled: true },
      }),
    ]);
    return resolveFeatureFlags(defaults, overrides);
  }

  async isEnabled(tx: Tx, tenantId: string, key: FeatureFlagKey): Promise<boolean> {
    return (await this.enabledFor(tx, tenantId)).includes(key);
  }
}
