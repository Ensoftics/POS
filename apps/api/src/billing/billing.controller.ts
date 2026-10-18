import { Body, Controller, Get, HttpCode, HttpStatus, Logger, Post, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiExcludeEndpoint, ApiTags } from '@nestjs/swagger';
import {
  type BillingOverview,
  billingOverviewSchema,
  type CheckoutResponse,
  checkoutRequestSchema,
  checkoutResponseSchema,
  errorResponseSchema,
  type Subscription,
  subscriptionSchema,
  versionOnlyRequestSchema,
} from '@pos/contracts';
import type { Response } from 'express';
import type { z } from 'zod';
import { CurrentPrincipal, Public, RequirePermissions } from '../auth/auth.decorators';
import type { AuthPrincipal } from '../common/request-context';
import { ApiZodBody, ApiZodResponse, ZodBody } from '../common/zod';
import { BillingService } from './billing.service';
import { InvalidNotificationError } from './payment-provider';
import { AllowWhenInactive } from './subscription.guard';

@ApiTags('Billing')
@ApiBearerAuth()
@Controller('billing')
@AllowWhenInactive()
export class BillingController {
  private readonly logger = new Logger(BillingController.name);

  constructor(private readonly billing: BillingService) {}

  @Get()
  @RequirePermissions('billing.manage')
  @ApiZodResponse(200, billingOverviewSchema)
  overview(@CurrentPrincipal() p: AuthPrincipal): Promise<BillingOverview> {
    return this.billing.overview(p);
  }

  @Post('checkout')
  @RequirePermissions('billing.manage')
  @HttpCode(HttpStatus.OK)
  @ApiZodBody(checkoutRequestSchema)
  @ApiZodResponse(200, checkoutResponseSchema, 'Send the browser to the hosted checkout.')
  @ApiZodResponse(403, errorResponseSchema, 'EMAIL_NOT_VERIFIED')
  @ApiZodResponse(503, errorResponseSchema, 'PAYMENTS_UNAVAILABLE')
  checkout(
    @CurrentPrincipal() p: AuthPrincipal,
    @ZodBody(checkoutRequestSchema) body: z.output<typeof checkoutRequestSchema>,
  ): Promise<CheckoutResponse> {
    return this.billing.checkout(p, body);
  }

  @Post('cancel')
  @RequirePermissions('billing.manage')
  @HttpCode(HttpStatus.OK)
  @ApiZodBody(versionOnlyRequestSchema)
  @ApiZodResponse(200, subscriptionSchema, 'Ends at the end of the trial or paid period.')
  cancel(
    @CurrentPrincipal() p: AuthPrincipal,
    @ZodBody(versionOnlyRequestSchema) body: z.output<typeof versionOnlyRequestSchema>,
  ): Promise<Subscription> {
    return this.billing.setCancelAtPeriodEnd(p, body.version, true);
  }

  @Post('resume')
  @RequirePermissions('billing.manage')
  @HttpCode(HttpStatus.OK)
  @ApiZodBody(versionOnlyRequestSchema)
  @ApiZodResponse(200, subscriptionSchema)
  resume(
    @CurrentPrincipal() p: AuthPrincipal,
    @ZodBody(versionOnlyRequestSchema) body: z.output<typeof versionOnlyRequestSchema>,
  ): Promise<Subscription> {
    return this.billing.setCancelAtPeriodEnd(p, body.version, false);
  }

  /**
   * PayHere's server-to-server notification (form-encoded). Trusted only after
   * the signature checks out; anything else gets 400 and changes nothing.
   */
  @Post('webhooks/payhere')
  @Public()
  @ApiExcludeEndpoint()
  async payhere(@Body() body: Record<string, unknown>, @Res() res: Response): Promise<void> {
    try {
      await this.billing.applyNotification(body ?? {});
      res.status(HttpStatus.OK).type('text/plain').send('OK');
    } catch (error) {
      if (error instanceof InvalidNotificationError) {
        // The reason only, never the body: it can hold names and masked card data.
        this.logger.warn({ msg: 'payment notification rejected', reason: error.message });
        res.status(HttpStatus.BAD_REQUEST).type('text/plain').send('Rejected');
        return;
      }
      throw error;
    }
  }
}
