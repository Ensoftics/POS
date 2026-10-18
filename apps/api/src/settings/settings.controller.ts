import { Controller, Get, Patch } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import {
  type BusinessProfilePresets,
  businessProfilePresetsSchema,
  errorResponseSchema,
  type TenantSettings,
  tenantSettingsSchema,
  updateTenantSettingsRequestSchema,
} from '@pos/contracts';
import { BUSINESS_PROFILE_PRESETS } from '@pos/domain';
import type { z } from 'zod';
import { CurrentPrincipal, RequirePermissions } from '../auth/auth.decorators';
import type { AuthPrincipal } from '../common/request-context';
import { ApiZodBody, ApiZodResponse, ZodBody } from '../common/zod';
import { SettingsService } from './settings.service';

@ApiTags('Settings')
@ApiBearerAuth()
@Controller('settings')
export class SettingsController {
  constructor(private readonly settings: SettingsService) {}

  @Get()
  @RequirePermissions('settings.read')
  @ApiZodResponse(200, tenantSettingsSchema)
  get(@CurrentPrincipal() principal: AuthPrincipal): Promise<TenantSettings> {
    return this.settings.get(principal.tenantId);
  }

  @Patch()
  @RequirePermissions('settings.update')
  @ApiZodBody(updateTenantSettingsRequestSchema)
  @ApiZodResponse(200, tenantSettingsSchema)
  @ApiZodResponse(409, errorResponseSchema, 'VERSION_CONFLICT')
  update(
    @CurrentPrincipal() principal: AuthPrincipal,
    @ZodBody(updateTenantSettingsRequestSchema)
    body: z.output<typeof updateTenantSettingsRequestSchema>,
  ): Promise<TenantSettings> {
    return this.settings.update(principal.tenantId, body);
  }

  /** Industry presets, so clients can offer "reset to recommended" without hard-coding them. */
  @Get('profile-presets')
  @RequirePermissions('settings.read')
  @ApiZodResponse(200, businessProfilePresetsSchema)
  presets(): BusinessProfilePresets {
    return BUSINESS_PROFILE_PRESETS;
  }
}
