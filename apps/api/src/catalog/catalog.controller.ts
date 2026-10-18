import {
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiProduces, ApiTags } from '@nestjs/swagger';
import {
  type Category,
  type CategoryList,
  categoryListSchema,
  categorySchema,
  createCategoryRequestSchema,
  createProductRequestSchema,
  createVariantRequestSchema,
  errorResponseSchema,
  listProductsQuerySchema,
  lookupQuerySchema,
  type Product,
  productImportRequestSchema,
  type ProductImportResult,
  productImportResultSchema,
  type ProductPage,
  productPageSchema,
  productSchema,
  reorderProductImagesRequestSchema,
  updateCategoryRequestSchema,
  updateProductRequestSchema,
  updateVariantRequestSchema,
  type VariantLookup,
  variantLookupSchema,
} from '@pos/contracts';
import type { Response } from 'express';
import type { z } from 'zod';
import { CurrentPrincipal, RequirePermissions, SensitiveRateLimit } from '../auth/auth.decorators';
import { AppException } from '../common/app-exception';
import type { AuthPrincipal } from '../common/request-context';
import { ApiZodBody, ApiZodQuery, ApiZodResponse, ZodBody, ZodQuery } from '../common/zod';
import type { Visibility } from './catalog.mapper';
import { CategoriesService } from './categories.service';
import { ProductImagesService } from './product-images.service';
import { ProductImportService } from './product-import.service';
import { ProductsService } from './products.service';

const uuidParam = new ParseUUIDPipe({ exceptionFactory: () => AppException.notFound() });
const visibilityOf = (principal: AuthPrincipal): Visibility => ({
  canSeeCost: principal.permissions.includes('products.manage'),
});

@ApiTags('Catalog')
@ApiBearerAuth()
@Controller()
export class CatalogController {
  constructor(
    private readonly categories: CategoriesService,
    private readonly products: ProductsService,
    private readonly importer: ProductImportService,
    private readonly images: ProductImagesService,
  ) {}

  /* Categories */

  @Get('categories')
  @RequirePermissions('products.read')
  @ApiZodResponse(200, categoryListSchema)
  listCategories(@CurrentPrincipal() principal: AuthPrincipal): Promise<CategoryList> {
    return this.categories.list(principal.tenantId);
  }

  @Post('categories')
  @RequirePermissions('products.manage')
  @ApiZodBody(createCategoryRequestSchema)
  @ApiZodResponse(201, categorySchema)
  @ApiZodResponse(409, errorResponseSchema, 'DUPLICATE_NAME or CATEGORY_DEPTH')
  createCategory(
    @CurrentPrincipal() principal: AuthPrincipal,
    @ZodBody(createCategoryRequestSchema) body: z.output<typeof createCategoryRequestSchema>,
  ): Promise<Category> {
    return this.categories.create(principal.tenantId, body);
  }

  @Patch('categories/:id')
  @RequirePermissions('products.manage')
  @ApiZodBody(updateCategoryRequestSchema)
  @ApiZodResponse(200, categorySchema)
  updateCategory(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param('id', uuidParam) id: string,
    @ZodBody(updateCategoryRequestSchema) body: z.output<typeof updateCategoryRequestSchema>,
  ): Promise<Category> {
    return this.categories.update(principal.tenantId, id, body);
  }

  /* Products */

  @Get('products')
  @RequirePermissions('products.read')
  @ApiZodQuery(listProductsQuerySchema)
  @ApiZodResponse(200, productPageSchema)
  listProducts(
    @CurrentPrincipal() principal: AuthPrincipal,
    @ZodQuery(listProductsQuerySchema) query: z.output<typeof listProductsQuerySchema>,
  ): Promise<ProductPage> {
    return this.products.list(principal.tenantId, query, visibilityOf(principal));
  }

  /** Barcode-first lookup for checkout: exact barcode, then SKU; active items only. */
  @Get('products/lookup')
  @RequirePermissions('products.read')
  @ApiZodQuery(lookupQuerySchema)
  @ApiZodResponse(200, variantLookupSchema)
  @ApiZodResponse(404, errorResponseSchema)
  lookup(
    @CurrentPrincipal() principal: AuthPrincipal,
    @ZodQuery(lookupQuerySchema) query: z.output<typeof lookupQuerySchema>,
  ): Promise<VariantLookup> {
    return this.products.lookup(principal.tenantId, query.code, visibilityOf(principal));
  }

  @Get('products/export')
  @RequirePermissions('products.import')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Cache-Control', 'no-store')
  @ApiProduces('text/csv')
  async exportProducts(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Res({ passthrough: true }) res: Response,
  ): Promise<string> {
    const date = new Date().toISOString().slice(0, 10).replaceAll('-', '');
    res.setHeader('Content-Disposition', `attachment; filename="products-${date}.csv"`);
    // BOM so Excel opens the UTF-8 file (Sinhala/Tamil names) correctly.
    return `\uFEFF${await this.importer.export(principal.tenantId, visibilityOf(principal))}`;
  }

