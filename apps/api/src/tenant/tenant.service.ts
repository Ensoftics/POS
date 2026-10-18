import { Injectable } from '@nestjs/common';
import type { completeOnboardingRequestSchema, TenantSummary } from '@pos/contracts';
import type { z } from 'zod';
import { AuditService } from '../audit/audit.service';
import { profileFor } from '@pos/domain';
import { AppException } from '../common/app-exception';
import { LocationsService } from '../locations/locations.service';
import { PrismaService } from '../prisma/prisma.service';
import { profileColumns } from '../settings/settings.mapper';
import { toTenantSummary } from './tenant.mapper';

type CompleteOnboardingInput = z.output<typeof completeOnboardingRequestSchema>;

@Injectable()
export class TenantService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly locations: LocationsService,
  ) {}

  getCurrent(tenantId: string): Promise<TenantSummary> {
    return this.prisma.withTenant(tenantId, async (tx) => {
      const tenant = await tx.tenant.findUnique({ where: { id: tenantId } });
      if (!tenant) throw AppException.notFound();
      return toTenantSummary(tenant);
    });
  }

  /**
   * Records the business profile chosen in the onboarding wizard. The first
   * completion also applies the industry preset to settings and creates the
   * default branch and register; re-submitting only updates the profile fields
   * so later settings changes are never overwritten.
   */
  completeOnboarding(tenantId: string, input: CompleteOnboardingInput): Promise<TenantSummary> {
    return this.prisma.withTenant(tenantId, async (tx) => {
      const current = await tx.tenant.findUnique({ where: { id: tenantId } });
      if (!current) throw AppException.notFound();

      const tenant = await tx.tenant.update({
        where: { id: tenantId },
        data: {
          name: input.businessName,
          businessType: input.businessType,
          contactPhone: input.contactPhone ?? null,
          onboardingStatus: 'COMPLETED',
          onboardingCompletedAt: current.onboardingCompletedAt ?? new Date(),
        },
      });
      const firstCompletion = current.onboardingCompletedAt === null;
      if (firstCompletion) {
        await tx.tenantSettings.update({
          where: { tenantId },
          data: { ...profileColumns(profileFor(input.businessType)), version: { increment: 1 } },
        });
        await this.locations.ensureDefaultLocation(tx, tenantId);
      }
      await this.audit.record(tx, {
        tenantId,
        action: 'tenant.onboarding_completed',
        entityType: 'tenant',
        entityId: tenantId,
        metadata: {
          businessType: input.businessType,
          nameChanged: current.name !== input.businessName,
          firstCompletion,
        },
      });
      return toTenantSummary(tenant);
    });
  }
}
