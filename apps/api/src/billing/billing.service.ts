import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import type {
  BillingOverview,
  CheckoutResponse,
  checkoutRequestSchema,
  Subscription,
} from '@pos/contracts';
import { addInterval, exceededLimits, invoiceTotals, paidPeriodStart } from '@pos/domain';
import { Prisma } from '@prisma/client';
import type { z } from 'zod';
import { AuditService } from '../audit/audit.service';
import { API_PREFIX } from '../bootstrap';
import { AppException } from '../common/app-exception';
import { versionConflict } from '../common/optimistic';
import type { AuthPrincipal } from '../common/request-context';
import { APP_CONFIG, type AppConfig } from '../config/app-config';
import { nextDocumentNumber } from '../inventory/inventory-helpers';
import { Mailer } from '../mail/mailer';
import { billingNoticeEmail } from '../mail/templates';
import { PrismaService, type Tx } from '../prisma/prisma.service';
import { toBillingInvoice, toPlan, toSubscription } from './billing.mapper';
import { Entitlements, planLimits } from './entitlements';
import {
  InvalidNotificationError,
  minorToDecimal,
  type PaymentNotification,
  PaymentProvider,
} from './payment-provider';

type CheckoutInput = z.output<typeof checkoutRequestSchema>;

const paymentsUnavailable = () =>
  new AppException(
    'PAYMENTS_UNAVAILABLE',
    HttpStatus.SERVICE_UNAVAILABLE,
    'Online payment is not available right now. Please contact support.',
  );

/** Active owners' addresses, for billing notices. */
export async function ownerEmails(tx: Tx, tenantId: string): Promise<string[]> {
  const owners = await tx.membership.findMany({
    where: { tenantId, role: 'OWNER', status: 'ACTIVE', user: { status: 'ACTIVE' } },
    select: { user: { select: { email: true } } },
  });
  return owners.map((o) => o.user.email);
}

/**
 * The business's subscription: overview, paying for a period through the
 * provider's hosted checkout, cancelling at period end, and applying verified
 * payment notifications exactly once.
 */
