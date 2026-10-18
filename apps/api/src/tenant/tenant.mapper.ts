import type { Tenant } from '@prisma/client';
import type { TenantSummary } from '@pos/contracts';

export function toTenantSummary(tenant: Tenant): TenantSummary {
  return {
    id: tenant.id,
    name: tenant.name,
    slug: tenant.slug,
    status: tenant.status,
    businessType: tenant.businessType,
    contactPhone: tenant.contactPhone,
    onboardingStatus: tenant.onboardingStatus,
    onboardingCompletedAt: tenant.onboardingCompletedAt?.toISOString() ?? null,
    createdAt: tenant.createdAt.toISOString(),
  };
}
