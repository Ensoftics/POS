import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Res,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import {
  approvalPinStatusSchema,
  type ApproverList,
  approverListSchema,
  createCashMovementRequestSchema,
  createReturnRequestSchema,
  errorResponseSchema,
  listReturnsQuerySchema,
  type Sale,
  type SaleReturn,
  type SaleReturnPage,
  saleReturnPageSchema,
  saleReturnSchema,
  saleSchema,
  setApprovalPinRequestSchema,
  type Shift,
  shiftSchema,
  voidSaleRequestSchema,
} from '@pos/contracts';
import type { Response } from 'express';
import type { z } from 'zod';
import { CurrentPrincipal, RequirePermissions, SensitiveRateLimit } from '../auth/auth.decorators';
import { AppException } from '../common/app-exception';
import type { AuthPrincipal } from '../common/request-context';
import { ApiZodBody, ApiZodQuery, ApiZodResponse, ZodBody, ZodQuery } from '../common/zod';
import { ApprovalsService } from './approvals.service';
import { ReturnsService } from './returns.service';
import { SalesService } from './sales.service';
import { ShiftsService } from './shifts.service';

const uuidParam = new ParseUUIDPipe({ exceptionFactory: () => AppException.notFound() });

@ApiTags('Returns & approvals')
@ApiBearerAuth()
@Controller()
export class ReturnsController {
  constructor(
    private readonly approvals: ApprovalsService,
    private readonly returns: ReturnsService,
    private readonly sales: SalesService,
    private readonly shifts: ShiftsService,
  ) {}

  /* Approvals ------------------------------------------------------------- */

  @Get('approvers')
  @RequirePermissions('sales.create')
  @ApiZodResponse(200, approverListSchema, 'Managers who can approve at the till.')
  listApprovers(@CurrentPrincipal() p: AuthPrincipal): Promise<ApproverList> {
    return this.approvals.approvers(p.tenantId);
  }

  @Get('me/approval-pin')
  @RequirePermissions('approvals.grant')
  @ApiZodResponse(200, approvalPinStatusSchema)
  pinStatus(@CurrentPrincipal() p: AuthPrincipal): Promise<{ hasPin: boolean }> {
    return this.approvals.pinStatus(p);
  }

  @Put('me/approval-pin')
  @HttpCode(HttpStatus.NO_CONTENT)
  @SensitiveRateLimit()
  @RequirePermissions('approvals.grant')
  @ApiZodBody(setApprovalPinRequestSchema)
  async setPin(
    @CurrentPrincipal() p: AuthPrincipal,
    @ZodBody(setApprovalPinRequestSchema) body: z.output<typeof setApprovalPinRequestSchema>,
  ): Promise<void> {
    await this.approvals.setPin(p, body.currentPassword, body.pin);
  }

  /* Returns and voids ---------------------------------------------------- */

  @Get('sales/by-number/:number')
  @RequirePermissions('sales.refund')
  @ApiZodResponse(200, saleSchema, 'Any sale of the business, to start a return.')
  lookupSale(@CurrentPrincipal() p: AuthPrincipal, @Param('number') number: string): Promise<Sale> {
    if (number.length > 20) throw AppException.notFound();
    return this.sales.lookup(p.tenantId, number);
  }

  @Post('sales/:id/returns')
  @SensitiveRateLimit()
  @RequirePermissions('sales.refund')
  @ApiZodBody(createReturnRequestSchema)
  @ApiZodResponse(201, saleReturnSchema, 'Return recorded; 200 when already recorded.')
  @ApiZodResponse(
    403,
    errorResponseSchema,
    'APPROVAL_REQUIRED, APPROVAL_INVALID or APPROVAL_LOCKED',
  )
  async createReturn(
    @CurrentPrincipal() p: AuthPrincipal,
    @Param('id', uuidParam) saleId: string,
    @ZodBody(createReturnRequestSchema) body: z.output<typeof createReturnRequestSchema>,
    @Res({ passthrough: true }) res: Response,
  ): Promise<SaleReturn> {
    const [result, created] = await this.returns.createReturn(p.tenantId, saleId, body, p);
    res.status(created ? HttpStatus.CREATED : HttpStatus.OK);
    return result;
  }

  @Post('sales/:id/void')
  @SensitiveRateLimit()
  @RequirePermissions('sales.refund')
  @ApiZodBody(voidSaleRequestSchema)
  @ApiZodResponse(201, saleReturnSchema, 'Sale voided; 200 when already voided by this request.')
  async voidSale(
    @CurrentPrincipal() p: AuthPrincipal,
    @Param('id', uuidParam) saleId: string,
    @ZodBody(voidSaleRequestSchema) body: z.output<typeof voidSaleRequestSchema>,
    @Res({ passthrough: true }) res: Response,
  ): Promise<SaleReturn> {
    const [result, created] = await this.returns.voidSale(p.tenantId, saleId, body, p);
    res.status(created ? HttpStatus.CREATED : HttpStatus.OK);
    return result;
  }

  @Get('returns')
  @RequirePermissions('sales.read')
  @ApiZodQuery(listReturnsQuerySchema)
  @ApiZodResponse(200, saleReturnPageSchema)
  listReturns(
    @CurrentPrincipal() p: AuthPrincipal,
    @ZodQuery(listReturnsQuerySchema) query: z.output<typeof listReturnsQuerySchema>,
  ): Promise<SaleReturnPage> {
    return this.returns.list(p.tenantId, query, p);
  }

  @Get('returns/:id')
  @RequirePermissions('sales.read')
  @ApiZodResponse(200, saleReturnSchema)
  getReturn(
    @CurrentPrincipal() p: AuthPrincipal,
    @Param('id', uuidParam) id: string,
  ): Promise<SaleReturn> {
    return this.returns.get(p.tenantId, id, p);
  }

  /* Cash movements --------------------------------------------------------- */

  @Post('shifts/:id/cash-movements')
  @HttpCode(HttpStatus.OK)
  @SensitiveRateLimit()
  @RequirePermissions('cash.manage')
  @ApiZodBody(createCashMovementRequestSchema)
  @ApiZodResponse(200, shiftSchema, 'The shift with its updated cash movements.')
  async cashMovement(
    @CurrentPrincipal() p: AuthPrincipal,
    @Param('id', uuidParam) shiftId: string,
    @ZodBody(createCashMovementRequestSchema)
    body: z.output<typeof createCashMovementRequestSchema>,
  ): Promise<Shift> {
    const approverId = await this.approvals.verify(p.tenantId, body.approval);
    return this.shifts.cashMovement(p.tenantId, shiftId, body, p, approverId);
  }
}
