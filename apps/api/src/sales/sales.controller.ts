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
  closeShiftRequestSchema,
  createSaleRequestSchema,
  createTaxRateRequestSchema,
  type CurrentShiftResponse,
  currentShiftQuerySchema,
  currentShiftResponseSchema,
  errorResponseSchema,
  listSalesQuerySchema,
  listShiftsQuerySchema,
  openShiftRequestSchema,
  type Receipt,
  receiptSchema,
  type Sale,
  type SalePage,
  salePageSchema,
  saleSchema,
  type Shift,
  type ShiftPage,
  shiftPageSchema,
  shiftSchema,
  type TaxRate,
  type TaxRateList,
  taxRateListSchema,
  taxRateSchema,
  updateTaxRateRequestSchema,
} from '@pos/contracts';
import type { Response } from 'express';
import type { z } from 'zod';
import { CurrentPrincipal, RequirePermissions } from '../auth/auth.decorators';
import { AppException } from '../common/app-exception';
import type { AuthPrincipal } from '../common/request-context';
import { ApiZodBody, ApiZodQuery, ApiZodResponse, ZodBody, ZodQuery } from '../common/zod';
import { SalesService } from './sales.service';
import { ShiftsService } from './shifts.service';
import { TaxRatesService } from './tax-rates.service';

const uuidParam = new ParseUUIDPipe({ exceptionFactory: () => AppException.notFound() });

@ApiTags('Checkout')
@ApiBearerAuth()
@Controller()
export class SalesController {
  constructor(
    private readonly taxRates: TaxRatesService,
    private readonly shifts: ShiftsService,
    private readonly sales: SalesService,
  ) {}

  /* Tax rates ------------------------------------------------------------- */

  @Get('tax-rates')
  @RequirePermissions('settings.read')
  @ApiZodResponse(200, taxRateListSchema)
  listTaxRates(@CurrentPrincipal() p: AuthPrincipal): Promise<TaxRateList> {
    return this.taxRates.list(p.tenantId);
  }

  @Post('tax-rates')
  @RequirePermissions('settings.update')
  @ApiZodBody(createTaxRateRequestSchema)
  @ApiZodResponse(201, taxRateSchema)
  createTaxRate(
    @CurrentPrincipal() p: AuthPrincipal,
    @ZodBody(createTaxRateRequestSchema) body: z.output<typeof createTaxRateRequestSchema>,
  ): Promise<TaxRate> {
    return this.taxRates.create(p.tenantId, body);
  }

  @Patch('tax-rates/:id')
  @RequirePermissions('settings.update')
  @ApiZodBody(updateTaxRateRequestSchema)
  @ApiZodResponse(200, taxRateSchema)
  @ApiZodResponse(409, errorResponseSchema, 'VERSION_CONFLICT or TAX_RATE_IN_USE')
  updateTaxRate(
    @CurrentPrincipal() p: AuthPrincipal,
    @Param('id', uuidParam) id: string,
    @ZodBody(updateTaxRateRequestSchema) body: z.output<typeof updateTaxRateRequestSchema>,
  ): Promise<TaxRate> {
    return this.taxRates.update(p.tenantId, id, body);
  }

  /* Shifts ---------------------------------------------------------------- */

  @Get('shifts/current')
  @RequirePermissions('sales.create')
  @ApiZodQuery(currentShiftQuerySchema)
  @ApiZodResponse(200, currentShiftResponseSchema, 'The open shift on the register, if any.')
  async currentShift(
    @CurrentPrincipal() p: AuthPrincipal,
    @ZodQuery(currentShiftQuerySchema) query: z.output<typeof currentShiftQuerySchema>,
  ): Promise<CurrentShiftResponse> {
    return { shift: await this.shifts.current(p.tenantId, query.registerId) };
  }

