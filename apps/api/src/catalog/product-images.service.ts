import { randomUUID } from 'node:crypto';
import { HttpStatus, Injectable } from '@nestjs/common';
import { MAX_PRODUCT_IMAGES, type Product } from '@pos/contracts';
import { AuditService } from '../audit/audit.service';
import { AppException } from '../common/app-exception';
import { RequestContext } from '../common/request-context';
import { ImageRejected, type ProcessedImage, processProductImage } from '../media/image-processing';
import { imageObjectKey } from '../media/media-links';
import { ObjectStorage } from '../media/object-storage';
import { PrismaService, type Tx } from '../prisma/prisma.service';
import type { Visibility } from './catalog.mapper';
import { ProductsService } from './products.service';

const WEBP = 'image/webp';
const keysOf = (tenantId: string, imageId: string) => [
  imageObjectKey(tenantId, imageId, 'full'),
  imageObjectKey(tenantId, imageId, 'thumb'),
];
const fileIssue = (message: string) => AppException.validation([{ path: 'file', message }]);

/**
 * Product photos. Files are processed before anything is stored, written to the
 * bucket under a fresh id, then recorded; a failed recording removes the files
 * again. Each change bumps the product's updated_at so tills pick it up in their
 * next catalogue sync (the version is left alone: images do not conflict with
 * edits to the product's details).
 */
@Injectable()
export class ProductImagesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: ObjectStorage,
    private readonly audit: AuditService,
    private readonly products: ProductsService,
  ) {}

  async add(
    tenantId: string,
    productId: string,
    file: Buffer | undefined,
    visibility: Visibility,
  ): Promise<Product> {
    this.storage.assertAvailable();
    if (!file || file.length === 0) throw fileIssue('validation.image.required');
    await this.prisma.withTenant(tenantId, (tx) => this.lockProduct(tx, tenantId, productId));

    let image: ProcessedImage;
    try {
      image = await processProductImage(file);
    } catch (error) {
      if (error instanceof ImageRejected) throw fileIssue(`validation.image.${error.issue}`);
      throw error;
    }

    // The same photo again (a double tap, a retried upload) is kept once.
    const existing = await this.prisma.withTenant(tenantId, (tx) =>
      tx.productImage.findUnique({
        where: { tenantId_productId_sha256: { tenantId, productId, sha256: image.sha256 } },
      }),
    );
    if (existing) return this.products.get(tenantId, productId, visibility);

    const imageId = randomUUID();
    const [fullKey, thumbKey] = keysOf(tenantId, imageId) as [string, string];
    await this.storage.put(fullKey, image.full, WEBP);
    await this.storage.put(thumbKey, image.thumb, WEBP);

    try {
      const added = await this.prisma.withTenant(tenantId, async (tx) => {
        await this.lockProduct(tx, tenantId, productId);
        const duplicate = await tx.productImage.findUnique({
          where: { tenantId_productId_sha256: { tenantId, productId, sha256: image.sha256 } },
          select: { id: true },
        });
        if (duplicate) return false;
        const count = await tx.productImage.count({ where: { tenantId, productId } });
        if (count >= MAX_PRODUCT_IMAGES)
          throw new AppException(
            'IMAGE_LIMIT_REACHED',
            HttpStatus.CONFLICT,
            `A product can have up to ${MAX_PRODUCT_IMAGES} photos.`,
          );
        await tx.productImage.create({
          data: {
            id: imageId,
            tenantId,
            productId,
            position: count,
            width: image.width,
            height: image.height,
            bytes: image.full.length,
            sha256: image.sha256,
            createdBy: RequestContext.get()?.principal?.userId ?? null,
          },
        });
        await this.touch(tx, tenantId, productId);
        await this.audit.record(tx, {
          tenantId,
          action: 'product.image_added',
          entityType: 'product',
          entityId: productId,
          metadata: { imageId, width: image.width, height: image.height },
        });
        return true;
      });
      if (!added) await this.storage.remove([fullKey, thumbKey]);
    } catch (error) {
      await this.storage.remove([fullKey, thumbKey]);
      throw error;
    }
    return this.products.get(tenantId, productId, visibility);
  }

  async remove(
    tenantId: string,
    productId: string,
    imageId: string,
    visibility: Visibility,
  ): Promise<Product> {
    await this.prisma.withTenant(tenantId, async (tx) => {
      await this.lockProduct(tx, tenantId, productId);
      const image = await tx.productImage.findFirst({
        where: { id: imageId, tenantId, productId },
      });
      if (!image) throw AppException.notFound();
      await tx.productImage.delete({ where: { id: image.id } });
      await tx.$executeRaw`
        UPDATE product_images SET position = position - 1
        WHERE tenant_id = ${tenantId}::uuid AND product_id = ${productId}::uuid
          AND position > ${image.position}`;
      await this.touch(tx, tenantId, productId);
      await this.audit.record(tx, {
        tenantId,
        action: 'product.image_removed',
        entityType: 'product',
        entityId: productId,
        metadata: { imageId },
      });
    });
    // After the commit: a failed delete leaves an unreferenced file, never a broken image.
    await this.storage.remove(keysOf(tenantId, imageId));
    return this.products.get(tenantId, productId, visibility);
  }

  async reorder(
    tenantId: string,
    productId: string,
    imageIds: string[],
    visibility: Visibility,
  ): Promise<Product> {
    await this.prisma.withTenant(tenantId, async (tx) => {
      await this.lockProduct(tx, tenantId, productId);
      const current = await tx.productImage.findMany({
        where: { tenantId, productId },
        select: { id: true },
      });
      const known = new Set(current.map((image) => image.id));
      if (
        imageIds.length !== known.size ||
        new Set(imageIds).size !== imageIds.length ||
        !imageIds.every((id) => known.has(id))
      )
        throw AppException.validation([
          { path: 'imageIds', message: 'validation.image.order_mismatch' },
        ]);
      for (const [position, id] of imageIds.entries()) {
        await tx.productImage.update({ where: { id }, data: { position } });
      }
      await this.touch(tx, tenantId, productId);
      await this.audit.record(tx, {
        tenantId,
        action: 'product.images_reordered',
        entityType: 'product',
        entityId: productId,
        metadata: { mainImageId: imageIds[0] },
      });
    });
    return this.products.get(tenantId, productId, visibility);
  }

  /** 404 for products of other businesses; serialises image changes per product. */
  private async lockProduct(tx: Tx, tenantId: string, productId: string): Promise<void> {
    const rows = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM products
      WHERE tenant_id = ${tenantId}::uuid AND id = ${productId}::uuid
      FOR UPDATE`;
    if (rows.length === 0) throw AppException.notFound();
  }

  private async touch(tx: Tx, tenantId: string, productId: string): Promise<void> {
    await tx.$executeRaw`
      UPDATE products SET updated_at = now()
      WHERE tenant_id = ${tenantId}::uuid AND id = ${productId}::uuid`;
  }
}
