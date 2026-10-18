import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import {
  auditLogPageSchema,
  type AuditLogPage,
  listAuditLogsQuerySchema,
  type PaginationQuery,
} from '@pos/contracts';
import { CurrentPrincipal, RequirePermissions } from '../auth/auth.decorators';
import type { AuthPrincipal } from '../common/request-context';
import { ApiZodQuery, ApiZodResponse, ZodQuery } from '../common/zod';
import { AuditService } from './audit.service';

@ApiTags('Audit')
@ApiBearerAuth()
@Controller('audit-logs')
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  @Get()
  @RequirePermissions('audit.read')
  @ApiZodQuery(listAuditLogsQuerySchema)
  @ApiZodResponse(200, auditLogPageSchema)
  list(
    @CurrentPrincipal() principal: AuthPrincipal,
    @ZodQuery(listAuditLogsQuerySchema) query: PaginationQuery,
  ): Promise<AuditLogPage> {
    return this.audit.list(principal.tenantId, query);
  }
}
