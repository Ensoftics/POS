import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type {
  createProductRequestSchema,
  createVariantRequestSchema,
  listProductsQuerySchema,
  Product,
  ProductPage,
  updateProductRequestSchema,
  updateVariantRequestSchema,
  ValidationIssue,
  VariantAttributesDto,
  VariantLookup,
} from '@pos/contracts';
import { variantAttributesKey } from '@pos/domain';
import type { z } from 'zod';
import { AuditService } from '../audit/audit.service';
import { AppException } from '../common/app-exception';
import { diffFields, versionConflict } from '../common/optimistic';
import { MediaLinks } from '../media/media-links';
import { PrismaService, type Tx } from '../prisma/prisma.service';
import {
  checkUnit,
  checkVariantAgainstRules,
  loadCatalogRules,
  mapCatalogUniqueViolation,
  throwIfIssues,
} from './catalog-rules';
import { productInclude, toProduct, toVariant, type Visibility } from './catalog.mapper';

type ListQuery = z.output<typeof listProductsQuerySchema>;
type CreateInput = z.output<typeof createProductRequestSchema>;
type UpdateInput = z.output<typeof updateProductRequestSchema>;
type CreateVariantInput = z.output<typeof createVariantRequestSchema>;
type UpdateVariantInput = z.output<typeof updateVariantRequestSchema>;

export interface VariantData {
  sku: string;
  barcode?: string | null;
  attributes: VariantAttributesDto;
  priceMinor: number;
  costMinor?: number | null;
  packSize?: number | null;
  reorderLevel?: string | null;
}

/** Trims attribute values and computes the canonical key stored alongside them. */
export function variantColumns(variant: VariantData) {
  const attributes = Object.fromEntries(
    Object.entries(variant.attributes).map(([name, value]) => [name, value!.trim()]),
  );
  return {
    sku: variant.sku,
    barcode: variant.barcode ?? null,
    attributes,
    attributesKey: variantAttributesKey(attributes),
    priceMinor: BigInt(variant.priceMinor),
    costMinor:
      variant.costMinor === null || variant.costMinor === undefined
        ? null
        : BigInt(variant.costMinor),
    packSize: variant.packSize ?? null,
    reorderLevel: variant.reorderLevel ?? null,
  };
}

