import { Injectable } from '@nestjs/common';
import {
  type ImportIssue,
  MAX_IMPORT_ROWS,
  PRODUCT_CSV_COLUMNS,
  type ProductImportResult,
  variantInputSchema,
} from '@pos/contracts';
import {
  minorToDecimalString,
  parseCsv,
  parseMoney,
  toCsv,
  UNIT_CODES,
  type UnitCode,
  VARIANT_ATTRIBUTES,
  type VariantAttribute,
  variantAttributesKey,
} from '@pos/domain';
import { AuditService } from '../audit/audit.service';
import { PrismaService, type Tx } from '../prisma/prisma.service';
import { type CatalogRules, checkVariantAgainstRules, loadCatalogRules } from './catalog-rules';
import { CategoriesService } from './categories.service';
import type { Visibility } from './catalog.mapper';
import { variantColumns, type VariantData } from './products.service';

const REQUIRED_COLUMNS = ['product_name', 'sku', 'price'] as const;
const ATTRIBUTE_PREFIX = 'attr:';

interface ParsedRow {
  line: number;
  productName: string;
  category: string | null;
  brand: string | null;
  unit: UnitCode;
  status: 'ACTIVE' | 'ARCHIVED';
  variant: VariantData;
}

/**
 * CSV import/export for the catalogue. Import is two-phase: a dry run returns
 * every problem with its line and column; applying re-validates and writes all
 * rows in one transaction or nothing.
 *
 * Matching rules: a row whose SKU exists updates that variant (price, cost,
 * barcode, pack size, reorder level, options, status). A new SKU is added to the
 * product with the same name and category, or creates that product.
 */
