import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Res,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import {
  createGoodsReceiptRequestSchema,
  createPurchaseOrderRequestSchema,
  createSupplierRequestSchema,
  errorResponseSchema,
  type GoodsReceipt,
  type GoodsReceiptPage,
  goodsReceiptPageSchema,
  goodsReceiptSchema,
  listDocumentsQuerySchema,
  listPurchaseOrdersQuerySchema,
  listSuppliersQuerySchema,
  type PurchaseOrder,
  type PurchaseOrderPage,
  purchaseOrderPageSchema,
  purchaseOrderSchema,
  type Supplier,
  type SupplierPage,
  supplierPageSchema,
  supplierSchema,
  updatePurchaseOrderRequestSchema,
  updateSupplierRequestSchema,
  versionOnlyRequestSchema,
} from '@pos/contracts';
import type { Response } from 'express';
import type { z } from 'zod';
import { CurrentPrincipal, RequirePermissions } from '../auth/auth.decorators';
import { AppException } from '../common/app-exception';
import type { AuthPrincipal } from '../common/request-context';
import { ApiZodBody, ApiZodQuery, ApiZodResponse, ZodBody, ZodQuery } from '../common/zod';
import { PurchaseOrdersService } from './purchase-orders.service';
import { ReceiptsService } from './receipts.service';
import { SuppliersService } from './suppliers.service';

const uuidParam = new ParseUUIDPipe({ exceptionFactory: () => AppException.notFound() });

@ApiTags('Purchasing')
@ApiBearerAuth()
@Controller()
@RequirePermissions('purchasing.manage')
export class PurchasingController {
  constructor(
    private readonly suppliers: SuppliersService,
    private readonly orders: PurchaseOrdersService,
    private readonly receipts: ReceiptsService,
  ) {}

  @Get('suppliers')
  @ApiZodQuery(listSuppliersQuerySchema)
  @ApiZodResponse(200, supplierPageSchema)
  listSuppliers(
    @CurrentPrincipal() p: AuthPrincipal,
    @ZodQuery(listSuppliersQuerySchema) query: z.output<typeof listSuppliersQuerySchema>,
  ): Promise<SupplierPage> {
    return this.suppliers.list(p.tenantId, query);
  }

  @Post('suppliers')
  @ApiZodBody(createSupplierRequestSchema)
  @ApiZodResponse(201, supplierSchema)
  @ApiZodResponse(409, errorResponseSchema, 'DUPLICATE_NAME')
  createSupplier(
    @CurrentPrincipal() p: AuthPrincipal,
    @ZodBody(createSupplierRequestSchema) body: z.output<typeof createSupplierRequestSchema>,
  ): Promise<Supplier> {
    return this.suppliers.create(p.tenantId, body);
  }

  @Patch('suppliers/:id')
  @ApiZodBody(updateSupplierRequestSchema)
  @ApiZodResponse(200, supplierSchema)
  updateSupplier(
    @CurrentPrincipal() p: AuthPrincipal,
    @Param('id', uuidParam) id: string,
    @ZodBody(updateSupplierRequestSchema) body: z.output<typeof updateSupplierRequestSchema>,
  ): Promise<Supplier> {
    return this.suppliers.update(p.tenantId, id, body);
  }

  @Get('purchase-orders')
  @ApiZodQuery(listPurchaseOrdersQuerySchema)
  @ApiZodResponse(200, purchaseOrderPageSchema)
  listOrders(
    @CurrentPrincipal() p: AuthPrincipal,
    @ZodQuery(listPurchaseOrdersQuerySchema) query: z.output<typeof listPurchaseOrdersQuerySchema>,
  ): Promise<PurchaseOrderPage> {
    return this.orders.list(p.tenantId, query);
  }

  @Get('purchase-orders/:id')
  @ApiZodResponse(200, purchaseOrderSchema)
  getOrder(
    @CurrentPrincipal() p: AuthPrincipal,
    @Param('id', uuidParam) id: string,
  ): Promise<PurchaseOrder> {
    return this.orders.get(p.tenantId, id);
  }

