import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import {
  type Branch,
  type BranchList,
  branchListSchema,
  branchSchema,
  createBranchRequestSchema,
  createRegisterRequestSchema,
  errorResponseSchema,
  listBranchesQuerySchema,
  type Register,
  registerSchema,
  updateBranchRequestSchema,
  updateRegisterRequestSchema,
} from '@pos/contracts';
import type { z } from 'zod';
import { CurrentPrincipal, RequirePermissions } from '../auth/auth.decorators';
import { AppException } from '../common/app-exception';
import type { AuthPrincipal } from '../common/request-context';
import { ApiZodBody, ApiZodQuery, ApiZodResponse, ZodBody, ZodQuery } from '../common/zod';
import { LocationsService } from './locations.service';

// Malformed IDs answer 404 like unknown ones, so IDs from other tenants are indistinguishable.
const uuidParam = new ParseUUIDPipe({ exceptionFactory: () => AppException.notFound() });

@ApiTags('Branches & registers')
@ApiBearerAuth()
@Controller()
export class LocationsController {
  constructor(private readonly locations: LocationsService) {}

  @Get('branches')
  @RequirePermissions('branches.read')
  @ApiZodQuery(listBranchesQuerySchema)
  @ApiZodResponse(200, branchListSchema, 'Branches with their registers.')
  list(
    @CurrentPrincipal() principal: AuthPrincipal,
    @ZodQuery(listBranchesQuerySchema) query: z.output<typeof listBranchesQuerySchema>,
  ): Promise<BranchList> {
    return this.locations.list(principal.tenantId, query.includeArchived);
  }

  @Post('branches')
  @RequirePermissions('branches.manage')
  @ApiZodBody(createBranchRequestSchema)
  @ApiZodResponse(201, branchSchema)
  @ApiZodResponse(409, errorResponseSchema, 'DUPLICATE_CODE')
  createBranch(
    @CurrentPrincipal() principal: AuthPrincipal,
    @ZodBody(createBranchRequestSchema) body: z.output<typeof createBranchRequestSchema>,
  ): Promise<Branch> {
    return this.locations.createBranch(principal.tenantId, body);
  }

  @Patch('branches/:id')
  @RequirePermissions('branches.manage')
  @ApiZodBody(updateBranchRequestSchema)
  @ApiZodResponse(200, branchSchema)
  @ApiZodResponse(
    409,
    errorResponseSchema,
    'VERSION_CONFLICT, DUPLICATE_CODE or LAST_ACTIVE_BRANCH',
  )
  updateBranch(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param('id', uuidParam) id: string,
    @ZodBody(updateBranchRequestSchema) body: z.output<typeof updateBranchRequestSchema>,
  ): Promise<Branch> {
    return this.locations.updateBranch(principal.tenantId, id, body);
  }

  @Post('registers')
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions('branches.manage')
  @ApiZodBody(createRegisterRequestSchema)
  @ApiZodResponse(201, registerSchema)
  @ApiZodResponse(409, errorResponseSchema, 'DUPLICATE_CODE or BRANCH_ARCHIVED')
  createRegister(
    @CurrentPrincipal() principal: AuthPrincipal,
    @ZodBody(createRegisterRequestSchema) body: z.output<typeof createRegisterRequestSchema>,
  ): Promise<Register> {
    return this.locations.createRegister(principal.tenantId, body);
  }

  @Patch('registers/:id')
  @RequirePermissions('branches.manage')
  @ApiZodBody(updateRegisterRequestSchema)
  @ApiZodResponse(200, registerSchema)
  @ApiZodResponse(409, errorResponseSchema, 'VERSION_CONFLICT, DUPLICATE_CODE or BRANCH_ARCHIVED')
  updateRegister(
    @CurrentPrincipal() principal: AuthPrincipal,
    @Param('id', uuidParam) id: string,
    @ZodBody(updateRegisterRequestSchema) body: z.output<typeof updateRegisterRequestSchema>,
  ): Promise<Register> {
    return this.locations.updateRegister(principal.tenantId, id, body);
  }
}
