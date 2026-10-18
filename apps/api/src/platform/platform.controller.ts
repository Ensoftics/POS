import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import {
  changePlanRequestSchema,
  closeTenantRequestSchema,
  createPlanRequestSchema,
  errorResponseSchema,
  extendSubscriptionRequestSchema,
  listPlatformTenantsQuerySchema,
  manualPaymentRequestSchema,
  type PlatformAuditPage,
  platformAuditPageSchema,
  platformAuditQuerySchema,
  platformLoginRequestSchema,
  type PlatformOverview,
  platformOverviewSchema,
  type PlatformPlan,
  type PlatformPlanList,
  platformPlanListSchema,
  platformPlanSchema,
  type PlatformSession,
  platformSessionSchema,
  type PlatformTenantDetail,
  platformTenantDetailSchema,
  type PlatformTenantPage,
  platformTenantPageSchema,
  type PlatformTenantSummary,
  platformTenantSummarySchema,
  type PlatformUser,
  platformUserSchema,
  tenantActionRequestSchema,
  updatePlanRequestSchema,
  type PlatformFeatureFlagList,
  platformFeatureFlagListSchema,
  setTenantFeatureRequestSchema,
  type TenantFeature,
  tenantFeatureSchema,
  updateFeatureFlagRequestSchema,
} from '@pos/contracts';
import type { z } from 'zod';
import { Public, SensitiveRateLimit } from '../auth/auth.decorators';
import { AppException } from '../common/app-exception';
import { ApiZodBody, ApiZodQuery, ApiZodResponse, ZodBody, ZodQuery } from '../common/zod';
import { PlatformAuthService, type PlatformPrincipal } from './platform-auth.service';
import { CurrentPlatformPrincipal, PlatformGuard } from './platform.guard';
import { PlatformService } from './platform.service';

const uuidParam = new ParseUUIDPipe({ exceptionFactory: () => AppException.notFound() });

/** Platform console sign-in. Public to the tenant guards; protected by password + authenticator code. */
@ApiTags('Platform')
@Controller('platform/auth')
@Public()
export class PlatformAuthController {
  constructor(private readonly auth: PlatformAuthService) {}

  @Post('login')
  @SensitiveRateLimit()
  @HttpCode(HttpStatus.OK)
  @ApiZodBody(platformLoginRequestSchema)
  @ApiZodResponse(200, platformSessionSchema)
  @ApiZodResponse(401, errorResponseSchema, 'INVALID_CREDENTIALS')
  login(
    @ZodBody(platformLoginRequestSchema) body: z.output<typeof platformLoginRequestSchema>,
  ): Promise<PlatformSession> {
    return this.auth.login(body);
  }

  @Post('logout')
  @UseGuards(PlatformGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiBearerAuth()
  logout(@CurrentPlatformPrincipal() p: PlatformPrincipal): Promise<void> {
    return this.auth.logout(p);
  }

  @Get('me')
  @UseGuards(PlatformGuard)
  @ApiBearerAuth()
  @ApiZodResponse(200, platformUserSchema)
  me(@CurrentPlatformPrincipal() p: PlatformPrincipal): Promise<PlatformUser> {
    return this.auth.me(p);
  }
}

@ApiTags('Platform')
@ApiBearerAuth()
@Controller('platform')
@Public()
@UseGuards(PlatformGuard)
export class PlatformController {
  constructor(private readonly platform: PlatformService) {}

  @Get('overview')
  @ApiZodResponse(200, platformOverviewSchema)
  overview(): Promise<PlatformOverview> {
    return this.platform.overview();
  }

  @Get('tenants')
  @ApiZodQuery(listPlatformTenantsQuerySchema)
  @ApiZodResponse(200, platformTenantPageSchema)
  tenants(
    @ZodQuery(listPlatformTenantsQuerySchema)
    query: z.output<typeof listPlatformTenantsQuerySchema>,
  ): Promise<PlatformTenantPage> {
    return this.platform.listTenants(query);
  }

  @Get('tenants/:id')
  @ApiZodResponse(200, platformTenantDetailSchema)
  tenant(
    @CurrentPlatformPrincipal() p: PlatformPrincipal,
    @Param('id', uuidParam) id: string,
  ): Promise<PlatformTenantDetail> {
    return this.platform.tenant(p, id);
  }

  @Post('tenants/:id/suspend')
  @HttpCode(HttpStatus.OK)
  @ApiZodBody(tenantActionRequestSchema)
  @ApiZodResponse(200, platformTenantSummarySchema, 'Everyone in the business is signed out.')
  suspend(
    @CurrentPlatformPrincipal() p: PlatformPrincipal,
    @Param('id', uuidParam) id: string,
    @ZodBody(tenantActionRequestSchema) body: z.output<typeof tenantActionRequestSchema>,
  ): Promise<PlatformTenantSummary> {
    return this.platform.suspend(p, id, body);
  }

  @Post('tenants/:id/reinstate')
  @HttpCode(HttpStatus.OK)
  @ApiZodBody(tenantActionRequestSchema)
  @ApiZodResponse(200, platformTenantSummarySchema)
  reinstate(
    @CurrentPlatformPrincipal() p: PlatformPrincipal,
    @Param('id', uuidParam) id: string,
    @ZodBody(tenantActionRequestSchema) body: z.output<typeof tenantActionRequestSchema>,
  ): Promise<PlatformTenantSummary> {
    return this.platform.reinstate(p, id, body);
  }