  @Post('purchase-orders')
  @ApiZodBody(createPurchaseOrderRequestSchema)
  @ApiZodResponse(201, purchaseOrderSchema, 'A draft purchase order.')
  createOrder(
    @CurrentPrincipal() p: AuthPrincipal,
    @ZodBody(createPurchaseOrderRequestSchema)
    body: z.output<typeof createPurchaseOrderRequestSchema>,
  ): Promise<PurchaseOrder> {
    return this.orders.create(p.tenantId, body);
  }

  @Patch('purchase-orders/:id')
  @ApiZodBody(updatePurchaseOrderRequestSchema)
  @ApiZodResponse(200, purchaseOrderSchema)
  @ApiZodResponse(409, errorResponseSchema, 'VERSION_CONFLICT or INVALID_STATE (not a draft)')
  updateOrder(
    @CurrentPrincipal() p: AuthPrincipal,
    @Param('id', uuidParam) id: string,
    @ZodBody(updatePurchaseOrderRequestSchema)
    body: z.output<typeof updatePurchaseOrderRequestSchema>,
  ): Promise<PurchaseOrder> {
    return this.orders.update(p.tenantId, id, body);
  }

  @Post('purchase-orders/:id/order')
  @HttpCode(HttpStatus.OK)
  @ApiZodBody(versionOnlyRequestSchema)
  @ApiZodResponse(200, purchaseOrderSchema, 'Marked as sent to the supplier.')
  placeOrder(
    @CurrentPrincipal() p: AuthPrincipal,
    @Param('id', uuidParam) id: string,
    @ZodBody(versionOnlyRequestSchema) body: z.output<typeof versionOnlyRequestSchema>,
  ): Promise<PurchaseOrder> {
    return this.orders.placeOrder(p.tenantId, id, body.version);
  }

  @Post('purchase-orders/:id/cancel')
  @HttpCode(HttpStatus.OK)
  @ApiZodBody(versionOnlyRequestSchema)
  @ApiZodResponse(200, purchaseOrderSchema)
  cancelOrder(
    @CurrentPrincipal() p: AuthPrincipal,
    @Param('id', uuidParam) id: string,
    @ZodBody(versionOnlyRequestSchema) body: z.output<typeof versionOnlyRequestSchema>,
  ): Promise<PurchaseOrder> {
    return this.orders.cancel(p.tenantId, id, body.version);
  }

  @Get('goods-receipts')
  @ApiZodQuery(listDocumentsQuerySchema)
  @ApiZodResponse(200, goodsReceiptPageSchema)
  listReceipts(
    @CurrentPrincipal() p: AuthPrincipal,
    @ZodQuery(listDocumentsQuerySchema) query: z.output<typeof listDocumentsQuerySchema>,
  ): Promise<GoodsReceiptPage> {
    return this.receipts.list(p.tenantId, query);
  }

  @Get('goods-receipts/:id')
  @ApiZodResponse(200, goodsReceiptSchema)
  getReceipt(
    @CurrentPrincipal() p: AuthPrincipal,
    @Param('id', uuidParam) id: string,
  ): Promise<GoodsReceipt> {
    return this.receipts.get(p.tenantId, id);
  }

  /** Idempotent: 201 when posted, 200 with the original receipt when the id was already used. */
  @Post('goods-receipts')
  @ApiZodBody(createGoodsReceiptRequestSchema)
  @ApiZodResponse(201, goodsReceiptSchema, 'Stock received.')
  @ApiZodResponse(200, goodsReceiptSchema, 'Duplicate submission; the original receipt.')
  async createReceipt(
    @CurrentPrincipal() p: AuthPrincipal,
    @ZodBody(createGoodsReceiptRequestSchema)
    body: z.output<typeof createGoodsReceiptRequestSchema>,
    @Res({ passthrough: true }) res: Response,
  ): Promise<GoodsReceipt> {
    const [receipt, created] = await this.receipts.create(p.tenantId, body);
    res.status(created ? HttpStatus.CREATED : HttpStatus.OK);
    return receipt;
  }
}