  @Get('shifts')
  @RequirePermissions('shifts.manage')
  @ApiZodQuery(listShiftsQuerySchema)
  @ApiZodResponse(200, shiftPageSchema)
  listShifts(
    @CurrentPrincipal() p: AuthPrincipal,
    @ZodQuery(listShiftsQuerySchema) query: z.output<typeof listShiftsQuerySchema>,
  ): Promise<ShiftPage> {
    return this.shifts.list(p.tenantId, query);
  }

  @Get('shifts/:id')
  @RequirePermissions('sales.create')
  @ApiZodResponse(200, shiftSchema)
  getShift(
    @CurrentPrincipal() p: AuthPrincipal,
    @Param('id', uuidParam) id: string,
  ): Promise<Shift> {
    return this.shifts.get(p.tenantId, id, p);
  }

  @Post('shifts')
  @RequirePermissions('sales.create')
  @ApiZodBody(openShiftRequestSchema)
  @ApiZodResponse(201, shiftSchema)
  @ApiZodResponse(409, errorResponseSchema, 'SHIFT_ALREADY_OPEN')
  openShift(
    @CurrentPrincipal() p: AuthPrincipal,
    @ZodBody(openShiftRequestSchema) body: z.output<typeof openShiftRequestSchema>,
  ): Promise<Shift> {
    return this.shifts.open(p.tenantId, body, p);
  }

  @Post('shifts/:id/close')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('sales.create')
  @ApiZodBody(closeShiftRequestSchema)
  @ApiZodResponse(200, shiftSchema, 'Closed with expected and counted cash.')
  closeShift(
    @CurrentPrincipal() p: AuthPrincipal,
    @Param('id', uuidParam) id: string,
    @ZodBody(closeShiftRequestSchema) body: z.output<typeof closeShiftRequestSchema>,
  ): Promise<Shift> {
    return this.shifts.close(p.tenantId, id, body, p);
  }

  /* Sales ----------------------------------------------------------------- */

  @Post('sales')
  @RequirePermissions('sales.create')
  @ApiZodBody(createSaleRequestSchema)
  @ApiZodResponse(201, saleSchema, 'Sale completed; 200 when the same sale was already recorded.')
  @ApiZodResponse(
    409,
    errorResponseSchema,
    'INSUFFICIENT_STOCK, SHIFT_NOT_OPEN, TOTAL_MISMATCH or IDEMPOTENCY_CONFLICT',
  )
  async createSale(
    @CurrentPrincipal() p: AuthPrincipal,
    @ZodBody(createSaleRequestSchema) body: z.output<typeof createSaleRequestSchema>,
    @Res({ passthrough: true }) res: Response,
  ): Promise<Sale> {
    const [sale, created] = await this.sales.create(p.tenantId, body, p);
    res.status(created ? HttpStatus.CREATED : HttpStatus.OK);
    return sale;
  }

  @Get('sales')
  @RequirePermissions('sales.read')
  @ApiZodQuery(listSalesQuerySchema)
  @ApiZodResponse(200, salePageSchema)
  listSales(
    @CurrentPrincipal() p: AuthPrincipal,
    @ZodQuery(listSalesQuerySchema) query: z.output<typeof listSalesQuerySchema>,
  ): Promise<SalePage> {
    return this.sales.list(p.tenantId, query, p);
  }

  @Get('sales/:id')
  @RequirePermissions('sales.read')
  @ApiZodResponse(200, saleSchema)
  getSale(@CurrentPrincipal() p: AuthPrincipal, @Param('id', uuidParam) id: string): Promise<Sale> {
    return this.sales.get(p.tenantId, id, p);
  }

  @Get('sales/:id/receipt')
  @RequirePermissions('sales.read')
  @ApiZodResponse(200, receiptSchema, 'Sale with the business identity for printing.')
  getReceipt(
    @CurrentPrincipal() p: AuthPrincipal,
    @Param('id', uuidParam) id: string,
  ): Promise<Receipt> {
    return this.sales.receipt(p.tenantId, id, p);
  }
}
