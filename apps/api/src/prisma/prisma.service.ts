import { Inject, Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import { APP_CONFIG, type AppConfig } from '../config/app-config';

export type Tx = Prisma.TransactionClient;

interface TxOptions {
  isolationLevel?: Prisma.TransactionIsolationLevel;
  timeout?: number;
  maxWait?: number;
}

/**
 * Database access. Tenant data must be read and written through `withTenant`,
 * which sets a transaction-local tenant ID that PostgreSQL RLS policies enforce.
 * `asSystem` is reserved for identity flows that run before a tenant is known
 * (registration, login, token refresh) and must not be used for business data.
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor(@Inject(APP_CONFIG) config: AppConfig) {
    super({
      datasourceUrl: config.DATABASE_URL,
      log: ['warn', 'error'],
      // Prisma's 5 s default turns a brief CPU stall on a busy host into a failed request.
      // 15 s still bounds how long a transaction can hold locks; long jobs pass their own.
      transactionOptions: { timeout: 15_000, maxWait: 5_000 },
    });
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }

  withTenant<T>(tenantId: string, fn: (tx: Tx) => Promise<T>, options?: TxOptions): Promise<T> {
    return this.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;
      return fn(tx);
    }, options);
  }

  asSystem<T>(fn: (tx: Tx) => Promise<T>, options?: TxOptions): Promise<T> {
    return this.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.rls_bypass', 'on', true)`;
      return fn(tx);
    }, options);
  }

  async ping(): Promise<boolean> {
    try {
      await this.$queryRaw`SELECT 1`;
      return true;
    } catch {
      return false;
    }
  }
}