  @Post('products/import')
  @HttpCode(HttpStatus.OK)
  @SensitiveRateLimit()
  @RequirePermissions('products.import')
  @ApiZodBody(productImportRequestSchema)
  @ApiZodResponse(200, productImportResultSchema, 'Dry-run report, or the applied result.')
  importProducts(
    @CurrentPrincipal() principal: AuthPrincipal,
    @ZodBody(productImportRequestSchema) body: z.output<typeof productImportRequestSchema>,
  ): Promise<ProductImportResult> {
    return this.importer.import(principal.tenantId, body.csv, body.dryRun);
  }

  @Get('products/:id')
  @RequirePermissions('products.read')
  @ApiZodResponse(200, productSchema)
  getProduct(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param('id', uuidParam) id: string,
  ): Promise<Product> {
    return this.products.get(principal.tenantId, id, visibilityOf(principal));
  }

  @Post('products')
  @RequirePermissions('products.manage')
  @ApiZodBody(createProductRequestSchema)
  @ApiZodResponse(201, productSchema)
  @ApiZodResponse(409, errorResponseSchema, 'DUPLICATE_SKU or DUPLICATE_BARCODE')
  createProduct(
    @CurrentPrincipal() principal: AuthPrincipal,
    @ZodBody(createProductRequestSchema) body: z.output<typeof createProductRequestSchema>,
  ): Promise<Product> {
    return this.products.create(principal.tenantId, body, visibilityOf(principal));
  }

  @Patch('products/:id')
  @RequirePermissions('products.manage')
  @ApiZodBody(updateProductRequestSchema)
  @ApiZodResponse(200, productSchema)
  updateProduct(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param('id', uuidParam) id: string,
    @ZodBody(updateProductRequestSchema) body: z.output<typeof updateProductRequestSchema>,
  ): Promise<Product> {
    return this.products.update(principal.tenantId, id, body, visibilityOf(principal));
  }

  /* Product images */

  /** Multipart upload with one `file` field (JPEG, PNG or WebP). */
  @Post('products/:id/images')
  @RequirePermissions('products.manage')
  @UseInterceptors(FileInterceptor('file'))
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file'],
      properties: { file: { type: 'string', format: 'binary' } },
    },
  })
  @ApiZodResponse(201, productSchema, 'The product with its images.')
  @ApiZodResponse(409, errorResponseSchema, 'IMAGE_LIMIT_REACHED')
  @ApiZodResponse(503, errorResponseSchema, 'STORAGE_UNAVAILABLE')
  addImage(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param('id', uuidParam) id: string,
    @UploadedFile() file: { buffer: Buffer } | undefined,
  ): Promise<Product> {
    return this.images.add(principal.tenantId, id, file?.buffer, visibilityOf(principal));
  }

  @Put('products/:id/images/order')
  @RequirePermissions('products.manage')
  @ApiZodBody(reorderProductImagesRequestSchema)
  @ApiZodResponse(200, productSchema)
  reorderImages(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param('id', uuidParam) id: string,
    @ZodBody(reorderProductImagesRequestSchema)
    body: z.output<typeof reorderProductImagesRequestSchema>,
  ): Promise<Product> {
    return this.images.reorder(principal.tenantId, id, body.imageIds, visibilityOf(principal));
  }

  @Delete('products/:id/images/:imageId')
  @RequirePermissions('products.manage')
  @ApiZodResponse(200, productSchema)
  removeImage(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param('id', uuidParam) id: string,
    @Param('imageId', uuidParam) imageId: string,
  ): Promise<Product> {
    return this.images.remove(principal.tenantId, id, imageId, visibilityOf(principal));
  }

  @Post('variants')
  @RequirePermissions('products.manage')
  @ApiZodBody(createVariantRequestSchema)
  @ApiZodResponse(201, productSchema, 'The product with the new variant.')
  createVariant(
    @CurrentPrincipal() principal: AuthPrincipal,
    @ZodBody(createVariantRequestSchema) body: z.output<typeof createVariantRequestSchema>,
  ): Promise<Product> {
    return this.products.createVariant(principal.tenantId, body, visibilityOf(principal));
  }

  @Patch('variants/:id')
  @RequirePermissions('products.manage')
  @ApiZodBody(updateVariantRequestSchema)
  @ApiZodResponse(200, productSchema, 'The product with the updated variant.')
  updateVariant(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param('id', uuidParam) id: string,
    @ZodBody(updateVariantRequestSchema) body: z.output<typeof updateVariantRequestSchema>,
  ): Promise<Product> {
    return this.products.updateVariant(principal.tenantId, id, body, visibilityOf(principal));
  }
}
