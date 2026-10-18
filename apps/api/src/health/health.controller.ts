import { Controller, Get, Inject, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { type HealthResponse, healthResponseSchema } from '@pos/contracts';
import type { Response } from 'express';
import { Public } from '../auth/auth.decorators';
import { ApiZodResponse } from '../common/zod';
import { APP_CONFIG, type AppConfig } from '../config/app-config';
import { PrismaService } from '../prisma/prisma.service';

/** Served outside the /api/v1 prefix for load balancers and container orchestrators. */
@ApiTags('Health')
@Public()
@SkipThrottle()
@Controller('health')
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  /** Liveness: the process is running. Does not touch dependencies. */
  @Get('live')
  @ApiZodResponse(200, healthResponseSchema)
  live(): HealthResponse {
    return this.body({});
  }

  /** Readiness: dependencies are reachable; returns 503 otherwise. */
  @Get('ready')
  @ApiZodResponse(200, healthResponseSchema)
  @ApiZodResponse(503, healthResponseSchema)
  async ready(@Res({ passthrough: true }) res: Response): Promise<HealthResponse> {
    const database = (await this.prisma.ping()) ? 'up' : 'down';
    if (database === 'down') res.status(503);
    return this.body({ database });
  }

  private body(checks: HealthResponse['checks']): HealthResponse {
    const healthy = Object.values(checks).every((status) => status === 'up');
    return {
      status: healthy ? 'ok' : 'degraded',
      version: this.config.APP_VERSION,
      uptimeSeconds: Math.round(process.uptime()),
      checks,
    };
  }
}
