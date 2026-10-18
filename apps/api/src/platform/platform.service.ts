import { HttpStatus, Injectable } from '@nestjs/common';
import type {
  changePlanRequestSchema,
  closeTenantRequestSchema,
  createPlanRequestSchema,
  extendSubscriptionRequestSchema,
  listPlatformTenantsQuerySchema,
  manualPaymentRequestSchema,
  PlatformAuditPage,
  PlatformFeatureFlagList,
  setTenantFeatureRequestSchema,
  TenantFeature,
  updateFeatureFlagRequestSchema,
  platformAuditQuerySchema,
  PlatformOverview,
  PlatformPlan,
  PlatformPlanList,
  PlatformTenantDetail,
  PlatformTenantPage,
  PlatformTenantSummary,
  tenantActionRequestSchema,
  updatePlanRequestSchema,
} from '@pos/contracts';
import {
  addDays,
  exceededLimits,
  type FeatureFlagKey,
  invoiceTotals,
  isFeatureFlagKey,
} from '@pos/domain';
import { Prisma } from '@prisma/client';
import type { z } from 'zod';
import { AuditService } from '../audit/audit.service';
import { toBillingInvoice, toPlan } from '../billing/billing.mapper';
import { BillingService } from '../billing/billing.service';
import { Entitlements, planLimits } from '../billing/entitlements';
import { SubscriptionLifecycle } from '../billing/lifecycle.service';
import { PaymentProvider } from '../billing/payment-provider';
import { AppException } from '../common/app-exception';
import { versionConflict } from '../common/optimistic';
import { nextDocumentNumber } from '../inventory/inventory-helpers';
import { PrismaService, type Tx } from '../prisma/prisma.service';
import { PlatformAuditService } from './platform-audit.service';
import type { PlatformPrincipal } from './platform-auth.service';

type ListQuery = z.output<typeof listPlatformTenantsQuerySchema>;
type ReasonInput = z.output<typeof tenantActionRequestSchema>;
type CloseInput = z.output<typeof closeTenantRequestSchema>;
type ExtendInput = z.output<typeof extendSubscriptionRequestSchema>;
type ChangePlanInput = z.output<typeof changePlanRequestSchema>;
type ManualPaymentInput = z.output<typeof manualPaymentRequestSchema>;
type CreatePlanInput = z.output<typeof createPlanRequestSchema>;
type UpdatePlanInput = z.output<typeof updatePlanRequestSchema>;
type AuditQuery = z.output<typeof platformAuditQuerySchema>;
type UpdateFlagInput = z.output<typeof updateFeatureFlagRequestSchema>;
type SetTenantFlagInput = z.output<typeof setTenantFeatureRequestSchema>;

const DAY_MS = 86_400_000;

const tenantInclude = {
  subscription: { include: { plan: { select: { code: true, name: true } } } },
  memberships: {
    where: { role: 'OWNER', status: 'ACTIVE' },
    orderBy: { createdAt: 'asc' },
    take: 1,
    select: { user: { select: { email: true } } },
  },
} satisfies Prisma.TenantInclude;
type TenantRow = Prisma.TenantGetPayload<{ include: typeof tenantInclude }>;

function toSummary(row: TenantRow): PlatformTenantSummary {
  const sub = row.subscription;
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    status: row.status,
    businessType: row.businessType,
    createdAt: row.createdAt.toISOString(),
    ownerEmail: row.memberships[0]?.user.email ?? null,
    subscription: sub
      ? {
          status: sub.status,
          planCode: sub.plan.code,
          planName: sub.plan.name,
          interval: sub.interval,
          trialEndsAt: sub.trialEndsAt?.toISOString() ?? null,
          currentPeriodEnd: sub.currentPeriodEnd?.toISOString() ?? null,
          graceEndsAt: sub.graceEndsAt?.toISOString() ?? null,
          cancelAtPeriodEnd: sub.cancelAtPeriodEnd,
        }
      : null,
  };
}

const notFound = () => AppException.notFound('Business not found');