@Injectable()
export class BillingService {
  private readonly logger = new Logger(BillingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly entitlements: Entitlements,
    private readonly provider: PaymentProvider,
    private readonly mailer: Mailer,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  overview(principal: AuthPrincipal): Promise<BillingOverview> {
    const tenantId = principal.tenantId;
    return this.prisma.withTenant(tenantId, async (tx) => {
      const subscription = await tx.subscription.findUniqueOrThrow({
        where: { tenantId },
        include: { plan: true },
      });
      const [usage, plans, invoices, user] = await Promise.all([
        this.entitlements.usage(tx, tenantId),
        tx.plan.findMany({ where: { isPublic: true }, orderBy: { sortOrder: 'asc' } }),
        tx.billingInvoice.findMany({
          where: { tenantId, status: { not: 'VOID' } },
          include: { plan: { select: { name: true } } },
          orderBy: { createdAt: 'desc' },
          take: 24,
        }),
        tx.user.findUniqueOrThrow({
          where: { id: principal.userId },
          select: { emailVerifiedAt: true },
        }),
      ]);
      return {
        subscription: toSubscription(subscription),
        usage,
        plans: plans.map(toPlan),
        invoices: invoices.map(toBillingInvoice),
        paymentsAvailable: this.provider.isConfigured(),
        emailVerified: user.emailVerifiedAt !== null,
      };
    });
  }

  /** Opens an invoice for one period of a plan and returns the hosted checkout to send the browser to. */
  async checkout(principal: AuthPrincipal, input: CheckoutInput): Promise<CheckoutResponse> {
    if (!this.provider.isConfigured()) throw paymentsUnavailable();
    const tenantId = principal.tenantId;
    const prepared = await this.prisma.withTenant(tenantId, async (tx) => {
      const user = await tx.user.findUniqueOrThrow({
        where: { id: principal.userId },
        select: { email: true, fullName: true, emailVerifiedAt: true },
      });
      if (!user.emailVerifiedAt)
        throw new AppException(
          'EMAIL_NOT_VERIFIED',
          HttpStatus.FORBIDDEN,
          'Confirm your email address before paying.',
        );
      const plan = await tx.plan.findFirst({ where: { code: input.planCode, isPublic: true } });
      if (!plan)
        throw AppException.validation([{ path: 'planCode', message: 'validation.plan.not_found' }]);

      // Lock the subscription so two checkouts cannot both open an invoice.
      await tx.$queryRaw`SELECT 1 FROM subscriptions WHERE tenant_id = ${tenantId}::uuid FOR UPDATE`;
      const usage = await this.entitlements.usage(tx, tenantId);
      const over = exceededLimits(planLimits(plan), usage);
      if (over.length > 0)
        throw AppException.validation(
          over.map((resource) => ({
            path: 'planCode',
            message: `validation.plan.too_many_${resource}`,
          })),
        );

      // Only the newest checkout can be paid... unless an older one is paid anyway;
      // a payment for a replaced invoice is still honoured (see applyNotification).
      await tx.billingInvoice.updateMany({
        where: { tenantId, status: 'OPEN' },
        data: { status: 'VOID' },
      });
      const price = input.interval === 'YEAR' ? plan.priceYearlyMinor : plan.priceMonthlyMinor;
      const totals = invoiceTotals(price, this.config.BILLING_TAX_RATE_BP);
      const invoice = await tx.billingInvoice.create({
        data: {
          tenantId,
          number: await nextDocumentNumber(tx, tenantId, 'billing_invoice'),
          planId: plan.id,
          interval: input.interval,
          ...totals,
          taxRateBp: this.config.BILLING_TAX_RATE_BP,
          currency: plan.currency,
          provider: this.provider.name,
          createdById: principal.userId,
        },
        include: { plan: { select: { name: true } } },
      });
      await this.audit.record(tx, {
        tenantId,
        action: 'billing.checkout_started',
        entityType: 'billing_invoice',
        entityId: invoice.id,
        metadata: { plan: plan.code, interval: input.interval, totalMinor: totals.totalMinor },
      });
      const tenant = await tx.tenant.findUniqueOrThrow({
        where: { id: tenantId },
        select: { name: true, contactPhone: true },
      });
      const settings = await tx.tenantSettings.findUnique({
        where: { tenantId },
        select: { addressLine1: true, city: true, country: true },
      });
      return { invoice, plan, user, tenant, settings };
    });

    const { invoice, plan, user, tenant, settings } = prepared;
    const [firstName, ...rest] = user.fullName.trim().split(/\s+/);
    const web = this.config.WEB_APP_URL;
    const redirect = this.provider.checkout({
      invoiceId: invoice.id,
      description: `${plan.name} plan (${input.interval === 'YEAR' ? '1 year' : '1 month'}) – ${tenant.name}`,
      amountMinor: invoice.totalMinor,
      currency: invoice.currency,
      customer: {
        firstName: firstName ?? user.fullName,
        lastName: rest.join(' ') || (firstName ?? ''),
        email: user.email,
        phone: tenant.contactPhone ?? '',
        address: settings?.addressLine1 ?? '',
        city: settings?.city ?? '',
        country: settings?.country === 'LK' || !settings?.country ? 'Sri Lanka' : settings.country,
      },
      returnUrl: `${web}/settings/billing?checkout=return&invoice=${invoice.id}`,
      cancelUrl: `${web}/settings/billing?checkout=cancelled`,
      notifyUrl: `${this.config.API_PUBLIC_URL}/${API_PREFIX}/billing/webhooks/${this.provider.name.toLowerCase()}`,
    });
    return {
      invoice: toBillingInvoice(invoice),
      redirect: { method: 'POST', url: redirect.url, fields: redirect.fields },
    };
  }

  /** Stops (or resumes) the subscription at the end of the paid period or trial. */
  setCancelAtPeriodEnd(
    principal: AuthPrincipal,
    version: number,
    cancel: boolean,
  ): Promise<Subscription> {
    const tenantId = principal.tenantId;
    return this.prisma.withTenant(tenantId, async (tx) => {
      const current = await tx.subscription.findUniqueOrThrow({ where: { tenantId } });
      if (current.version !== version) throw versionConflict();
      if (!['TRIALING', 'ACTIVE', 'PAST_DUE'].includes(current.status))
        throw new AppException(
          'INVALID_STATE',
          HttpStatus.CONFLICT,
          'This subscription has already ended. Choose a plan to start again.',
        );
      const { count } = await tx.subscription.updateMany({
        where: { tenantId, version },
        data: { cancelAtPeriodEnd: cancel, version: { increment: 1 } },
      });
      if (count === 0) throw versionConflict();
      await this.audit.record(tx, {
        tenantId,
        action: cancel ? 'billing.cancel_scheduled' : 'billing.resumed',
        entityType: 'subscription',
        entityId: tenantId,
      });
      return toSubscription(
        await tx.subscription.findUniqueOrThrow({ where: { tenantId }, include: { plan: true } }),
      );
    });
  }

  /**
   * Applies a provider notification. Unknown invoices are rejected; repeats of the
   * same event are acknowledged without effect; amounts must match the invoice.
   */
  async applyNotification(body: Record<string, unknown>): Promise<void> {
    const notification = this.provider.parseNotification(body);
    const notices = await this.prisma.asSystem(async (tx) => {
      const invoice = await tx.billingInvoice.findUnique({
        where: { id: notification.invoiceId },
        include: { plan: true },
      });
      if (!invoice || invoice.provider !== notification.provider)
        throw new InvalidNotificationError('unknown invoice');
      const matches =
        notification.amountMinor === invoice.totalMinor &&
        notification.currency === invoice.currency;

      try {
        await tx.paymentEvent.create({
          data: {
            tenantId: invoice.tenantId,
            invoiceId: invoice.id,
            provider: notification.provider,
            providerEventId: notification.eventId,
            outcome: matches ? notification.outcome : 'REJECTED',
            amountMinor: notification.amountMinor,
            currency: notification.currency.slice(0, 3),
            method: notification.method,
          },
        });
      } catch (error) {
        // Providers retry notifications: the same event is applied once.
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')
          return [];
        throw error;
      }

      if (!matches) {
        this.logger.warn({ msg: 'payment amount mismatch', invoiceId: invoice.id });
        await this.audit.record(tx, {
          tenantId: invoice.tenantId,
          actorUserId: null,
          action: 'billing.payment_failed',
          entityType: 'billing_invoice',
          entityId: invoice.id,
          metadata: { reason: 'amount_mismatch', paymentId: notification.paymentId },
        });
        return [];
      }
      return this.applyOutcome(tx, invoice, notification);
    });
    for (const notice of notices) this.send(notice);
  }

  private async applyOutcome(
    tx: Tx,
    invoice: Prisma.BillingInvoiceGetPayload<{ include: { plan: true } }>,
    notification: PaymentNotification,
  ): Promise<Array<Parameters<Mailer['send']>[0]>> {
    const tenantId = invoice.tenantId;
    const base = {
      tenantId,
      actorUserId: null,
      entityType: 'billing_invoice',
      entityId: invoice.id,
    } as const;
    switch (notification.outcome) {
      case 'PENDING':
        return [];
      case 'FAILED':
      case 'CANCELLED':
        await this.audit.record(tx, {
          ...base,
          action: 'billing.payment_failed',
          metadata: { outcome: notification.outcome, paymentId: notification.paymentId },
        });
        return [];
      case 'CHARGEBACK': {
        // Money taken back: the business loses paid access at once.
        await tx.subscription.update({
          where: { tenantId },
          data: { status: 'SUSPENDED', graceEndsAt: new Date(), version: { increment: 1 } },
        });
        await this.audit.record(tx, {
          ...base,
          action: 'billing.chargeback',
          metadata: { paymentId: notification.paymentId },
        });
        return [];
      }
      case 'PAID': {
        if (invoice.status === 'PAID') return [];
        const messages = await this.markPaid(tx, invoice, notification.paymentId, new Date());
        if (!messages) throw new InvalidNotificationError('no subscription');
        return messages;
      }
    }
  }

  /**
   * Marks an invoice paid and starts its period: the one path for provider
   * payments and payments recorded by platform staff. Returns the receipt e-mails
   * to send after commit, or null when the business has no subscription.
   */
  async markPaid(
    tx: Tx,
    invoice: Prisma.BillingInvoiceGetPayload<{ include: { plan: true } }>,
    paymentReference: string,
    now: Date,
  ): Promise<Array<Parameters<Mailer['send']>[0]> | null> {
    const tenantId = invoice.tenantId;
    const rows = await tx.$queryRaw<Array<{ tenant_id: string }>>`
      SELECT tenant_id FROM subscriptions WHERE tenant_id = ${tenantId}::uuid FOR UPDATE`;
    if (rows.length === 0) return null;
    const current = await tx.subscription.findUniqueOrThrow({ where: { tenantId } });
    const start = paidPeriodStart(current, current.planId === invoice.planId, now);
    const end = addInterval(start, invoice.interval);
    await tx.billingInvoice.update({
      where: { id: invoice.id },
      data: {
        status: 'PAID',
        paidAt: now,
        providerPaymentId: paymentReference.slice(0, 64),
        periodStart: start,
        periodEnd: end,
      },
    });
    await tx.subscription.update({
      where: { tenantId },
      data: {
        planId: invoice.planId,
        interval: invoice.interval,
        status: 'ACTIVE',
        currentPeriodStart: start,
        currentPeriodEnd: end,
        graceEndsAt: null,
        cancelAtPeriodEnd: false,
        remindedFor: null,
        version: { increment: 1 },
      },
    });
    await this.audit.record(tx, {
      tenantId,
      actorUserId: null,
      entityType: 'billing_invoice',
      entityId: invoice.id,
      action: 'billing.payment_received',
      metadata: {
        plan: invoice.plan.code,
        totalMinor: invoice.totalMinor,
        periodEnd: end.toISOString(),
        provider: invoice.provider,
      },
    });
    const amount = `${invoice.currency} ${minorToDecimal(invoice.totalMinor)}`;
    return (await ownerEmails(tx, tenantId)).map((to) =>
      billingNoticeEmail({
        to,
        subject: `Payment received – invoice ${invoice.number}`,
        paragraphs: [
          `Thank you. We received ${amount} for the ${invoice.plan.name} plan.`,
          `Your subscription is paid until ${end.toISOString().slice(0, 10)}.`,
        ],
        actionUrl: `${this.config.WEB_APP_URL}/settings/billing`,
        actionLabel: 'View billing',
      }),
    );
  }

  /** Sends billing e-mails without blocking or failing the caller. */
  send(message: Parameters<Mailer['send']>[0]): void {
    this.mailer.send(message).catch((error: unknown) =>
      this.logger.error({
        msg: 'billing email failed',
        subject: message.subject,
        error: String(error),
      }),
    );
  }
}
