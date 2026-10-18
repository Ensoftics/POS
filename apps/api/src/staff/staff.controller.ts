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
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import {
  createInvitationRequestSchema,
  type Device,
  type DeviceList,
  deviceListSchema,
  deviceSchema,
  errorResponseSchema,
  type Invitation,
  invitationSchema,
  registerDeviceRequestSchema,
  type StaffList,
  staffListSchema,
  type StaffMember,
  staffMemberSchema,
  updateStaffRequestSchema,
} from '@pos/contracts';
import type { z } from 'zod';
import { CurrentPrincipal, RequirePermissions } from '../auth/auth.decorators';
import { AppException } from '../common/app-exception';
import type { AuthPrincipal } from '../common/request-context';
import { ApiZodBody, ApiZodResponse, ZodBody } from '../common/zod';
import { DevicesService } from './devices.service';
import { StaffService } from './staff.service';

const uuidParam = new ParseUUIDPipe({ exceptionFactory: () => AppException.notFound() });

@ApiTags('Staff')
@ApiBearerAuth()
@Controller('staff')
export class StaffController {
  constructor(private readonly staff: StaffService) {}

  @Get()
  @RequirePermissions('staff.manage')
  @ApiZodResponse(200, staffListSchema)
  list(@CurrentPrincipal() p: AuthPrincipal): Promise<StaffList> {
    return this.staff.list(p);
  }

  @Post('invitations')
  @RequirePermissions('staff.manage')
  @ApiZodBody(createInvitationRequestSchema)
  @ApiZodResponse(201, invitationSchema, 'Invitation e-mailed.')
  @ApiZodResponse(403, errorResponseSchema, 'ROLE_NOT_ALLOWED')
  @ApiZodResponse(409, errorResponseSchema, 'ALREADY_MEMBER')
  invite(
    @CurrentPrincipal() p: AuthPrincipal,
    @ZodBody(createInvitationRequestSchema) body: z.output<typeof createInvitationRequestSchema>,
  ): Promise<Invitation> {
    return this.staff.invite(p, body);
  }

  @Post('invitations/:id/revoke')
  @RequirePermissions('staff.manage')
  @HttpCode(HttpStatus.NO_CONTENT)
  revokeInvitation(
    @CurrentPrincipal() p: AuthPrincipal,
    @Param('id', uuidParam) id: string,
  ): Promise<void> {
    return this.staff.revokeInvitation(p, id);
  }

  @Patch(':membershipId')
  @RequirePermissions('staff.manage')
  @ApiZodBody(updateStaffRequestSchema)
  @ApiZodResponse(200, staffMemberSchema, 'Access changed; the member is signed out everywhere.')
  @ApiZodResponse(403, errorResponseSchema, 'ROLE_NOT_ALLOWED')
  @ApiZodResponse(409, errorResponseSchema, 'LAST_OWNER or VERSION_CONFLICT')
  update(
    @CurrentPrincipal() p: AuthPrincipal,
    @Param('membershipId', uuidParam) membershipId: string,
    @ZodBody(updateStaffRequestSchema) body: z.output<typeof updateStaffRequestSchema>,
  ): Promise<StaffMember> {
    return this.staff.update(p, membershipId, body);
  }
}

@ApiTags('Devices')
@ApiBearerAuth()
@Controller('devices')
export class DevicesController {
  constructor(private readonly devices: DevicesService) {}

  @Get()
  @RequirePermissions('staff.manage')
  @ApiZodResponse(200, deviceListSchema)
  list(@CurrentPrincipal() p: AuthPrincipal): Promise<DeviceList> {
    return this.devices.list(p.tenantId);
  }

  /** Called by a till when it is set up for a register (and again whenever that changes). */
  @Put(':id')
  @RequirePermissions('sales.create')
  @ApiZodBody(registerDeviceRequestSchema)
  @ApiZodResponse(200, deviceSchema)
  @ApiZodResponse(403, errorResponseSchema, 'DEVICE_REVOKED or BRANCH_NOT_ALLOWED')
  register(
    @CurrentPrincipal() p: AuthPrincipal,
    @Param('id', uuidParam) id: string,
    @ZodBody(registerDeviceRequestSchema) body: z.output<typeof registerDeviceRequestSchema>,
  ): Promise<Device> {
    return this.devices.register(p, id, body);
  }

  @Post(':id/revoke')
  @RequirePermissions('staff.manage')
  @HttpCode(HttpStatus.OK)
  @ApiZodResponse(200, deviceSchema, 'Device blocked and signed out.')
  revoke(
    @CurrentPrincipal() p: AuthPrincipal,
    @Param('id', uuidParam) id: string,
  ): Promise<Device> {
    return this.devices.revoke(p.tenantId, id);
  }

  @Post(':id/restore')
  @RequirePermissions('staff.manage')
  @HttpCode(HttpStatus.OK)
  @ApiZodResponse(200, deviceSchema)
  restore(
    @CurrentPrincipal() p: AuthPrincipal,
    @Param('id', uuidParam) id: string,
  ): Promise<Device> {
    return this.devices.restore(p.tenantId, id);
  }
}
