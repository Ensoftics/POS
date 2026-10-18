import { HttpStatus } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { ValidationIssue, VariantAttributesDto } from '@pos/contracts';
import {
  type CurrencyCode,
  disallowedAttributes,
  isCurrencyCode,
  parseQuantity,
  type UnitCode,
  type VariantAttribute,
} from '@pos/domain';
import { AppException } from '../common/app-exception';
import type { Tx } from '../prisma/prisma.service';

/** Tenant settings that constrain catalogue data. */
export interface CatalogRules {
  currency: CurrencyCode;
  enabledAttributes: VariantAttribute[];
  enabledUnits: UnitCode[];
  allowFractionalQuantities: boolean;
  trackBatchNumbers: boolean;
  trackExpiryDates: boolean;
}

export async function loadCatalogRules(tx: Tx, tenantId: string): Promise<CatalogRules> {
  const settings = await tx.tenantSettings.findUniqueOrThrow({ where: { tenantId } });
  if (!isCurrencyCode(settings.currency))
    throw new Error(`Unsupported currency ${settings.currency}`);
  return {
    currency: settings.currency,
    enabledAttributes: settings.variantAttributes as VariantAttribute[],
    enabledUnits: settings.defaultUnits as UnitCode[],
    allowFractionalQuantities: settings.allowFractionalQuantities,
    trackBatchNumbers: settings.trackBatchNumbers,
    trackExpiryDates: settings.trackExpiryDates,
  };
}

/** Rule checks shared by the API forms and CSV import. Returns issues instead of throwing. */
export function checkVariantAgainstRules(
  variant: { attributes?: VariantAttributesDto; reorderLevel?: string | null },
  rules: CatalogRules,
  path: string,
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const disallowed = disallowedAttributes(variant.attributes ?? {}, rules.enabledAttributes);
  for (const name of disallowed) {
    issues.push({ path: `${path}attributes.${name}`, message: 'validation.attribute.not_enabled' });
  }
  if (variant.reorderLevel) {
    const parsed = parseQuantity(variant.reorderLevel, {
      allowFraction: rules.allowFractionalQuantities,
    });
    if (!parsed.ok) {
      issues.push({ path: `${path}reorderLevel`, message: `validation.quantity.${parsed.issue}` });
    }
  }
  return issues;
}

export function checkUnit(unit: string, rules: CatalogRules, path = 'unit'): ValidationIssue[] {
  return rules.enabledUnits.includes(unit as UnitCode)
    ? []
    : [{ path, message: 'validation.unit.not_enabled' }];
}

export function throwIfIssues(issues: ValidationIssue[]): void {
  if (issues.length > 0) throw AppException.validation(issues);
}

/**
 * Translates unique-index violations into specific 409 errors. Callers pre-check
 * for friendlier field errors; this covers the remaining race window.
 */
export function mapCatalogUniqueViolation(error: unknown): unknown {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002')
    return error;
  const target = JSON.stringify(error.meta?.target ?? '');
  if (target.includes('sku')) {
    return new AppException(
      'DUPLICATE_SKU',
      HttpStatus.CONFLICT,
      'This SKU is already used by another item.',
    );
  }
  if (target.includes('barcode')) {
    return new AppException(
      'DUPLICATE_BARCODE',
      HttpStatus.CONFLICT,
      'This barcode is already used by another item.',
    );
  }
  if (target.includes('attributes_key')) {
    return new AppException(
      'DUPLICATE_VARIANT',
      HttpStatus.CONFLICT,
      'This product already has a variant with these options.',
    );
  }
  return new AppException('DUPLICATE_NAME', HttpStatus.CONFLICT, 'This name is already used.');
}
