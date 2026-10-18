import type { BusinessType, Prisma, TenantSettings as SettingsRow } from '@prisma/client';
import type { TenantSettings } from '@pos/contracts';
import {
  type BusinessProfile,
  isCurrencyCode,
  profileFor,
  type UnitCode,
  type VariantAttribute,
} from '@pos/domain';

export function profileColumns(profile: BusinessProfile) {
  return {
    trackBatchNumbers: profile.trackBatchNumbers,
    trackExpiryDates: profile.trackExpiryDates,
    allowFractionalQuantities: profile.allowFractionalQuantities,
    variantAttributes: [...profile.variantAttributes],
    defaultUnits: [...profile.defaultUnits],
  };
}

/** Initial settings for a new tenant (LKR, Asia/Colombo, all three languages). */
export function defaultSettingsData(
  tenantId: string,
  businessType: BusinessType | null,
): Prisma.TenantSettingsUncheckedCreateInput {
  return { tenantId, ...profileColumns(profileFor(businessType)) };
}

export function toTenantSettings(row: SettingsRow): TenantSettings {
  if (!isCurrencyCode(row.currency)) {
    // Only reachable if the database was edited by hand; surfaces as a 500 with a clear log line.
    throw new Error(`Unsupported currency stored for tenant ${row.tenantId}: ${row.currency}`);
  }
  return {
    version: row.version,
    legalName: row.legalName,
    taxRegistrationNumber: row.taxRegistrationNumber,
    addressLine1: row.addressLine1,
    addressLine2: row.addressLine2,
    city: row.city,
    postalCode: row.postalCode,
    country: row.country,
    currency: row.currency,
    timezone: row.timezone,
    defaultLanguage: row.defaultLanguage,
    enabledLanguages: row.enabledLanguages,
    profile: {
      trackBatchNumbers: row.trackBatchNumbers,
      trackExpiryDates: row.trackExpiryDates,
      allowFractionalQuantities: row.allowFractionalQuantities,
      variantAttributes: row.variantAttributes as VariantAttribute[],
      defaultUnits: row.defaultUnits as UnitCode[],
    },
    checkout: {
      pricesIncludeTax: row.pricesIncludeTax,
      allowNegativeStock: row.allowNegativeStock,
      receiptFooter: row.receiptFooter,
      discountApprovalBp: row.discountApprovalBp,
      refundsRequireApproval: row.refundsRequireApproval,
    },
    loyalty: {
      enabled: row.loyaltyEnabled,
      spendPerPointMinor: row.loyaltySpendPerPointMinor,
      pointValueMinor: row.loyaltyPointValueMinor,
      minRedeemPoints: row.loyaltyMinRedeemPoints,
    },
    updatedAt: row.updatedAt.toISOString(),
  };
}
