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
  adjustLoyaltyRequestSchema,
  type LoyaltyHistory,
  loyaltyHistorySchema,
  paginationQuerySchema,
  createCustomerPaymentRequestSchema,
  createCustomerRequestSchema,
  type Customer,
  type CustomerPage,
  customerPageSchema,
  type CustomerPayment,
  customerPaymentSchema,
  customerSchema,
  errorResponseSchema,
  listCustomersQuerySchema,
  type Statement,
  statementQuerySchema,
  statementSchema,
  updateCustomerRequestSchema,
} from '@pos/contracts';
import type { Response } from 'express';
import type { z } from 'zod';
import { CurrentPrincipal, RequirePermissions } from '../auth/auth.decorators';
import { AppException } from '../common/app-exception';
import type { AuthPrincipal } from '../common/request-context';
import { ApiZodBody, ApiZodQuery, ApiZodResponse, ZodBody, ZodQuery } from '../common/zod';
import { CustomersService } from './customers.service';

const uuidParam = new ParseUUIDPipe({ exceptionFactory: () => AppException.notFound() });

@ApiTags('Customers')
@ApiBearerAuth()
@Controller('customers')
export class CustomersController {
  constructor(private readonly customers: CustomersService) {}

  @Get()
  @RequirePermissions('customers.read')
  @ApiZodQuery(listCustomersQuerySchema)
  @ApiZodResponse(200, customerPageSchema)
  list(
    @CurrentPrincipal() p: AuthPrincipal,
    @ZodQuery(listCustomersQuerySchema) query: z.output<typeof listCustomersQuerySchema>,
  ): Promise<CustomerPage> {
    return this.customers.list(p.tenantId, query);
  }

  @Post()
  @RequirePermissions('customers.manage')
  @ApiZodBody(createCustomerRequestSchema)
  @ApiZodResponse(201, customerSchema)
  @ApiZodResponse(409, errorResponseSchema, 'DUPLICATE_PHONE')
  create(
    @CurrentPrincipal() p: AuthPrincipal,
    @ZodBody(createCustomerRequestSchema) body: z.output<typeof createCustomerRequestSchema>,
  ): Promise<Customer> {
    return this.customers.create(p.tenantId, body, p);
  }

  @Get(':id')
  @RequirePermissions('customers.read')
  @ApiZodResponse(200, customerSchema)
  get(@CurrentPrincipal() p: AuthPrincipal, @Param('id', uuidParam) id: string): Promise<Customer> {
    return this.customers.get(p.tenantId, id);
  }

  @Patch(':id')
  @RequirePermissions('customers.manage')
  @ApiZodBody(updateCustomerRequestSchema)
  @ApiZodResponse(200, customerSchema, 'Credit limit changes need customers.credit.')
  update(
    @CurrentPrincipal() p: AuthPrincipal,
    @Param('id', uuidParam) id: string,
    @ZodBody(updateCustomerRequestSchema) body: z.output<typeof updateCustomerRequestSchema>,
  ): Promise<Customer> {
    return this.customers.update(p.tenantId, id, body, p);
  }

  @Get(':id/statement')
  @RequirePermissions('customers.read')
  @ApiZodQuery(statementQuerySchema)
  @ApiZodResponse(200, statementSchema)
  statement(
    @CurrentPrincipal() p: AuthPrincipal,
    @Param('id', uuidParam) id: string,
    @ZodQuery(statementQuerySchema) query: z.output<typeof statementQuerySchema>,
  ): Promise<Statement> {
    return this.customers.statement(p.tenantId, id, query.from, query.to);
  }

  @Get(':id/loyalty')
  @RequirePermissions('customers.read')
  @ApiZodQuery(paginationQuerySchema)
  @ApiZodResponse(200, loyaltyHistorySchema)
  loyalty(
    @CurrentPrincipal() p: AuthPrincipal,
    @Param('id', uuidParam) id: string,
    @ZodQuery(paginationQuerySchema) query: z.output<typeof paginationQuerySchema>,
  ): Promise<LoyaltyHistory> {
    return this.customers.loyaltyHistory(p.tenantId, id, query);
  }

  @Post(':id/loyalty/adjust')
  @RequirePermissions('customers.credit')
  @HttpCode(HttpStatus.OK)
  @ApiZodBody(adjustLoyaltyRequestSchema)
  @ApiZodResponse(200, loyaltyHistorySchema)
  @ApiZodResponse(409, errorResponseSchema, 'INSUFFICIENT_POINTS')
  adjustLoyalty(
    @CurrentPrincipal() p: AuthPrincipal,
    @Param('id', uuidParam) id: string,
    @ZodBody(adjustLoyaltyRequestSchema) body: z.output<typeof adjustLoyaltyRequestSchema>,
  ): Promise<LoyaltyHistory> {
    return this.customers.adjustLoyalty(p.tenantId, id, body, p);
  }

  @Post(':id/payments')
  @RequirePermissions('customers.collect')
  @ApiZodBody(createCustomerPaymentRequestSchema)
  @ApiZodResponse(201, customerPaymentSchema, 'Payment recorded; 200 when already recorded.')
  async collect(
    @CurrentPrincipal() p: AuthPrincipal,
    @Param('id', uuidParam) id: string,
    @ZodBody(createCustomerPaymentRequestSchema)
    body: z.output<typeof createCustomerPaymentRequestSchema>,
    @Res({ passthrough: true }) res: Response,
  ): Promise<CustomerPayment> {
    const [payment, created] = await this.customers.collect(p.tenantId, id, body, p);
    res.status(created ? HttpStatus.CREATED : HttpStatus.OK);
    return payment;
  }
}
