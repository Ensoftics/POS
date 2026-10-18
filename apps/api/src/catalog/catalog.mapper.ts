import type {
  Category as CategoryRow,
  Product as ProductRow,
  ProductImage as ImageRow,
  ProductVariant as VariantRow,
} from '@prisma/client';
import type { Category, Product, Variant, VariantAttributesDto } from '@pos/contracts';
import type { UnitCode } from '@pos/domain';
import type { MediaLinks } from '../media/media-links';

export type ProductWithRelations = ProductRow & {
  category: Pick<CategoryRow, 'name'> | null;
  variants: VariantRow[];
  images: ImageRow[];
};

/** Only roles that manage products may see costs (margins are commercially sensitive). */
export interface Visibility {
  canSeeCost: boolean;
}

export const productInclude = {
  category: { select: { name: true } },
  variants: { orderBy: [{ createdAt: 'asc' as const }, { sku: 'asc' as const }] },
  images: { orderBy: { position: 'asc' as const } },
};

export function toCategory(row: CategoryRow): Category {
  return {
    id: row.id,
    name: row.name,
    parentId: row.parentId,
    status: row.status,
    version: row.version,
  };
}

export function toVariant(row: VariantRow, visibility: Visibility): Variant {
  return {
    id: row.id,
    productId: row.productId,
    sku: row.sku,
    barcode: row.barcode,
    attributes: row.attributes as VariantAttributesDto,
    priceMinor: Number(row.priceMinor),
    costMinor: visibility.canSeeCost && row.costMinor !== null ? Number(row.costMinor) : null,
    packSize: row.packSize,
    reorderLevel: row.reorderLevel === null ? null : row.reorderLevel.toString(),
    status: row.status,
    version: row.version,
  };
}

export function toProduct(
  row: ProductWithRelations,
  visibility: Visibility,
  links: MediaLinks,
): Product {
  return {
    id: row.id,
    name: row.name,
    brand: row.brand,
    description: row.description,
    unit: row.unit as UnitCode,
    categoryId: row.categoryId,
    categoryName: row.category?.name ?? null,
    taxRateId: row.taxRateId,
    status: row.status,
    version: row.version,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    variants: row.variants.map((variant) => toVariant(variant, visibility)),
    images: row.images.map((image) => ({
      id: image.id,
      url: links.imageUrl(row.tenantId, image.id, 'full'),
      thumbUrl: links.imageUrl(row.tenantId, image.id, 'thumb'),
      width: image.width,
      height: image.height,
    })),
  };
}
