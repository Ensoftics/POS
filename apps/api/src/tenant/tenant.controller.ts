import { Controller, Get, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import {
  completeOnboardingRequestSchema,
  type TenantSummary,
  tenantSummarySchema,
} from '@pos/contracts';
import type { z } from 'zod';
import { CurrentPrincipal, RequirePermissions } from '../auth/auth.decorators';
import type { AuthPrincipal } from '../common/request-context';
import { ApiZodBody, ApiZodResponse, ZodBody } from '../common/zod';
import { TenantService } from './tenant.service';

/** The tenant is always taken from the verified session, never from the URL or body. */
@ApiTags('Tenant')
@ApiBearerAuth()
@Controller('tenant')
export class TenantController {
  constructor(private readonly tenants: TenantService) {}

  @Get()
  @RequirePermissions('tenant.read')
  @ApiZodResponse(200, tenantSummarySchema)
  current(@CurrentPrincipal() principal: AuthPrincipal): Promise<TenantSummary> {
    return this.tenants.getCurrent(principal.tenantId);
  }

  @Post('onboarding')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('tenant.onboarding.complete')
  @ApiZodBody(completeOnboardingRequestSchema)
  @ApiZodResponse(200, tenantSummarySchema)
  completeOnboarding(
    @CurrentPrincipal() principal: AuthPrincipal,
    @ZodBody(completeOnboardingRequestSchema)
    body: z.output<typeof completeOnboardingRequestSchema>,
  ): Promise<TenantSummary> {
    return this.tenants.completeOnboarding(principal.tenantId, body);
  }
}
