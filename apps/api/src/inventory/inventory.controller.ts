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
  createStockAdjustmentRequestSchema,
  createStockCountRequestSchema,
  createStockTransferRequestSchema,
  errorResponseSchema,
  listDocumentsQuerySchema,
  listMovementsQuerySchema,
  listStockQuerySchema,
  type StockAdjustment,
  type StockAdjustmentPage,
  stockAdjustmentPageSchema,
  stockAdjustmentSchema,
  type StockCount,
  type StockCountPage,
  stockCountPageSchema,
  stockCountSchema,
  type StockMovementPage,
  stockMovementPageSchema,
  type StockPage,
  stockPageSchema,
  type StockTransfer,
  type StockTransferPage,
  stockTransferPageSchema,
  stockTransferSchema,
  updateStockCountRequestSchema,
  versionOnlyRequestSchema,
} from '@pos/contracts';
import type { Response } from 'express';
import type { z } from 'zod';
import { CurrentPrincipal, RequirePermissions } from '../auth/auth.decorators';
import { AppException } from '../common/app-exception';
import type { AuthPrincipal } from '../common/request-context';
import { ApiZodBody, ApiZodQuery, ApiZodResponse, ZodBody, ZodQuery } from '../common/zod';
import { AdjustmentsService } from './adjustments.service';
import { CountsService } from './counts.service';
import { StockService } from './stock.service';
import { TransfersService } from './transfers.service';

const uuidParam = new ParseUUIDPipe({ exceptionFactory: () => AppException.notFound() });

@ApiTags('Inventory')
@ApiBearerAuth()
@Controller()
export class InventoryController {
  constructor(
    private readonly stock: StockService,
    private readonly adjustments: AdjustmentsService,
    private readonly transfers: TransfersService,
    private readonly counts: CountsService,
  ) {}

  @Get('stock')
  @RequirePermissions('inventory.read')
  @ApiZodQuery(listStockQuerySchema)
  @ApiZodResponse(200, stockPageSchema)
  listStock(
    @CurrentPrincipal() p: AuthPrincipal,
    @ZodQuery(listStockQuerySchema) query: z.output<typeof listStockQuerySchema>,
  ): Promise<StockPage> {
    return this.stock.list(p.tenantId, query);
  }

  @Get('stock/movements')
  @RequirePermissions('inventory.read')
  @ApiZodQuery(listMovementsQuerySchema)
  @ApiZodResponse(200, stockMovementPageSchema)
  listMovements(
    @CurrentPrincipal() p: AuthPrincipal,
    @ZodQuery(listMovementsQuerySchema) query: z.output<typeof listMovementsQuerySchema>,
  ): Promise<StockMovementPage> {
    return this.stock.movements(p.tenantId, query);
  }

  @Get('stock-adjustments')
  @RequirePermissions('inventory.read')
  @ApiZodQuery(listDocumentsQuerySchema)
  @ApiZodResponse(200, stockAdjustmentPageSchema)
  listAdjustments(
    @CurrentPrincipal() p: AuthPrincipal,
    @ZodQuery(listDocumentsQuerySchema) query: z.output<typeof listDocumentsQuerySchema>,
  ): Promise<StockAdjustmentPage> {
    return this.adjustments.list(p.tenantId, query);
  }