/**
 * What platform staff can see and do. Deliberately limited to business
 * metadata, subscriptions and billing: no access to a shop's sales, stock,
 * products or customers. Every action is written to the platform audit log,
 * and actions affecting a business also appear in that business's activity log.
 */
@Injectable()
export class PlatformService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly platformAudit: PlatformAuditService,
    private readonly tenantAudit: AuditService,
    private readonly entitlements: Entitlements,
    private readonly billing: BillingService,
    private readonly lifecycle: SubscriptionLifecycle,
    private readonly provider: PaymentProvider,
  ) {}

  overview(): Promise<PlatformOverview> {
    return this.prisma.asSystem(async (tx) => {
      const since = new Date(Date.now() - 30 * DAY_MS);
      const [byTenantStatus, bySubscription, signups, paid, recurring] = await Promise.all([
        tx.tenant.groupBy({ by: ['status'], _count: { _all: true } }),
        tx.subscription.groupBy({ by: ['status'], _count: { _all: true } }),
        tx.tenant.count({ where: { createdAt: { gte: since } } }),
        tx.billingInvoice.aggregate({
          where: { status: 'PAID', paidAt: { gte: since } },
          _sum: { subtotalMinor: true },
          _count: { _all: true },
        }),
        tx.$queryRaw<Array<{ mrr: bigint | null }>>`
          SELECT SUM(CASE WHEN s.interval = 'YEAR' THEN p.price_yearly_minor / 12.0
                          ELSE p.price_monthly_minor END)::bigint AS mrr
          FROM subscriptions s JOIN plans p ON p.id = s.plan_id
          WHERE s.status IN ('ACTIVE', 'PAST_DUE')`,
      ]);
      const tenantCount = (status: string) =>
        byTenantStatus.find((row) => row.status === status)?._count._all ?? 0;
      return {
        tenants: {
          total: byTenantStatus.reduce((sum, row) => sum + row._count._all, 0),
          suspended: tenantCount('SUSPENDED'),
          closed: tenantCount('CLOSED'),
          signupsLast30Days: signups,
        },
        subscriptions: Object.fromEntries(
          bySubscription.map((row) => [row.status, row._count._all]),
        ),
        revenue: {
          currency: 'LKR',
          monthlyRecurringMinor: Number(recurring[0]?.mrr ?? 0),
          paidLast30DaysMinor: paid._sum.subtotalMinor ?? 0,
          paymentsLast30Days: paid._count._all,
        },
        paymentsConfigured: this.provider.isConfigured(),
        lastBillingSweepAt: this.lifecycle.lastRunAt?.toISOString() ?? null,
      };
    });
  }

  listTenants(query: ListQuery): Promise<PlatformTenantPage> {
    return this.prisma.asSystem(async (tx) => {
      const q = query.q?.trim();
      const rows = await tx.tenant.findMany({
        where: {
          ...(query.tenantStatus ? { status: query.tenantStatus } : {}),
          ...(query.subscriptionStatus
            ? { subscription: { status: query.subscriptionStatus } }
            : {}),
          ...(q
            ? {
                OR: [
                  { name: { contains: q, mode: 'insensitive' } },
                  { slug: { contains: q.toLowerCase() } },
                  {
                    memberships: {
                      some: { role: 'OWNER', user: { email: { contains: q.toLowerCase() } } },
                    },
                  },
                ],
              }
            : {}),
        },
        include: tenantInclude,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: query.limit + 1,
        ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
      });
      const page = rows.slice(0, query.limit);
      return {
        items: page.map(toSummary),
        nextCursor: rows.length > query.limit ? (page.at(-1)?.id ?? null) : null,
      };
    });
  }

  tenant(principal: PlatformPrincipal, id: string): Promise<PlatformTenantDetail> {
    return this.prisma.asSystem(async (tx) => {
      const row = await tx.tenant.findUnique({ where: { id }, include: tenantInclude });
      if (!row) throw notFound();
      const [owners, usage, plan, invoices, payments, features] = await Promise.all([
        tx.membership.findMany({
          where: { tenantId: id, role: 'OWNER' },
          select: {
            user: {
              select: { fullName: true, email: true, emailVerifiedAt: true, lastLoginAt: true },
            },
          },
          orderBy: { createdAt: 'asc' },
        }),
        this.entitlements.usage(tx, id),
        row.subscription ? tx.plan.findUnique({ where: { id: row.subscription.planId } }) : null,
        tx.billingInvoice.findMany({
          where: { tenantId: id },
          include: { plan: { select: { name: true } } },
          orderBy: { createdAt: 'desc' },
          take: 20,
        }),
        tx.paymentEvent.findMany({
          where: { tenantId: id },
          orderBy: { createdAt: 'desc' },
          take: 20,
        }),
        this.tenantFeatures(tx, id),
      ]);
      // Viewing a business is itself recorded: staff access to customer accounts is auditable.
      await this.platformAudit.record(tx, {
        actorUserId: principal.userId,
        action: 'platform.tenant_viewed',
        tenantId: id,
        entityType: 'tenant',
        entityId: id,
      });
      return {
        ...toSummary(row),
        contactPhone: row.contactPhone,
        onboardingStatus: row.onboardingStatus,
        owners: owners.map((o) => ({
          fullName: o.user.fullName,
          email: o.user.email,
          emailVerified: o.user.emailVerifiedAt !== null,
          lastLoginAt: o.user.lastLoginAt?.toISOString() ?? null,
        })),
        usage,
        limits: plan ? planLimits(plan) : null,
        invoices: invoices.map(toBillingInvoice),
        payments: payments.map((p) => ({
          createdAt: p.createdAt.toISOString(),
          provider: p.provider,
          outcome: p.outcome,
          amountMinor: p.amountMinor,
          currency: p.currency,
          method: p.method,
        })),
        features,
      };
    });
  }

  private async tenantFeatures(tx: Tx, tenantId: string): Promise<TenantFeature[]> {
    const [flags, overrides] = await Promise.all([
      tx.featureFlag.findMany({ orderBy: { key: 'asc' } }),
      tx.tenantFeatureFlag.findMany({ where: { tenantId } }),
    ]);
    return flags
      .filter((flag) => isFeatureFlagKey(flag.key))
      .map((flag) => {
        const override = overrides.find((o) => o.flagKey === flag.key);
        return {
          key: flag.key as FeatureFlagKey,
          enabled: override?.enabled ?? flag.defaultEnabled,
          overridden: !!override,
        };
      });
  }

  flags(): Promise<PlatformFeatureFlagList> {
    return this.prisma.asSystem(async (tx) => {
      const [flags, counts] = await Promise.all([
        tx.featureFlag.findMany({ orderBy: { key: 'asc' } }),
        tx.tenantFeatureFlag.groupBy({ by: ['flagKey'], _count: { _all: true } }),
      ]);
      return {
        items: flags
          .filter((flag) => isFeatureFlagKey(flag.key))
          .map((flag) => ({
            key: flag.key as FeatureFlagKey,
            description: flag.description,
            defaultEnabled: flag.defaultEnabled,
            version: flag.version,
            overrides: counts.find((c) => c.flagKey === flag.key)?._count._all ?? 0,
          })),
      };
    });
  }

  /** Changes a flag's default for every business without its own setting. */
  updateFlag(
    principal: PlatformPrincipal,
    key: string,
    input: UpdateFlagInput,
  ): Promise<PlatformFeatureFlagList> {
    return this.prisma
      .asSystem(async (tx) => {
        const flag = isFeatureFlagKey(key)
          ? await tx.featureFlag.findUnique({ where: { key } })
          : null;
        if (!flag) throw AppException.notFound('Feature flag not found');
        const { count } = await tx.featureFlag.updateMany({
          where: { key, version: input.version },
          data: { defaultEnabled: input.defaultEnabled, version: { increment: 1 } },
        });
        if (count === 0) throw versionConflict();
        await this.platformAudit.record(tx, {
          actorUserId: principal.userId,
          action: 'platform.flag_updated',
          entityType: 'feature_flag',
          entityId: key,
          metadata: { from: flag.defaultEnabled, to: input.defaultEnabled },
        });
      })
      .then(() => this.flags());
  }

  /** Sets (or with `enabled: null` removes) a business's own setting for a flag. */
  setTenantFlag(
    principal: PlatformPrincipal,
    tenantId: string,
    key: string,
    input: SetTenantFlagInput,
  ): Promise<TenantFeature[]> {
    return this.prisma.asSystem(async (tx) => {
      if (!isFeatureFlagKey(key) || !(await tx.featureFlag.findUnique({ where: { key } })))
        throw AppException.notFound('Feature flag not found');
      if (!(await tx.tenant.findUnique({ where: { id: tenantId }, select: { id: true } })))
        throw notFound();
      if (input.enabled === null)
        await tx.tenantFeatureFlag.deleteMany({ where: { tenantId, flagKey: key } });
      else
        await tx.tenantFeatureFlag.upsert({
          where: { tenantId_flagKey: { tenantId, flagKey: key } },
          create: { tenantId, flagKey: key, enabled: input.enabled, updatedById: principal.userId },
          update: { enabled: input.enabled, updatedById: principal.userId },
        });
      await this.platformAudit.record(tx, {
        actorUserId: principal.userId,
        action: 'platform.tenant_flag_set',
        tenantId,
        entityType: 'feature_flag',
        entityId: key,
        metadata: { enabled: input.enabled, reason: input.reason },
      });
      return this.tenantFeatures(tx, tenantId);
    });
  }

  /** Blocks every sign-in to the business at once (e.g. abuse); data is kept. */
  suspend(
    principal: PlatformPrincipal,
    id: string,
    input: ReasonInput,
  ): Promise<PlatformTenantSummary> {
    return this.setTenantStatus(principal, id, 'SUSPENDED', input.reason);
  }

  reinstate(
    principal: PlatformPrincipal,
    id: string,
    input: ReasonInput,
  ): Promise<PlatformTenantSummary> {
    return this.setTenantStatus(principal, id, 'ACTIVE', input.reason);
  }

  /** Closes a business for good (data kept for legal retention); the slug must be typed. */
  async close(
    principal: PlatformPrincipal,
    id: string,
    input: CloseInput,
  ): Promise<PlatformTenantSummary> {
    const tenant = await this.prisma.asSystem((tx) =>
      tx.tenant.findUnique({ where: { id }, select: { slug: true } }),
    );
    if (!tenant) throw notFound();
    if (tenant.slug !== input.confirmSlug)
      throw AppException.validation([
        { path: 'confirmSlug', message: 'validation.confirm.mismatch' },
      ]);
    return this.setTenantStatus(principal, id, 'CLOSED', input.reason);
  }

  private setTenantStatus(
    principal: PlatformPrincipal,
    id: string,
    status: 'ACTIVE' | 'SUSPENDED' | 'CLOSED',
    reason: string,
  ): Promise<PlatformTenantSummary> {
    return this.prisma.asSystem(async (tx) => {
      const current = await tx.tenant.findUnique({ where: { id } });
      if (!current) throw notFound();
      if (current.status === 'CLOSED')
        throw new AppException('INVALID_STATE', HttpStatus.CONFLICT, 'This business is closed.');
      if (current.status === status)
        throw new AppException(
          'INVALID_STATE',
          HttpStatus.CONFLICT,
          `The business is already ${status.toLowerCase()}.`,
        );
      await tx.tenant.update({ where: { id }, data: { status } });
      let sessionsRevoked = 0;
      if (status !== 'ACTIVE')
        ({ count: sessionsRevoked } = await tx.session.updateMany({
          where: { revokedAt: null, membership: { tenantId: id } },
          data: { revokedAt: new Date(), revokedReason: 'ADMIN' },
        }));
      const action =
        status === 'SUSPENDED'
          ? ('platform.tenant_suspended' as const)
          : status === 'ACTIVE'
            ? ('platform.tenant_reinstated' as const)
            : ('platform.tenant_closed' as const);
      await this.platformAudit.record(tx, {
        actorUserId: principal.userId,
        action,
        tenantId: id,
        entityType: 'tenant',
        entityId: id,
        metadata: { reason, from: current.status, sessionsRevoked },
      });
      await this.tenantAudit.record(tx, {
        tenantId: id,
        actorUserId: null,
        action:
          status === 'SUSPENDED'
            ? 'support.tenant_suspended'
            : status === 'ACTIVE'
              ? 'support.tenant_reinstated'
              : 'support.tenant_closed',
        entityType: 'tenant',
        entityId: id,
        metadata: { reason },
      });
      return toSummary(
        await tx.tenant.findUniqueOrThrow({ where: { id }, include: tenantInclude }),
      );
    });
  }

  /**
   * Gives a business extra days: a longer trial, a longer paid period, or — if it
   * has lapsed — an active period starting now. Used for support and goodwill.
   */
  extend(
    principal: PlatformPrincipal,
    id: string,
    input: ExtendInput,
  ): Promise<PlatformTenantSummary> {
    return this.prisma.asSystem(async (tx) => {
      const sub = await this.lockSubscription(tx, id);
      const now = new Date();
      let data: Prisma.SubscriptionUpdateInput;
      if (sub.status === 'TRIALING' && sub.trialEndsAt) {
        data = { trialEndsAt: addDays(sub.trialEndsAt > now ? sub.trialEndsAt : now, input.days) };
      } else if (sub.status === 'ACTIVE' && sub.currentPeriodEnd) {
        data = { currentPeriodEnd: addDays(sub.currentPeriodEnd, input.days) };
      } else {
        data = {
          status: 'ACTIVE',
          currentPeriodStart: now,
          currentPeriodEnd: addDays(now, input.days),
          graceEndsAt: null,
          cancelAtPeriodEnd: false,
        };
      }
      await tx.subscription.update({
        where: { tenantId: id },
        data: { ...data, remindedFor: null, version: { increment: 1 } },
      });
      await this.platformAudit.record(tx, {
        actorUserId: principal.userId,
        action: 'platform.subscription_extended',
        tenantId: id,
        entityType: 'subscription',
        entityId: id,
        metadata: { days: input.days, reason: input.reason, from: sub.status },
      });
      await this.tenantAudit.record(tx, {
        tenantId: id,
        actorUserId: null,
        action: 'support.subscription_extended',
        entityType: 'subscription',
        entityId: id,
        metadata: { days: input.days },
      });
      return toSummary(
        await tx.tenant.findUniqueOrThrow({ where: { id }, include: tenantInclude }),
      );
    });
  }

  /** Moves a business to another plan without payment (e.g. an agreed deal). */
  changePlan(
    principal: PlatformPrincipal,
    id: string,
    input: ChangePlanInput,
  ): Promise<PlatformTenantSummary> {
    return this.prisma.asSystem(async (tx) => {
      const sub = await this.lockSubscription(tx, id);
      const plan = await this.findPlan(tx, input.planCode);
      const over = exceededLimits(planLimits(plan), await this.entitlements.usage(tx, id));
      if (over.length > 0)
        throw AppException.validation(
          over.map((resource) => ({
            path: 'planCode',
            message: `validation.plan.too_many_${resource}`,
          })),
        );
      await tx.subscription.update({
        where: { tenantId: id },
        data: { planId: plan.id, version: { increment: 1 } },
      });
      const fromPlan = await tx.plan.findUniqueOrThrow({
        where: { id: sub.planId },
        select: { code: true },
      });
      await this.platformAudit.record(tx, {
        actorUserId: principal.userId,
        action: 'platform.plan_changed',
        tenantId: id,
        entityType: 'subscription',
        entityId: id,
        metadata: { from: fromPlan.code, to: plan.code, reason: input.reason },
      });
      await this.tenantAudit.record(tx, {
        tenantId: id,
        actorUserId: null,
        action: 'support.plan_changed',
        entityType: 'subscription',
        entityId: id,
        metadata: { from: fromPlan.code, to: plan.code },
      });
      return toSummary(
        await tx.tenant.findUniqueOrThrow({ where: { id }, include: tenantInclude }),
      );
    });
  }

  /**
   * Records a payment received outside the provider (bank transfer, cash): a paid
   * invoice for one period, applied exactly like a provider payment.
   */
  async recordPayment(
    principal: PlatformPrincipal,
    id: string,
    input: ManualPaymentInput,
  ): Promise<PlatformTenantDetail> {
    const messages = await this.prisma.asSystem(async (tx) => {
      const tenant = await tx.tenant.findUnique({ where: { id }, select: { status: true } });
      if (!tenant) throw notFound();
      const plan = await this.findPlan(tx, input.planCode);
      // The reference is a provider payment id for MANUAL: the same transfer cannot be recorded twice.
      const duplicate = await tx.billingInvoice.findFirst({
        where: { tenantId: id, provider: 'MANUAL', providerPaymentId: input.reference },
        select: { id: true },
      });
      if (duplicate)
        throw AppException.validation([
          { path: 'reference', message: 'validation.payment.duplicate_reference' },
        ]);
      const totals = invoiceTotals(input.amountMinor, 0);
      const invoice = await tx.billingInvoice.create({
        data: {
          tenantId: id,
          number: await nextDocumentNumber(tx, id, 'billing_invoice'),
          planId: plan.id,
          interval: input.interval,
          ...totals,
          taxRateBp: 0,
          currency: plan.currency,
          provider: 'MANUAL',
          createdById: principal.userId,
        },
        include: { plan: true },
      });
      const sent = await this.billing.markPaid(tx, invoice, input.reference, new Date());
      if (!sent) throw notFound();
      await this.platformAudit.record(tx, {
        actorUserId: principal.userId,
        action: 'platform.payment_recorded',
        tenantId: id,
        entityType: 'billing_invoice',
        entityId: invoice.id,
        metadata: {
          plan: plan.code,
          interval: input.interval,
          amountMinor: input.amountMinor,
          reference: input.reference,
          reason: input.reason,
        },
      });
      await this.tenantAudit.record(tx, {
        tenantId: id,
        actorUserId: null,
        action: 'support.payment_recorded',
        entityType: 'billing_invoice',
        entityId: invoice.id,
        metadata: { amountMinor: input.amountMinor },
      });
      return sent;
    });
    for (const message of messages) this.billing.send(message);
    return this.tenant(principal, id);
  }

  plans(): Promise<PlatformPlanList> {
    return this.prisma.asSystem(async (tx) => {
      const [plans, counts] = await Promise.all([
        tx.plan.findMany({ orderBy: [{ sortOrder: 'asc' }, { code: 'asc' }] }),
        tx.subscription.groupBy({ by: ['planId'], _count: { _all: true } }),
      ]);
      return {
        items: plans.map((plan) => ({
          ...toPlan(plan),
          isPublic: plan.isPublic,
          sortOrder: plan.sortOrder,
          version: plan.version,
          subscribers: counts.find((c) => c.planId === plan.id)?._count._all ?? 0,
        })),
      };
    });
  }

  async createPlan(principal: PlatformPrincipal, input: CreatePlanInput): Promise<PlatformPlan> {
    try {
      return await this.prisma.asSystem(async (tx) => {
        const plan = await tx.plan.create({
          data: {
            code: input.code,
            name: input.name,
            priceMonthlyMinor: input.priceMonthlyMinor,
            priceYearlyMinor: input.priceYearlyMinor,
            currency: input.currency,
            maxBranches: input.limits.branches,
            maxRegisters: input.limits.registers,
            maxStaff: input.limits.staff,
            maxDevices: input.limits.devices,
            isPublic: input.isPublic,
            sortOrder: input.sortOrder,
          },
        });
        await this.platformAudit.record(tx, {
          actorUserId: principal.userId,
          action: 'platform.plan_created',
          entityType: 'plan',
          entityId: plan.id,
          metadata: { code: plan.code, input: { ...input } as Prisma.InputJsonValue },
        });
        return {
          ...toPlan(plan),
          isPublic: plan.isPublic,
          sortOrder: plan.sortOrder,
          version: plan.version,
          subscribers: 0,
        };
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')
        throw new AppException(
          'DUPLICATE_CODE',
          HttpStatus.CONFLICT,
          'A plan with this code exists.',
        );
      throw error;
    }
  }

  /**
   * Edits a plan. Price changes apply to the next checkout; existing paid periods
   * are not re-priced. Lower limits stop businesses above them adding more, but
   * never remove anything they already have.
   */
  updatePlan(
    principal: PlatformPrincipal,
    code: string,
    input: UpdatePlanInput,
  ): Promise<PlatformPlan> {
    return this.prisma.asSystem(async (tx) => {
      const current = await tx.plan.findUnique({ where: { code: code.toUpperCase() } });
      if (!current) throw AppException.notFound('Plan not found');
      if (current.version !== input.version) throw versionConflict();
      const { count } = await tx.plan.updateMany({
        where: { id: current.id, version: input.version },
        data: {
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.priceMonthlyMinor !== undefined
            ? { priceMonthlyMinor: input.priceMonthlyMinor }
            : {}),
          ...(input.priceYearlyMinor !== undefined
            ? { priceYearlyMinor: input.priceYearlyMinor }
            : {}),
          ...(input.limits
            ? {
                maxBranches: input.limits.branches,
                maxRegisters: input.limits.registers,
                maxStaff: input.limits.staff,
                maxDevices: input.limits.devices,
              }
            : {}),
          ...(input.isPublic !== undefined ? { isPublic: input.isPublic } : {}),
          ...(input.sortOrder !== undefined ? { sortOrder: input.sortOrder } : {}),
          version: { increment: 1 },
        },
      });
      if (count === 0) throw versionConflict();
      const { version: _version, ...changes } = input;
      await this.platformAudit.record(tx, {
        actorUserId: principal.userId,
        action: 'platform.plan_updated',
        entityType: 'plan',
        entityId: current.id,
        metadata: {
          code,
          before: {
            name: current.name,
            priceMonthlyMinor: current.priceMonthlyMinor,
            priceYearlyMinor: current.priceYearlyMinor,
            limits: planLimits(current),
            isPublic: current.isPublic,
          },
          changes: changes as Prisma.InputJsonValue,
        },
      });
      const plan = await tx.plan.findUniqueOrThrow({ where: { id: current.id } });
      const subscribers = await tx.subscription.count({ where: { planId: plan.id } });
      return {
        ...toPlan(plan),
        isPublic: plan.isPublic,
        sortOrder: plan.sortOrder,
        version: plan.version,
        subscribers,
      };
    });
  }

  audit(query: AuditQuery): Promise<PlatformAuditPage> {
    return this.prisma.asSystem(async (tx) => {
      const rows = await tx.platformAuditLog.findMany({
        where: query.tenantId ? { tenantId: query.tenantId } : {},
        include: { actor: { select: { email: true } } },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: query.limit + 1,
        ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
      });
      const page = rows.slice(0, query.limit);
      const tenantIds = [...new Set(page.map((r) => r.tenantId).filter((t): t is string => !!t))];
      const tenants = await tx.tenant.findMany({
        where: { id: { in: tenantIds } },
        select: { id: true, name: true },
      });
      return {
        items: page.map((row) => ({
          id: row.id,
          action: row.action,
          actorEmail: row.actor?.email ?? null,
          tenantId: row.tenantId,
          tenantName: tenants.find((t) => t.id === row.tenantId)?.name ?? null,
          entityType: row.entityType,
          entityId: row.entityId,
          metadata: row.metadata,
          ip: row.ip,
          createdAt: row.createdAt.toISOString(),
        })),
        nextCursor: rows.length > query.limit ? (page.at(-1)?.id ?? null) : null,
      };
    });
  }

  private async lockSubscription(tx: Tx, tenantId: string) {
    const rows = await tx.$queryRaw<Array<{ tenant_id: string }>>`
      SELECT tenant_id FROM subscriptions WHERE tenant_id = ${tenantId}::uuid FOR UPDATE`;
    if (rows.length === 0) throw notFound();
    return tx.subscription.findUniqueOrThrow({ where: { tenantId } });
  }

  private async findPlan(tx: Tx, code: string) {
    const plan = await tx.plan.findUnique({ where: { code: code.toUpperCase() } });
    if (!plan)
      throw AppException.validation([{ path: 'planCode', message: 'validation.plan.not_found' }]);
    return plan;
  }
}
