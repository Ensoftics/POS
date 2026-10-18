import { Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import {
  type CatalogSyncPage,
  catalogSyncPageSchema,
  catalogSyncQuerySchema,
  listConflictsQuerySchema,
  resolveConflictRequestSchema,
  type SaleConflict,
  type SaleConflictPage,
  saleConflictPageSchema,
  saleConflictSchema,
} from '@pos/contracts';
import type { z } from 'zod';
import { CurrentPrincipal, RequirePermissions } from '../auth/auth.decorators';
import { AppException } from '../common/app-exception';
import type { AuthPrincipal } from '../common/request-context';
import { ApiZodBody, ApiZodQuery, ApiZodResponse, ZodBody, ZodQuery } from '../common/zod';
import { SyncService } from './sync.service';

@ApiTags('Offline sync')
@ApiBearerAuth()
@Controller()
export class SyncController {
  constructor(private readonly sync: SyncService) {}

  @Get('sync/catalog')
  @RequirePermissions('products.read')
  @ApiZodQuery(catalogSyncQuerySchema)
  @ApiZodResponse(200, catalogSyncPageSchema, 'Catalogue changes since the cursor, oldest first.')
  catalog(
    @CurrentPrincipal() p: AuthPrincipal,
    @ZodQuery(catalogSyncQuerySchema) query: z.output<typeof catalogSyncQuerySchema>,
  ): Promise<CatalogSyncPage> {
    return this.sync.catalog(p.tenantId, query.cursor, query.limit);
  }

  @Get('sale-conflicts')
  @RequirePermissions('shifts.manage')
  @ApiZodQuery(listConflictsQuerySchema)
  @ApiZodResponse(200, saleConflictPageSchema, 'Offline sales that need a manager to review.')
  conflicts(
    @CurrentPrincipal() p: AuthPrincipal,
    @ZodQuery(listConflictsQuerySchema) query: z.output<typeof listConflictsQuerySchema>,
  ): Promise<SaleConflictPage> {
    return this.sync.conflicts(p.tenantId, query);
  }

  @Post('sale-conflicts/:id/resolve')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('shifts.manage')
  @ApiZodBody(resolveConflictRequestSchema)
  @ApiZodResponse(200, saleConflictSchema)
  resolve(
    @CurrentPrincipal() p: AuthPrincipal,
    @Param('id', new ParseUUIDPipe({ exceptionFactory: () => AppException.notFound() }))
    id: string,
    @ZodBody(resolveConflictRequestSchema) body: z.output<typeof resolveConflictRequestSchema>,
  ): Promise<SaleConflict> {
    return this.sync.resolve(p.tenantId, id, body.note, p);
  }
}
