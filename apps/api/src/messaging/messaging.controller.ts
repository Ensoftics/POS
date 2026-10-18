import { Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import {
  type Campaign,
  type CampaignPage,
  campaignPageSchema,
  campaignSchema,
  type ConsentHistory,
  consentHistorySchema,
  createCampaignRequestSchema,
  errorResponseSchema,
  type MessagingStatus,
  messagingStatusSchema,
  paginationQuerySchema,
  unsubscribeCodeSchema,
  type UnsubscribeInfo,
  unsubscribeInfoSchema,
  unsubscribeRequestSchema,
} from '@pos/contracts';
import type { z } from 'zod';
import {
  CurrentPrincipal,
  Public,
  RequirePermissions,
  SensitiveRateLimit,
} from '../auth/auth.decorators';
import { AppException } from '../common/app-exception';
import type { AuthPrincipal } from '../common/request-context';
import { ApiZodBody, ApiZodQuery, ApiZodResponse, ZodBody, ZodQuery } from '../common/zod';
import { MessagingService } from './messaging.service';

const uuidParam = new ParseUUIDPipe({ exceptionFactory: () => AppException.notFound() });

@ApiTags('Customer messages')
@Controller()
export class MessagingController {
  constructor(private readonly messaging: MessagingService) {}

  @Get('messaging/status')
  @ApiBearerAuth()
  @RequirePermissions('customers.message')
  @ApiZodResponse(200, messagingStatusSchema)
  status(@CurrentPrincipal() principal: AuthPrincipal): Promise<MessagingStatus> {
    return this.messaging.status(principal.tenantId);
  }

  @Get('messaging/campaigns')
  @ApiBearerAuth()
  @RequirePermissions('customers.message')
  @ApiZodQuery(paginationQuerySchema)
  @ApiZodResponse(200, campaignPageSchema)
  list(
    @CurrentPrincipal() principal: AuthPrincipal,
    @ZodQuery(paginationQuerySchema) query: z.output<typeof paginationQuerySchema>,
  ): Promise<CampaignPage> {
    return this.messaging.list(principal.tenantId, query);
  }

  /** Queues the message for every customer who agreed; idempotent on `id`. */
  @Post('messaging/campaigns')
  @ApiBearerAuth()
  @RequirePermissions('customers.message')
  @ApiZodBody(createCampaignRequestSchema)
  @ApiZodResponse(201, campaignSchema)
  @ApiZodResponse(409, errorResponseSchema, 'PLAN_LIMIT_REACHED (monthly SMS)')
  @ApiZodResponse(503, errorResponseSchema, 'MESSAGING_UNAVAILABLE')
  create(
    @CurrentPrincipal() principal: AuthPrincipal,
    @ZodBody(createCampaignRequestSchema) body: z.output<typeof createCampaignRequestSchema>,
  ): Promise<Campaign> {
    return this.messaging.create(principal.tenantId, body, principal.userId);
  }

  @Get('customers/:id/consents')
  @ApiBearerAuth()
  @RequirePermissions('customers.read')
  @ApiZodResponse(200, consentHistorySchema)
  consents(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param('id', uuidParam) id: string,
  ): Promise<ConsentHistory> {
    return this.messaging.consentHistory(principal.tenantId, id);
  }

  /* The opt-out link in every message; the code identifies the customer, no sign-in. */

  @Get('public/unsubscribe/:code')
  @Public()
  @SensitiveRateLimit()
  @ApiZodResponse(200, unsubscribeInfoSchema)
  unsubscribeInfo(@Param('code') code: string): Promise<UnsubscribeInfo> {
    const parsed = unsubscribeCodeSchema.safeParse(code);
    if (!parsed.success) throw AppException.notFound();
    return this.messaging.unsubscribeInfo(parsed.data);
  }

  @Post('public/unsubscribe')
  @Public()
  @SensitiveRateLimit()
  @HttpCode(HttpStatus.OK)
  @ApiZodBody(unsubscribeRequestSchema)
  @ApiZodResponse(200, unsubscribeInfoSchema)
  unsubscribe(
    @ZodBody(unsubscribeRequestSchema) body: z.output<typeof unsubscribeRequestSchema>,
  ): Promise<UnsubscribeInfo> {
    return this.messaging.unsubscribe(body.code);
  }
}