@Injectable()
export class ProductImportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly categories: CategoriesService,
  ) {}

  async import(tenantId: string, csv: string, dryRun: boolean): Promise<ProductImportResult> {
    return this.prisma.withTenant(
      tenantId,
      async (tx) => {
        const rules = await loadCatalogRules(tx, tenantId);
        const { rows, errors } = this.parse(csv, rules);
        const empty = { productsCreated: 0, variantsCreated: 0, variantsUpdated: 0 };
        if (errors.length > 0)
          return { dryRun, applied: false, rows: rows.length, ...empty, errors };

        const plan = await this.plan(tx, tenantId, rows);
        if (plan.errors.length > 0 || dryRun) {
          return { dryRun, applied: false, rows: rows.length, ...plan.counts, errors: plan.errors };
        }

        await this.apply(tx, tenantId, plan);
        await this.audit.record(tx, {
          tenantId,
          action: 'products.imported',
          entityType: 'product',
          metadata: { rows: rows.length, ...plan.counts },
        });
        return { dryRun, applied: true, rows: rows.length, ...plan.counts, errors: [] };
      },
      { timeout: 120_000, maxWait: 10_000 },
    );
  }

  async export(tenantId: string, visibility: Visibility): Promise<string> {
    return this.prisma.withTenant(tenantId, async (tx) => {
      const rules = await loadCatalogRules(tx, tenantId);
      const variants = await tx.productVariant.findMany({
        where: { tenantId },
        include: { product: { include: { category: { select: { name: true } } } } },
        orderBy: [{ product: { name: 'asc' } }, { sku: 'asc' }],
      });
      const used = new Set<VariantAttribute>(rules.enabledAttributes);
      for (const variant of variants) {
        for (const name of Object.keys(variant.attributes as object))
          used.add(name as VariantAttribute);
      }
      const attributes = VARIANT_ATTRIBUTES.filter((name) => used.has(name));
      const columns = PRODUCT_CSV_COLUMNS.filter(
        (column) => column !== 'cost' || visibility.canSeeCost,
      );

      const rows = variants.map((variant) => {
        const status =
          variant.status === 'ARCHIVED' || variant.product.status === 'ARCHIVED'
            ? 'ARCHIVED'
            : 'ACTIVE';
        const values: Record<(typeof PRODUCT_CSV_COLUMNS)[number], string | number | null> = {
          product_name: variant.product.name,
          category: variant.product.category?.name ?? null,
          brand: variant.product.brand,
          unit: variant.product.unit,
          sku: variant.sku,
          barcode: variant.barcode,
          price: minorToDecimalString(Number(variant.priceMinor), rules.currency),
          cost:
            variant.costMinor === null
              ? null
              : minorToDecimalString(Number(variant.costMinor), rules.currency),
          pack_size: variant.packSize,
          reorder_level: variant.reorderLevel?.toString() ?? null,
          status,
        };
        const attributeValues = variant.attributes as Partial<Record<VariantAttribute, string>>;
        return [
          ...columns.map((column) => values[column]),
          ...attributes.map((name) => attributeValues[name] ?? null),
        ];
      });
      return toCsv([
        [...columns, ...attributes.map((name) => `${ATTRIBUTE_PREFIX}${name}`)],
        ...rows,
      ]);
    });
  }

  /** Parses and validates each row in isolation (format, money, units, enabled attributes). */
  private parse(csv: string, rules: CatalogRules): { rows: ParsedRow[]; errors: ImportIssue[] } {
    let table: string[][];
    try {
      table = parseCsv(csv);
    } catch {
      return {
        rows: [],
        errors: [{ row: 1, column: null, message: 'validation.import.malformed' }],
      };
    }
    const [header, ...body] = table;
    if (!header)
      return { rows: [], errors: [{ row: 1, column: null, message: 'validation.import.empty' }] };

    const columns = header.map((name) => name.trim().toLowerCase());
    const errors: ImportIssue[] = [];
    for (const required of REQUIRED_COLUMNS) {
      if (!columns.includes(required))
        errors.push({ row: 1, column: required, message: 'validation.import.missing_column' });
    }
    for (const column of columns) {
      if (column.startsWith(ATTRIBUTE_PREFIX)) {
        const name = column.slice(ATTRIBUTE_PREFIX.length) as VariantAttribute;
        if (!VARIANT_ATTRIBUTES.includes(name))
          errors.push({ row: 1, column, message: 'validation.attribute.unknown' });
      } else if (!(PRODUCT_CSV_COLUMNS as readonly string[]).includes(column)) {
        errors.push({ row: 1, column, message: 'validation.import.unknown_column' });
      }
    }
    if (body.length === 0)
      errors.push({ row: 1, column: null, message: 'validation.import.empty' });
    if (body.length > MAX_IMPORT_ROWS)
      errors.push({ row: 1, column: null, message: 'validation.import.too_many_rows' });
    if (errors.length > 0) return { rows: [], errors };

    const rows: ParsedRow[] = [];
    body.forEach((cells, index) => {
      const line = index + 2;
      const cell = (name: string) => (cells[columns.indexOf(name)] ?? '').trim();
      const optional = (name: string) =>
        columns.includes(name) && cell(name) !== '' ? cell(name) : null;
      const rowErrors: ImportIssue[] = [];
      const fail = (column: string, message: string) =>
        rowErrors.push({ row: line, column, message });

      const money = (column: string) => {
        const text = optional(column);
        if (text === null) return null;
        const parsed = parseMoney(text, rules.currency);
        if (!parsed.ok) {
          fail(column, `validation.money.${parsed.issue}`);
          return null;
        }
        return parsed.minor;
      };

      const productName = cell('product_name');
      if (!productName) fail('product_name', 'validation.required');
      else if (productName.length > 120) fail('product_name', 'validation.text.too_long');

      const unit = (optional('unit')?.toLowerCase() ?? 'piece') as UnitCode;
      if (!UNIT_CODES.includes(unit)) fail('unit', 'validation.unit.invalid');
      else if (!rules.enabledUnits.includes(unit)) fail('unit', 'validation.unit.not_enabled');

      const statusText = (optional('status') ?? 'ACTIVE').toUpperCase();
      if (statusText !== 'ACTIVE' && statusText !== 'ARCHIVED')
        fail('status', 'validation.import.status');

      const price = money('price');
      if (price === null && !rowErrors.some((e) => e.column === 'price'))
        fail('price', 'validation.required');
      const cost = money('cost');

      const packText = optional('pack_size');
      const packSize = packText === null ? null : Number(packText);
      if (
        packText !== null &&
        (!Number.isInteger(packSize) || packSize! < 1 || packSize! > 10_000)
      ) {
        fail('pack_size', 'validation.import.pack_size');
      }

      const attributes: Partial<Record<VariantAttribute, string>> = {};
      for (const column of columns.filter((c) => c.startsWith(ATTRIBUTE_PREFIX))) {
        const value = optional(column);
        if (value) attributes[column.slice(ATTRIBUTE_PREFIX.length) as VariantAttribute] = value;
      }

      const parsed = variantInputSchema.safeParse({
        sku: cell('sku'),
        barcode: optional('barcode') ?? '',
        attributes,
        priceMinor: price ?? 0,
        costMinor: cost,
        packSize: packText === null ? null : packSize,
        reorderLevel: optional('reorder_level'),
      });
      if (!parsed.success) {
        for (const issue of parsed.error.issues) {
          const field = String(issue.path[0] ?? '');
          const column =
            {
              sku: 'sku',
              barcode: 'barcode',
              reorderLevel: 'reorder_level',
              attributes: `${ATTRIBUTE_PREFIX}${String(issue.path[1] ?? '')}`,
            }[field] ?? null;
          // Money and pack size were already reported with clearer messages above.
          if (column) fail(column, issue.message);
        }
      } else {
        for (const issue of checkVariantAgainstRules(parsed.data, rules, '')) {
          const column = issue.path.startsWith('attributes.')
            ? `${ATTRIBUTE_PREFIX}${issue.path.slice('attributes.'.length)}`
            : 'reorder_level';
          fail(column, issue.message);
        }
      }

      if (rowErrors.length > 0) {
        errors.push(...rowErrors);
        return;
      }
      rows.push({
        line,
        productName,
        category: optional('category'),
        brand: optional('brand'),
        unit,
        status: statusText as 'ACTIVE' | 'ARCHIVED',
        variant: parsed.success ? parsed.data : (undefined as never),
      });
    });
    return { rows, errors };
  }

  /** Cross-row and database checks; decides which rows update and which create. */
  private async plan(tx: Tx, tenantId: string, rows: ParsedRow[]) {
    const errors: ImportIssue[] = [];
    const firstLine = { sku: new Map<string, number>(), barcode: new Map<string, number>() };
    for (const row of rows) {
      for (const kind of ['sku', 'barcode'] as const) {
        const value = row.variant[kind];
        if (!value) continue;
        const seen = firstLine[kind].get(value);
        if (seen)
          errors.push({
            row: row.line,
            column: kind,
            message: `validation.import.duplicate_${kind}_in_file`,
          });
        else firstLine[kind].set(value, row.line);
      }
    }

    const existing = await tx.productVariant.findMany({
      where: {
        tenantId,
        OR: [
          { sku: { in: rows.map((r) => r.variant.sku) } },
          { barcode: { in: rows.map((r) => r.variant.barcode).filter((b): b is string => !!b) } },
        ],
      },
      select: { id: true, sku: true, barcode: true, productId: true, attributesKey: true },
    });
    const bySku = new Map(existing.map((v) => [v.sku, v]));
    const byBarcode = new Map(existing.filter((v) => v.barcode).map((v) => [v.barcode!, v]));

    const updates: Array<{ id: string; row: ParsedRow }> = [];
    const creates: ParsedRow[] = [];
    for (const row of rows) {
      const match = bySku.get(row.variant.sku);
      const owner = row.variant.barcode ? byBarcode.get(row.variant.barcode) : undefined;
      if (owner && owner.sku !== row.variant.sku) {
        errors.push({ row: row.line, column: 'barcode', message: 'validation.barcode.taken' });
      }
      if (match) updates.push({ id: match.id, row });
      else creates.push(row);
    }

    // New SKUs join an existing product with the same name and category, or a new product.
    const groups = new Map<string, ParsedRow[]>();
    for (const row of creates) {
      const key = `${row.productName.toLowerCase()}|${row.category?.toLowerCase() ?? ''}`;
      groups.set(key, [...(groups.get(key) ?? []), row]);
    }
    const targets: Array<{ productId: string | null; rows: ParsedRow[] }> = [];
    for (const groupRows of groups.values()) {
      const first = groupRows[0]!;
      const product = await tx.product.findFirst({
        where: {
          tenantId,
          name: { equals: first.productName, mode: 'insensitive' },
          ...(first.category
            ? { category: { name: { equals: first.category, mode: 'insensitive' } } }
            : { categoryId: null }),
        },
        include: { variants: { select: { attributesKey: true } } },
      });
      const keys = new Set(product?.variants.map((v) => v.attributesKey) ?? []);
      for (const row of groupRows) {
        const key = variantAttributesKey(row.variant.attributes);
        if (keys.has(key))
          errors.push({
            row: row.line,
            column: null,
            message: 'validation.attribute.duplicate_combination',
          });
        keys.add(key);
      }
      targets.push({ productId: product?.id ?? null, rows: groupRows });
    }

    errors.sort((a, b) => a.row - b.row);
    return {
      errors,
      updates,
      targets,
      counts: {
        productsCreated: targets.filter((t) => t.productId === null).length,
        variantsCreated: creates.length,
        variantsUpdated: updates.length,
      },
    };
  }

  private async apply(
    tx: Tx,
    tenantId: string,
    plan: Awaited<ReturnType<ProductImportService['plan']>>,
  ) {
    for (const { id, row } of plan.updates) {
      await tx.productVariant.update({
        where: { id },
        data: { ...variantColumns(row.variant), status: row.status, version: { increment: 1 } },
      });
    }
    const categoryIds = new Map<string, string>();
    for (const target of plan.targets) {
      let productId = target.productId;
      if (!productId) {
        const first = target.rows[0]!;
        let categoryId: string | null = null;
        if (first.category) {
          const key = first.category.toLowerCase();
          categoryId =
            categoryIds.get(key) ??
            (await this.categories.findOrCreateByName(tx, tenantId, first.category));
          categoryIds.set(key, categoryId);
        }
        const product = await tx.product.create({
          data: {
            tenantId,
            name: first.productName,
            brand: first.brand,
            unit: first.unit,
            categoryId,
            status: first.status,
          },
        });
        productId = product.id;
      }
      await tx.productVariant.createMany({
        data: target.rows.map((row) => ({
          tenantId,
          productId: productId!,
          status: row.status,
          ...variantColumns(row.variant),
        })),
      });
    }
  }
}
