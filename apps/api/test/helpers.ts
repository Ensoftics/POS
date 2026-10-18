import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import type { AuthSessionResponse, RegisterRequest } from '@pos/contracts';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PasswordHasher } from '../src/auth/password-hasher';
import { configureApp } from '../src/bootstrap';
import { APP_CONFIG, type AppConfig, loadConfig } from '../src/config/app-config';
import { type MailMessage, Mailer } from '../src/mail/mailer';
import { type SmsResult, SmsSender } from '../src/messaging/sms-sender';
import { PrismaService } from '../src/prisma/prisma.service';

export class RecordingMailer extends Mailer {
  readonly sent: MailMessage[] = [];

  async send(message: MailMessage): Promise<void> {
    this.sent.push(message);
  }

  lastTo(email: string): MailMessage | undefined {
    return [...this.sent].reverse().find((message) => message.to === email);
  }
}

/** Stands in for the SMS gateway; tests set availability and the next results. */
export class RecordingSms extends SmsSender {
  readonly sent: Array<{ to: string; text: string; unicode: boolean }> = [];
  enabled = true;
  results: SmsResult[] = [];

  get available(): boolean {
    return this.enabled;
  }

  async send(to: string, text: string, unicode: boolean): Promise<SmsResult> {
    const result = this.results.shift() ?? { ok: true };
    if (result.ok) this.sent.push({ to, text, unicode });
    return result;
  }
}

export interface TestContext {
  app: NestExpressApplication;
  http: ReturnType<typeof request>;
  mailer: RecordingMailer;
  sms: RecordingSms;
  /** Restricted runtime client (pos_app) — subject to RLS. */
  prisma: PrismaService;
  /** Schema-owner client for arranging state and cleanup. Bypasses RLS. */
  owner: PrismaClient;
  config: AppConfig;
  close: () => Promise<void>;
}

export async function createTestContext(overrides: Partial<AppConfig> = {}): Promise<TestContext> {
  const config: AppConfig = { ...loadConfig(), ...overrides };
  const mailer = new RecordingMailer();
  const sms = new RecordingSms();
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(APP_CONFIG)
    .useValue(config)
    .overrideProvider(Mailer)
    .useValue(mailer)
    .overrideProvider(SmsSender)
    .useValue(sms)
    .compile();

  const app = moduleRef.createNestApplication<NestExpressApplication>({ logger: false });
  configureApp(app, config);
  await app.init();

  const owner = new PrismaClient({ datasourceUrl: process.env.MIGRATION_DATABASE_URL });
  return {
    app,
    http: request(app.getHttpServer()),
    mailer,
    sms,
    prisma: app.get(PrismaService),
    owner,
    config,
    close: async () => {
      await app.close();
      await owner.$disconnect();
    },
  };
}

export async function resetDatabase(owner: PrismaClient): Promise<void> {
  await owner.$executeRawUnsafe(
    'TRUNCATE TABLE message_deliveries, message_campaigns, consent_events, product_images, loyalty_entries, notifications, daily_runs, tenant_feature_flags, payment_events, billing_invoices, subscriptions, email_verification_tokens, devices, invitations, membership_branches, variant_costs, customer_payments, customer_ledger_entries, sale_conflicts, cash_movements, sale_return_refunds, sale_return_lines, sale_returns, sale_payments, sale_lines, sales, shifts, tax_rates, stock_count_lines, stock_counts, stock_transfer_lines, stock_transfers, stock_adjustment_lines, stock_adjustments, goods_receipt_lines, goods_receipts, stock_movements, stock_levels, stock_batches, purchase_order_lines, purchase_orders, suppliers, document_sequences, product_variants, products, categories, registers, branches, customers, tenant_settings, audit_logs, sessions, password_reset_tokens, memberships, users, tenants CASCADE',
  );
}

let sequence = 0;
export function uniqueEmail(prefix = 'owner'): string {
  sequence += 1;
  return `${prefix}.${Date.now()}.${sequence}@example.com`;
}

export const STRONG_PASSWORD = 'blue-mango-river-42';

export function registration(overrides: Partial<RegisterRequest> = {}): RegisterRequest {
  return {
    businessName: 'Lotus Cosmetics',
    ownerFullName: 'Ama Silva',
    email: uniqueEmail(),
    password: STRONG_PASSWORD,
    acceptTerms: true,
    clientType: 'MOBILE',
    ...overrides,
  };
}

export async function registerTenant(
  ctx: TestContext,
  overrides: Partial<RegisterRequest> = {},
): Promise<AuthSessionResponse & { refreshToken: string; email: string }> {
  const body = registration(overrides);
  const response = await ctx.http.post('/api/v1/auth/register').send(body).expect(201);
  return {
    ...(response.body as AuthSessionResponse & { refreshToken: string }),
    email: body.email,
  };
}

/** Adds an existing or new user to a tenant with the given role (as an admin would in Slice 10). */
export async function addMember(
  ctx: TestContext,
  tenantId: string,
  role: 'OWNER' | 'MANAGER' | 'CASHIER' | 'INVENTORY_STAFF',
  email = uniqueEmail(role.toLowerCase()),
): Promise<{ email: string; userId: string }> {
  const passwordHash = await ctx.app.get(PasswordHasher).hash(STRONG_PASSWORD);
  const user = await ctx.owner.user.upsert({
    where: { email },
    update: {},
    create: { email, fullName: `Test ${role}`, passwordHash },
  });
  await ctx.owner.membership.create({ data: { tenantId, userId: user.id, role } });
  return { email, userId: user.id };
}

export async function login(
  ctx: TestContext,
  email: string,
  extra: Record<string, unknown> = {},
): Promise<AuthSessionResponse & { refreshToken: string }> {
  const response = await ctx.http
    .post('/api/v1/auth/login')
    .send({ email, password: STRONG_PASSWORD, clientType: 'MOBILE', ...extra })
    .expect(200);
  return response.body as AuthSessionResponse & { refreshToken: string };
}

export const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

/** Registers a tenant and completes onboarding, so settings presets and the default location exist. */
export async function onboardedTenant(
  ctx: TestContext,
  businessType: 'COSMETICS' | 'TEXTILE' | 'GENERAL_RETAIL' = 'TEXTILE',
  overrides: Partial<RegisterRequest> = {},
) {
  const session = await registerTenant(ctx, overrides);
  await ctx.http
    .post('/api/v1/tenant/onboarding')
    .set(bearer(session.accessToken))
    .send({ businessName: session.tenant.name, businessType })
    .expect(200);
  return session;
}
