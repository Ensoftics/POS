import { Injectable } from '@nestjs/common';
import type { TenantSettings, updateTenantSettingsRequestSchema } from '@pos/contracts';
import type { z } from 'zod';
import { AuditService } from '../audit/audit.service';
import { AppException } from '../common/app-exception';
import { diffFields, versionConflict } from '../common/optimistic';
import { PrismaService } from '../prisma/prisma.service';
import { profileColumns, toTenantSettings } from './settings.mapper';

type UpdateInput = z.output<typeof updateTenantSettingsRequestSchema>;

@Injectable()
export class SettingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  get(tenantId: string): Promise<TenantSettings> {
    return this.prisma.withTenant(tenantId, async (tx) => {
      const row = await tx.tenantSettings.findUnique({ where: { tenantId } });
      if (!row) throw AppException.notFound();
      return toTenantSettings(row);
    });
  }

  update(tenantId: string, input: UpdateInput): Promise<TenantSettings> {
    return this.prisma.withTenant(tenantId, async (tx) => {
      const current = await tx.tenantSettings.findUnique({ where: { tenantId } });
      if (!current) throw AppException.notFound();
      if (current.version !== input.version) throw versionConflict();

      const { version, profile, checkout, loyalty, ...fields } = input;
      const before = toTenantSettings(current);

      // Cross-field rule evaluated on the merged result, since either side may be omitted.
      const defaultLanguage = fields.defaultLanguage ?? current.defaultLanguage;
      const enabledLanguages = fields.enabledLanguages ?? current.enabledLanguages;
      if (!enabledLanguages.includes(defaultLanguage)) {
        throw AppException.validation([
          { path: 'enabledLanguages', message: 'validation.languages.default_not_enabled' },
        ]);
      }

      const data = {
        ...fields,
        ...(fields.enabledLanguages
          ? { enabledLanguages: [...new Set(fields.enabledLanguages)] }
          : {}),
        ...(profile ? profileColumns(profile) : {}),
        ...checkout,
        ...(loyalty
          ? {
              ...(loyalty.enabled !== undefined ? { loyaltyEnabled: loyalty.enabled } : {}),
              ...(loyalty.spendPerPointMinor !== undefined
                ? { loyaltySpendPerPointMinor: loyalty.spendPerPointMinor }
                : {}),
              ...(loyalty.pointValueMinor !== undefined
                ? { loyaltyPointValueMinor: loyalty.pointValueMinor }
                : {}),
              ...(loyalty.minRedeemPoints !== undefined
                ? { loyaltyMinRedeemPoints: loyalty.minRedeemPoints }
                : {}),
            }
          : {}),
      };
      // The version check in WHERE closes the race between our read and write.
      const { count } = await tx.tenantSettings.updateMany({
        where: { tenantId, version },
        data: { ...data, version: { increment: 1 } },
      });
      if (count === 0) throw versionConflict();

      const updated = await tx.tenantSettings.findUniqueOrThrow({ where: { tenantId } });
      const after = toTenantSettings(updated);
      const changes = diffFields<Record<string, unknown>>(before, {
        ...fields,
        ...(profile ? { profile } : {}),
        ...(checkout ? { checkout: { ...before.checkout, ...checkout } } : {}),
        ...(loyalty ? { loyalty: { ...before.loyalty, ...loyalty } } : {}),
      });
      if (Object.keys(changes).length > 0) {
        await this.audit.record(tx, {
          tenantId,
          action: 'settings.updated',
          entityType: 'tenant_settings',
          entityId: tenantId,
          metadata: { changes: changes as never, version: after.version },
        });
      }
      return after;
    });
  }
}