  @Post('stock-adjustments')
  @RequirePermissions('inventory.manage')
  @ApiZodBody(createStockAdjustmentRequestSchema)
  @ApiZodResponse(201, stockAdjustmentSchema)
  @ApiZodResponse(409, errorResponseSchema, 'INSUFFICIENT_STOCK')
  async createAdjustment(
    @CurrentPrincipal() p: AuthPrincipal,
    @ZodBody(createStockAdjustmentRequestSchema)
    body: z.output<typeof createStockAdjustmentRequestSchema>,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StockAdjustment> {
    const [adjustment, created] = await this.adjustments.create(p.tenantId, body);
    res.status(created ? HttpStatus.CREATED : HttpStatus.OK);
    return adjustment;
  }

  @Get('stock-transfers')
  @RequirePermissions('inventory.read')
  @ApiZodQuery(listDocumentsQuerySchema)
  @ApiZodResponse(200, stockTransferPageSchema)
  listTransfers(
    @CurrentPrincipal() p: AuthPrincipal,
    @ZodQuery(listDocumentsQuerySchema) query: z.output<typeof listDocumentsQuerySchema>,
  ): Promise<StockTransferPage> {
    return this.transfers.list(p.tenantId, query);
  }

  @Get('stock-transfers/:id')
  @RequirePermissions('inventory.read')
  @ApiZodResponse(200, stockTransferSchema)
  getTransfer(
    @CurrentPrincipal() p: AuthPrincipal,
    @Param('id', uuidParam) id: string,
  ): Promise<StockTransfer> {
    return this.transfers.get(p.tenantId, id);
  }

  @Post('stock-transfers')
  @RequirePermissions('inventory.manage')
  @ApiZodBody(createStockTransferRequestSchema)
  @ApiZodResponse(201, stockTransferSchema, 'Stock has left the source branch.')
  @ApiZodResponse(409, errorResponseSchema, 'INSUFFICIENT_STOCK')
  async createTransfer(
    @CurrentPrincipal() p: AuthPrincipal,
    @ZodBody(createStockTransferRequestSchema)
    body: z.output<typeof createStockTransferRequestSchema>,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StockTransfer> {
    const [transfer, created] = await this.transfers.create(p.tenantId, body);
    res.status(created ? HttpStatus.CREATED : HttpStatus.OK);
    return transfer;
  }

  @Post('stock-transfers/:id/receive')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('inventory.manage')
  @ApiZodBody(versionOnlyRequestSchema)
  @ApiZodResponse(200, stockTransferSchema)
  receiveTransfer(
    @CurrentPrincipal() p: AuthPrincipal,
    @Param('id', uuidParam) id: string,
    @ZodBody(versionOnlyRequestSchema) body: z.output<typeof versionOnlyRequestSchema>,
  ): Promise<StockTransfer> {
    return this.transfers.receive(p.tenantId, id, body.version);
  }

  @Post('stock-transfers/:id/cancel')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('inventory.manage')
  @ApiZodBody(versionOnlyRequestSchema)
  @ApiZodResponse(200, stockTransferSchema, 'Stock returned to the source branch.')
  cancelTransfer(
    @CurrentPrincipal() p: AuthPrincipal,
    @Param('id', uuidParam) id: string,
    @ZodBody(versionOnlyRequestSchema) body: z.output<typeof versionOnlyRequestSchema>,
  ): Promise<StockTransfer> {
    return this.transfers.cancel(p.tenantId, id, body.version);
  }

  @Get('stock-counts')
  @RequirePermissions('inventory.read')
  @ApiZodQuery(listDocumentsQuerySchema)
  @ApiZodResponse(200, stockCountPageSchema)
  listCounts(
    @CurrentPrincipal() p: AuthPrincipal,
    @ZodQuery(listDocumentsQuerySchema) query: z.output<typeof listDocumentsQuerySchema>,
  ): Promise<StockCountPage> {
    return this.counts.list(p.tenantId, query);
  }

  @Get('stock-counts/:id')
  @RequirePermissions('inventory.read')
  @ApiZodResponse(200, stockCountSchema)
  getCount(
    @CurrentPrincipal() p: AuthPrincipal,
    @Param('id', uuidParam) id: string,
  ): Promise<StockCount> {
    return this.counts.get(p.tenantId, id);
  }

  @Post('stock-counts')
  @RequirePermissions('inventory.manage')
  @ApiZodBody(createStockCountRequestSchema)
  @ApiZodResponse(201, stockCountSchema)
  startCount(
    @CurrentPrincipal() p: AuthPrincipal,
    @ZodBody(createStockCountRequestSchema) body: z.output<typeof createStockCountRequestSchema>,
  ): Promise<StockCount> {
    return this.counts.start(p.tenantId, body);
  }

  @Patch('stock-counts/:id')
  @RequirePermissions('inventory.manage')
  @ApiZodBody(updateStockCountRequestSchema)
  @ApiZodResponse(200, stockCountSchema)
  updateCount(
    @CurrentPrincipal() p: AuthPrincipal,
    @Param('id', uuidParam) id: string,
    @ZodBody(updateStockCountRequestSchema) body: z.output<typeof updateStockCountRequestSchema>,
  ): Promise<StockCount> {
    return this.counts.updateLines(p.tenantId, id, body);
  }

  @Post('stock-counts/:id/complete')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('inventory.manage')
  @ApiZodBody(versionOnlyRequestSchema)
  @ApiZodResponse(200, stockCountSchema, 'Differences posted as corrections.')
  completeCount(
    @CurrentPrincipal() p: AuthPrincipal,
    @Param('id', uuidParam) id: string,
    @ZodBody(versionOnlyRequestSchema) body: z.output<typeof versionOnlyRequestSchema>,
  ): Promise<StockCount> {
    return this.counts.complete(p.tenantId, id, body.version);
  }

  @Post('stock-counts/:id/cancel')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('inventory.manage')
  @ApiZodBody(versionOnlyRequestSchema)
  @ApiZodResponse(200, stockCountSchema)
  cancelCount(
    @CurrentPrincipal() p: AuthPrincipal,
    @Param('id', uuidParam) id: string,
    @ZodBody(versionOnlyRequestSchema) body: z.output<typeof versionOnlyRequestSchema>,
  ): Promise<StockCount> {
    return this.counts.cancel(p.tenantId, id, body.version);
  }
}