  @Post('tenants/:id/close')
  @HttpCode(HttpStatus.OK)
  @ApiZodBody(closeTenantRequestSchema)
  @ApiZodResponse(200, platformTenantSummarySchema)
  close(
    @CurrentPlatformPrincipal() p: PlatformPrincipal,
    @Param('id', uuidParam) id: string,
    @ZodBody(closeTenantRequestSchema) body: z.output<typeof closeTenantRequestSchema>,
  ): Promise<PlatformTenantSummary> {
    return this.platform.close(p, id, body);
  }

  @Post('tenants/:id/subscription/extend')
  @HttpCode(HttpStatus.OK)
  @ApiZodBody(extendSubscriptionRequestSchema)
  @ApiZodResponse(200, platformTenantSummarySchema)
  extend(
    @CurrentPlatformPrincipal() p: PlatformPrincipal,
    @Param('id', uuidParam) id: string,
    @ZodBody(extendSubscriptionRequestSchema)
    body: z.output<typeof extendSubscriptionRequestSchema>,
  ): Promise<PlatformTenantSummary> {
    return this.platform.extend(p, id, body);
  }

  @Post('tenants/:id/subscription/plan')
  @HttpCode(HttpStatus.OK)
  @ApiZodBody(changePlanRequestSchema)
  @ApiZodResponse(200, platformTenantSummarySchema)
  changePlan(
    @CurrentPlatformPrincipal() p: PlatformPrincipal,
    @Param('id', uuidParam) id: string,
    @ZodBody(changePlanRequestSchema) body: z.output<typeof changePlanRequestSchema>,
  ): Promise<PlatformTenantSummary> {
    return this.platform.changePlan(p, id, body);
  }

  @Post('tenants/:id/payments')
  @HttpCode(HttpStatus.OK)
  @ApiZodBody(manualPaymentRequestSchema)
  @ApiZodResponse(200, platformTenantDetailSchema, 'Recorded as a paid invoice; the period starts.')
  recordPayment(
    @CurrentPlatformPrincipal() p: PlatformPrincipal,
    @Param('id', uuidParam) id: string,
    @ZodBody(manualPaymentRequestSchema) body: z.output<typeof manualPaymentRequestSchema>,
  ): Promise<PlatformTenantDetail> {
    return this.platform.recordPayment(p, id, body);
  }

  @Get('plans')
  @ApiZodResponse(200, platformPlanListSchema)
  plans(): Promise<PlatformPlanList> {
    return this.platform.plans();
  }

  @Post('plans')
  @ApiZodBody(createPlanRequestSchema)
  @ApiZodResponse(201, platformPlanSchema)
  createPlan(
    @CurrentPlatformPrincipal() p: PlatformPrincipal,
    @ZodBody(createPlanRequestSchema) body: z.output<typeof createPlanRequestSchema>,
  ): Promise<PlatformPlan> {
    return this.platform.createPlan(p, body);
  }

  @Patch('plans/:code')
  @ApiZodBody(updatePlanRequestSchema)
  @ApiZodResponse(200, platformPlanSchema)
  updatePlan(
    @CurrentPlatformPrincipal() p: PlatformPrincipal,
    @Param('code') code: string,
    @ZodBody(updatePlanRequestSchema) body: z.output<typeof updatePlanRequestSchema>,
  ): Promise<PlatformPlan> {
    return this.platform.updatePlan(p, code, body);
  }

  @Get('flags')
  @ApiZodResponse(200, platformFeatureFlagListSchema)
  flags(): Promise<PlatformFeatureFlagList> {
    return this.platform.flags();
  }

  @Patch('flags/:key')
  @ApiZodBody(updateFeatureFlagRequestSchema)
  @ApiZodResponse(200, platformFeatureFlagListSchema)
  updateFlag(
    @CurrentPlatformPrincipal() p: PlatformPrincipal,
    @Param('key') key: string,
    @ZodBody(updateFeatureFlagRequestSchema) body: z.output<typeof updateFeatureFlagRequestSchema>,
  ): Promise<PlatformFeatureFlagList> {
    return this.platform.updateFlag(p, key, body);
  }

  @Put('tenants/:id/flags/:key')
  @ApiZodBody(setTenantFeatureRequestSchema)
  @ApiZodResponse(200, tenantFeatureSchema.array())
  setTenantFlag(
    @CurrentPlatformPrincipal() p: PlatformPrincipal,
    @Param('id', uuidParam) id: string,
    @Param('key') key: string,
    @ZodBody(setTenantFeatureRequestSchema) body: z.output<typeof setTenantFeatureRequestSchema>,
  ): Promise<TenantFeature[]> {
    return this.platform.setTenantFlag(p, id, key, body);
  }

  @Get('audit')
  @ApiZodQuery(platformAuditQuerySchema)
  @ApiZodResponse(200, platformAuditPageSchema)
  audit(
    @ZodQuery(platformAuditQuerySchema) query: z.output<typeof platformAuditQuerySchema>,
  ): Promise<PlatformAuditPage> {
    return this.platform.audit(query);
  }
}
