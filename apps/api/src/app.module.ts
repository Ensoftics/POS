import { type MiddlewareConsumer, Module, type NestModule } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, Reflector } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import type { Request } from 'express';
import { AuditModule } from './audit/audit.module';
import { SENSITIVE_RATE_LIMIT } from './auth/auth.decorators';
import { AuthModule } from './auth/auth.module';
import { BillingModule } from './billing/billing.module';
import { NotificationsModule } from './notifications/notifications.module';
import { PlatformModule } from './platform/platform.module';
import { SubscriptionGuard } from './billing/subscription.guard';
import { CatalogModule } from './catalog/catalog.module';
import { CustomersModule } from './customers/customers.module';
import { AccessTokenGuard } from './auth/guards/access-token.guard';
import { PermissionsGuard } from './auth/guards/permissions.guard';
import { HttpExceptionFilter } from './common/http-exception.filter';
import { RequestContextMiddleware } from './common/request-context.middleware';
import { APP_CONFIG, type AppConfig } from './config/app-config';
import { ConfigModule } from './config/config.module';
import { HealthController } from './health/health.controller';
import { InventoryModule } from './inventory/inventory.module';
import { LocationsModule } from './locations/locations.module';
import { MailModule } from './mail/mail.module';
import { MediaModule } from './media/media.module';
import { MessagingModule } from './messaging/messaging.module';
import { PrismaModule } from './prisma/prisma.module';
import { ReportsModule } from './reports/reports.module';
import { SalesModule } from './sales/sales.module';
import { SettingsModule } from './settings/settings.module';
import { StaffModule } from './staff/staff.module';
import { TenantModule } from './tenant/tenant.module';

@Module({
  imports: [
    ConfigModule,
    PrismaModule,
    MailModule,
    AuditModule,
    MediaModule,
    // In-memory counters are per instance. Use a Redis store before running more than one API replica.
    ThrottlerModule.forRootAsync({
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) => {
        const reflector = new Reflector();
        return {
          throttlers: [
            { name: 'default', ttl: 60_000, limit: config.RATE_LIMIT_DEFAULT_PER_MINUTE },
            {
              name: 'auth',
              ttl: 60_000,
              limit: config.RATE_LIMIT_AUTH_PER_MINUTE,
              // Only routes marked @SensitiveRateLimit() count against the stricter limit.
              skipIf: (context) =>
                !reflector.get<boolean>(SENSITIVE_RATE_LIMIT, context.getHandler()),
            },
          ],
          getTracker: (req: Record<string, unknown>) => (req as unknown as Request).ip ?? 'unknown',
        };
      },
    }),
    AuthModule,
    BillingModule,
    NotificationsModule,
    TenantModule,
    SettingsModule,
    LocationsModule,
    CatalogModule,
    InventoryModule,
    SalesModule,
    CustomersModule,
    ReportsModule,
    StaffModule,
    PlatformModule,
    MessagingModule,
  ],
  controllers: [HealthController],
  providers: [
    { provide: APP_FILTER, useClass: HttpExceptionFilter },
    // Global guards run in this order: rate limit, authenticate, authorise, subscription.
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useExisting: AccessTokenGuard },
    { provide: APP_GUARD, useExisting: PermissionsGuard },
    { provide: APP_GUARD, useExisting: SubscriptionGuard },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestContextMiddleware).forRoutes('{*splat}');
  }
}