@Injectable()
export class ProductsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly links: MediaLinks,
  ) {}

  list(tenantId: string, query: ListQuery, visibility: Visibility): Promise<ProductPage> {
    return this.prisma.withTenant(tenantId, async (tx) => {
      const filters: Prisma.ProductWhereInput[] = [{ tenantId }];
      if (query.status !== 'ALL') filters.push({ status: query.status });
      if (query.categoryId) {
        // A parent category also lists its subcategories' products.
        filters.push({
          OR: [{ categoryId: query.categoryId }, { category: { parentId: query.categoryId } }],
        });
      }
      if (query.q) {
        const q = query.q;
        filters.push({
          OR: [
            { name: { contains: q, mode: 'insensitive' } },
            { brand: { contains: q, mode: 'insensitive' } },
            { variants: { some: { sku: { startsWith: q.toUpperCase() } } } },
            { variants: { some: { barcode: q } } },
          ],
        });
      }
      const rows = await tx.product.findMany({
        where: { AND: filters },
        include: productInclude,
        orderBy: [{ name: 'asc' }, { id: 'asc' }],
        take: query.limit + 1,
        ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
      });
      const items = rows.slice(0, query.limit);
      return {
        items: items.map((row) => toProduct(row, visibility, this.links)),
        nextCursor: rows.length > query.limit ? (items.at(-1)?.id ?? null) : null,
      };
    });
  }

  get(tenantId: string, id: string, visibility: Visibility): Promise<Product> {
    return this.prisma.withTenant(tenantId, async (tx) =>
      toProduct(await this.load(tx, tenantId, id), visibility, this.links),
    );
  }

  async create(tenantId: string, input: CreateInput, visibility: Visibility): Promise<Product> {
    return this.mapErrors(() =>
      this.prisma.withTenant(tenantId, async (tx) => {
        const rules = await loadCatalogRules(tx, tenantId);
        const issues: ValidationIssue[] = [
          ...checkUnit(input.unit, rules),
          ...(await this.checkCategory(tx, tenantId, input.categoryId)),
          ...(await this.checkTaxRate(tx, tenantId, input.taxRateId)),
          ...input.variants.flatMap((variant, index) =>
            checkVariantAgainstRules(variant, rules, `variants.${index}.`),
          ),
          ...(await this.checkTakenCodes(tx, tenantId, input.variants, null, 'variants.')),
        ];
        throwIfIssues(issues);

        const product = await tx.product.create({
          data: {
            tenantId,
            name: input.name,
            brand: input.brand ?? null,
            description: input.description ?? null,
            unit: input.unit,
            categoryId: input.categoryId ?? null,
            taxRateId: input.taxRateId ?? null,
          },
        });
        await tx.productVariant.createMany({
          data: input.variants.map((variant) => ({
            tenantId,
            productId: product.id,
            ...variantColumns(variant),
          })),
        });
        await this.audit.record(tx, {
          tenantId,
          action: 'product.created',
          entityType: 'product',
          entityId: product.id,
          metadata: { name: product.name, variants: input.variants.length },
        });
        return toProduct(await this.load(tx, tenantId, product.id), visibility, this.links);
      }),
    );
  }

  async update(
    tenantId: string,
    id: string,
    input: UpdateInput,
    visibility: Visibility,
  ): Promise<Product> {
    return this.mapErrors(() =>
      this.prisma.withTenant(tenantId, async (tx) => {
        const current = await tx.product.findFirst({ where: { id, tenantId } });
        if (!current) throw AppException.notFound();
        if (current.version !== input.version) throw versionConflict();
        const { version, ...patch } = input;

        const rules = await loadCatalogRules(tx, tenantId);
        throwIfIssues([
          ...(patch.unit && patch.unit !== current.unit ? checkUnit(patch.unit, rules) : []),
          ...(patch.categoryId !== undefined && patch.categoryId !== current.categoryId
            ? await this.checkCategory(tx, tenantId, patch.categoryId)
            : []),
          ...(patch.taxRateId !== undefined && patch.taxRateId !== current.taxRateId
            ? await this.checkTaxRate(tx, tenantId, patch.taxRateId)
            : []),
        ]);

        const { count } = await tx.product.updateMany({
          where: { id, tenantId, version },
          data: { ...patch, version: { increment: 1 } },
        });
        if (count === 0) throw versionConflict();

        const archiving = patch.status === 'ARCHIVED' && current.status === 'ACTIVE';
        const restoring = patch.status === 'ACTIVE' && current.status === 'ARCHIVED';
        await this.audit.record(tx, {
          tenantId,
          action: archiving
            ? 'product.archived'
            : restoring
              ? 'product.restored'
              : 'product.updated',
          entityType: 'product',
          entityId: id,
          metadata: { changes: diffFields<Record<string, unknown>>(current, patch) as never },
        });
        return toProduct(await this.load(tx, tenantId, id), visibility, this.links);
      }),
    );
  }

  async createVariant(
    tenantId: string,
    input: CreateVariantInput,
    visibility: Visibility,
  ): Promise<Product> {
    return this.mapErrors(() =>
      this.prisma.withTenant(tenantId, async (tx) => {
        const product = await this.load(tx, tenantId, input.productId);
        const { productId, ...variant } = input;
        const rules = await loadCatalogRules(tx, tenantId);
        const key = variantAttributesKey(variant.attributes);
        throwIfIssues([
          ...checkVariantAgainstRules(variant, rules, ''),
          ...(await this.checkTakenCodes(tx, tenantId, [variant], null, null)),
          ...(product.variants.some((existing) => existing.attributesKey === key)
            ? [{ path: 'attributes', message: 'validation.attribute.duplicate_combination' }]
            : []),
        ]);
        const row = await tx.productVariant.create({
          data: { tenantId, productId, ...variantColumns(variant) },
        });
        await this.audit.record(tx, {
          tenantId,
          action: 'variant.created',
          entityType: 'product_variant',
          entityId: row.id,
          metadata: { productId, sku: row.sku, priceMinor: variant.priceMinor },
        });
        return toProduct(await this.load(tx, tenantId, productId), visibility, this.links);
      }),
    );
  }

  async updateVariant(
    tenantId: string,
    id: string,
    input: UpdateVariantInput,
    visibility: Visibility,
  ): Promise<Product> {
    return this.mapErrors(() =>
      this.prisma.withTenant(tenantId, async (tx) => {
        const current = await tx.productVariant.findFirst({ where: { id, tenantId } });
        if (!current) throw AppException.notFound();
        if (current.version !== input.version) throw versionConflict();
        const { version, ...patch } = input;
        const before = toVariant(current, { canSeeCost: true });

        const rules = await loadCatalogRules(tx, tenantId);
        const issues = checkVariantAgainstRules(
          { attributes: patch.attributes, reorderLevel: patch.reorderLevel },
          rules,
          '',
        );
        issues.push(
          ...(await this.checkTakenCodes(
            tx,
            tenantId,
            [
              {
                sku: patch.sku ?? current.sku,
                barcode: patch.barcode === undefined ? current.barcode : patch.barcode,
              },
            ],
            id,
            null,
          )),
        );
        if (patch.attributes) {
          const key = variantAttributesKey(patch.attributes);
          const clash = await tx.productVariant.count({
            where: { tenantId, productId: current.productId, attributesKey: key, id: { not: id } },
          });
          if (clash > 0)
            issues.push({
              path: 'attributes',
              message: 'validation.attribute.duplicate_combination',
            });
        }
        throwIfIssues(issues);

        const merged = variantColumns({
          sku: patch.sku ?? current.sku,
          barcode: patch.barcode === undefined ? current.barcode : patch.barcode,
          attributes: patch.attributes ?? before.attributes,
          priceMinor: patch.priceMinor ?? before.priceMinor,
          costMinor: patch.costMinor === undefined ? before.costMinor : patch.costMinor,
          packSize: patch.packSize === undefined ? current.packSize : patch.packSize,
          reorderLevel: patch.reorderLevel === undefined ? before.reorderLevel : patch.reorderLevel,
        });
        const { count } = await tx.productVariant.updateMany({
          where: { id, tenantId, version },
          data: {
            ...merged,
            ...(patch.status ? { status: patch.status } : {}),
            version: { increment: 1 },
          },
        });
        if (count === 0) throw versionConflict();

        await this.audit.record(tx, {
          tenantId,
          action: 'variant.updated',
          entityType: 'product_variant',
          entityId: id,
          metadata: {
            productId: current.productId,
            sku: merged.sku,
            changes: diffFields<Record<string, unknown>>(before, patch) as never,
          },
        });
        return toProduct(await this.load(tx, tenantId, current.productId), visibility, this.links);
      }),
    );
  }

  /** Exact barcode first, then SKU. Only sellable (active) items are returned. */
  lookup(tenantId: string, code: string, visibility: Visibility): Promise<VariantLookup> {
    return this.prisma.withTenant(tenantId, async (tx) => {
      const sellable = {
        tenantId,
        status: 'ACTIVE' as const,
        product: { status: 'ACTIVE' as const },
      };
      const variant =
        (await tx.productVariant.findFirst({ where: { ...sellable, barcode: code } })) ??
        (await tx.productVariant.findFirst({ where: { ...sellable, sku: code.toUpperCase() } }));
      if (!variant) throw AppException.notFound('No active item has this barcode or SKU');
      const product = await this.load(tx, tenantId, variant.productId);
      return {
        product: toProduct(product, visibility, this.links),
        variant: toVariant(variant, visibility),
      };
    });
  }

  /**
   * Finds SKUs/barcodes already used by other variants of this tenant, reported
   * as field issues. `pathPrefix` 'variants.' yields paths like variants.2.sku.
   */
  async checkTakenCodes(
    tx: Tx,
    tenantId: string,
    variants: Array<{ sku: string; barcode?: string | null }>,
    excludeVariantId: string | null,
    pathPrefix: string | null,
  ): Promise<ValidationIssue[]> {
    const skus = variants.map((v) => v.sku);
    const barcodes = variants.map((v) => v.barcode).filter((b): b is string => !!b);
    const taken = await tx.productVariant.findMany({
      where: {
        tenantId,
        ...(excludeVariantId ? { id: { not: excludeVariantId } } : {}),
        OR: [{ sku: { in: skus } }, ...(barcodes.length ? [{ barcode: { in: barcodes } }] : [])],
      },
      select: { sku: true, barcode: true },
    });
    const takenSkus = new Set(taken.map((t) => t.sku));
    const takenBarcodes = new Set(taken.map((t) => t.barcode).filter(Boolean));
    const issues: ValidationIssue[] = [];
    variants.forEach((variant, index) => {
      const path = pathPrefix === null ? '' : `${pathPrefix}${index}.`;
      if (takenSkus.has(variant.sku))
        issues.push({ path: `${path}sku`, message: 'validation.sku.taken' });
      if (variant.barcode && takenBarcodes.has(variant.barcode)) {
        issues.push({ path: `${path}barcode`, message: 'validation.barcode.taken' });
      }
    });
    return issues;
  }

  async checkCategory(
    tx: Tx,
    tenantId: string,
    categoryId: string | null | undefined,
  ): Promise<ValidationIssue[]> {
    if (!categoryId) return [];
    const category = await tx.category.findFirst({
      where: { id: categoryId, tenantId },
      select: { status: true },
    });
    if (!category) return [{ path: 'categoryId', message: 'validation.category.not_found' }];
    if (category.status !== 'ACTIVE')
      return [{ path: 'categoryId', message: 'validation.category.archived' }];
    return [];
  }

  async checkTaxRate(
    tx: Tx,
    tenantId: string,
    taxRateId: string | null | undefined,
  ): Promise<ValidationIssue[]> {
    if (!taxRateId) return [];
    const rate = await tx.taxRate.findFirst({
      where: { id: taxRateId, tenantId },
      select: { status: true },
    });
    if (!rate) return [{ path: 'taxRateId', message: 'validation.tax_rate.not_found' }];
    if (rate.status !== 'ACTIVE')
      return [{ path: 'taxRateId', message: 'validation.tax_rate.archived' }];
    return [];
  }

  private async load(tx: Tx, tenantId: string, id: string) {
    const row = await tx.product.findFirst({ where: { id, tenantId }, include: productInclude });
    if (!row) throw AppException.notFound();
    return row;
  }

  private async mapErrors<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (error) {
      throw mapCatalogUniqueViolation(error);
    }
  }
}
