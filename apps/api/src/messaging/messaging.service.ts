import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import type { MessageCampaign } from '@prisma/client';
import type {
  Campaign,
  CampaignPage,
  ConsentHistory,
  createCampaignRequestSchema,
  MessagingStatus,
  UnsubscribeInfo,
} from '@pos/contracts';
import { NAME_PLACEHOLDER, smsOptOutLine, SMS_MAX_CHARS } from '@pos/domain';
import type { z } from 'zod';
import { AuditService } from '../audit/audit.service';
import { AppException } from '../common/app-exception';
import { APP_CONFIG, type AppConfig } from '../config/app-config';
import { recordConsent } from '../customers/consent';
import { FeatureFlags } from '../notifications/feature-flags.service';
import { PrismaService, type Tx } from '../prisma/prisma.service';
import { SmsSender } from './sms-sender';

type CreateInput = z.output<typeof createCampaignRequestSchema>;
type Channel = 'EMAIL' | 'SMS';

// Longest name the {name} placeholder is allowed for when checking SMS length.
const NAME_ALLOWANCE = 20;

const unavailable = (channel: Channel) =>
  new AppException(
    'MESSAGING_UNAVAILABLE',
    HttpStatus.SERVICE_UNAVAILABLE,
    channel === 'SMS'
      ? 'SMS messages are not available for this business yet.'
      : 'Customer messages are not available for this business.',
  );

/** Who a campaign goes to: active customers who agreed, with a usable address for the channel. */
function audienceWhere(tenantId: string, channel: Channel) {
  return {
    tenantId,
    status: 'ACTIVE' as const,
    marketingConsentAt: { not: null },
    ...(channel === 'EMAIL'
      ? { email: { not: null } }
      : // The gateway delivers to Sri Lankan mobiles (+947XXXXXXXX).
        { phone: { startsWith: '+947' } }),
  };
}

/**
 * Customer messages. A campaign is a message for every customer who agreed to
 * marketing and has an address for the channel at the time it is created; each
 * becomes a queued delivery that MessagingSweep sends, re-checking consent
 * first. Opting out through the link in any message is recorded like any other
 * consent change.
 */
@Injectable()
export class MessagingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly flags: FeatureFlags,
    private readonly sms: SmsSender,
    private readonly audit: AuditService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  unsubscribeUrl(code: string): string {
    return `${this.config.WEB_APP_URL.replace(/\/+$/, '')}/u/${code}`;
  }

  status(tenantId: string): Promise<MessagingStatus> {
    return this.prisma.withTenant(tenantId, async (tx) => {
      const on = await this.flags.isEnabled(tx, tenantId, 'messaging');
      const [email, sms, allowance, used] = await Promise.all([
        tx.customer.count({ where: audienceWhere(tenantId, 'EMAIL') }),
        tx.customer.count({ where: audienceWhere(tenantId, 'SMS') }),
        this.smsAllowance(tx, tenantId, false),
        this.smsUsedThisMonth(tx, tenantId),
      ]);
      return {
        channels: { EMAIL: on, SMS: on && this.sms.available },
        audience: { EMAIL: email, SMS: sms },
        smsAllowance: allowance,
        smsUsedThisMonth: used,
        optOutUrlLength: this.unsubscribeUrl('x'.repeat(12)).length,
      };
    });
  }

  async create(tenantId: string, input: CreateInput, userId: string): Promise<Campaign> {
    const id = await this.prisma.withTenant(tenantId, async (tx) => {
      // Same id again (a retry): the campaign already exists.
      const existing = await tx.messageCampaign.findFirst({ where: { id: input.id, tenantId } });
      if (existing) return existing.id;

      if (!(await this.flags.isEnabled(tx, tenantId, 'messaging'))) throw unavailable('EMAIL');
      if (input.channel === 'SMS' && !this.sms.available) throw unavailable('SMS');

      if (input.channel === 'SMS') {
        const placeholders = input.body.split(NAME_PLACEHOLDER).length - 1;
        const longest =
          input.body.length +
          placeholders * (NAME_ALLOWANCE - NAME_PLACEHOLDER.length) +
          smsOptOutLine(this.unsubscribeUrl('x'.repeat(12))).length;
        if (longest > SMS_MAX_CHARS)
          throw AppException.validation([
            { path: 'body', message: 'validation.message.sms_too_long' },
          ]);
      }

      // Locks the subscription row: concurrent campaigns cannot both use the last SMS.
      const allowance = await this.smsAllowance(tx, tenantId, input.channel === 'SMS');
      const recipients = await tx.customer.findMany({
        where: audienceWhere(tenantId, input.channel),
        select: { id: true },
      });
      if (recipients.length === 0)
        throw AppException.validation([
          { path: 'channel', message: 'validation.message.no_recipients' },
        ]);
      if (input.channel === 'SMS') {
        const used = await this.smsUsedThisMonth(tx, tenantId);
        if (used + recipients.length > allowance)
          throw new AppException(
            'PLAN_LIMIT_REACHED',
            HttpStatus.CONFLICT,
            `This message needs ${recipients.length} SMS; ${Math.max(0, allowance - used)} are left in your plan this month.`,
          );
      }

      await tx.messageCampaign.create({
        data: {
          id: input.id,
          tenantId,
          channel: input.channel,
          subject: input.channel === 'EMAIL' ? (input.subject ?? null) : null,
          body: input.body,
          recipients: recipients.length,
          createdBy: userId,
        },
      });
      await tx.messageDelivery.createMany({
        data: recipients.map((customer) => ({
          tenantId,
          campaignId: input.id,
          customerId: customer.id,
          channel: input.channel,
        })),
      });
      await this.audit.record(tx, {
        tenantId,
        action: 'customer.campaign_created',
        entityType: 'message_campaign',
        entityId: input.id,
        metadata: { channel: input.channel, recipients: recipients.length },
      });
      return input.id;
    });
    return this.get(tenantId, id);
  }

  get(tenantId: string, id: string): Promise<Campaign> {
    return this.prisma.withTenant(tenantId, async (tx) => {
      const row = await tx.messageCampaign.findFirst({ where: { id, tenantId } });
      if (!row) throw AppException.notFound();
      return (await this.toCampaigns(tx, tenantId, [row]))[0]!;
    });
  }

  list(tenantId: string, query: { cursor?: string; limit: number }): Promise<CampaignPage> {
    return this.prisma.withTenant(tenantId, async (tx) => {
      const rows = await tx.messageCampaign.findMany({
        where: { tenantId },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: query.limit + 1,
        ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
      });
      const page = rows.slice(0, query.limit);
      return {
        items: await this.toCampaigns(tx, tenantId, page),
        nextCursor: rows.length > query.limit ? (page.at(-1)?.id ?? null) : null,
      };
    });
  }

  consentHistory(tenantId: string, customerId: string): Promise<ConsentHistory> {
    return this.prisma.withTenant(tenantId, async (tx) => {
      const customer = await tx.customer.findFirst({
        where: { id: customerId, tenantId },
        select: { id: true },
      });
      if (!customer) throw AppException.notFound();
      const rows = await tx.consentEvent.findMany({
        where: { tenantId, customerId },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: 100,
      });
      const names = await this.names(
        tx,
        rows.map((row) => row.actorUserId),
      );
      return {
        items: rows.map((row) => ({
          id: row.id,
          granted: row.granted,
          source: row.source,
          note: row.note,
          actorName: row.actorUserId ? (names.get(row.actorUserId) ?? null) : null,
          createdAt: row.createdAt.toISOString(),
        })),
      };
    });
  }

  /* Opt-out link (no sign-in: the code is the customer's own) */

  async unsubscribeInfo(code: string): Promise<UnsubscribeInfo> {
    const found = await this.findByCode(code);
    return { businessName: found.businessName, subscribed: found.subscribed };
  }

  async unsubscribe(code: string): Promise<UnsubscribeInfo> {
    const found = await this.findByCode(code);
    await this.prisma.withTenant(found.tenantId, async (tx) => {
      const { count } = await tx.customer.updateMany({
        where: {
          id: found.customerId,
          tenantId: found.tenantId,
          marketingConsentAt: { not: null },
        },
        data: { marketingConsentAt: null, version: { increment: 1 } },
      });
      // Already opted out: nothing to record (the link may be opened twice).
      if (count === 0) return;
      await recordConsent(tx, found.tenantId, found.customerId, false, null, 'UNSUBSCRIBE_LINK');
      await tx.messageDelivery.updateMany({
        where: { tenantId: found.tenantId, customerId: found.customerId, status: 'QUEUED' },
        data: { status: 'SKIPPED', error: 'consent_withdrawn' },
      });
      await this.audit.record(tx, {
        tenantId: found.tenantId,
        actorUserId: null,
        action: 'customer.unsubscribed',
        entityType: 'customer',
        entityId: found.customerId,
        metadata: { source: 'UNSUBSCRIBE_LINK' },
      });
    });
    return { businessName: found.businessName, subscribed: false };
  }

  /* Helpers */

  private async findByCode(code: string) {
    // The code is unique across businesses; the lookup runs before any tenant is known.
    const row = await this.prisma.asSystem((tx) =>
      tx.customer.findUnique({
        where: { unsubscribeCode: code },
        select: {
          id: true,
          tenantId: true,
          marketingConsentAt: true,
          tenant: { select: { name: true } },
        },
      }),
    );
    if (!row) throw AppException.notFound();
    return {
      customerId: row.id,
      tenantId: row.tenantId,
      businessName: row.tenant.name,
      subscribed: row.marketingConsentAt !== null,
    };
  }

  /** The plan's monthly SMS; with `lock`, holds the subscription row until the transaction ends. */
  private async smsAllowance(tx: Tx, tenantId: string, lock: boolean): Promise<number> {
    const rows = lock
      ? await tx.$queryRaw<Array<{ sms: number }>>`
          SELECT p.sms_per_month AS sms FROM subscriptions s JOIN plans p ON p.id = s.plan_id
          WHERE s.tenant_id = ${tenantId}::uuid FOR UPDATE OF s`
      : await tx.$queryRaw<Array<{ sms: number }>>`
          SELECT p.sms_per_month AS sms FROM subscriptions s JOIN plans p ON p.id = s.plan_id
          WHERE s.tenant_id = ${tenantId}::uuid`;
    return rows[0]?.sms ?? 0;
  }

  /** SMS queued or sent since the start of this calendar month in the business's time zone. */
  private async smsUsedThisMonth(tx: Tx, tenantId: string): Promise<number> {
    const rows = await tx.$queryRaw<Array<{ used: number }>>`
      SELECT COUNT(*)::int AS used
      FROM message_deliveries d
      JOIN tenant_settings ts ON ts.tenant_id = d.tenant_id
      WHERE d.tenant_id = ${tenantId}::uuid AND d.channel = 'SMS'
        AND d.status IN ('QUEUED', 'SENT')
        AND d.created_at >= (date_trunc('month', now() AT TIME ZONE ts.timezone) AT TIME ZONE ts.timezone)`;
    return rows[0]?.used ?? 0;
  }

  private async toCampaigns(
    tx: Tx,
    tenantId: string,
    rows: MessageCampaign[],
  ): Promise<Campaign[]> {
    if (rows.length === 0) return [];
    const counts = await tx.messageDelivery.groupBy({
      by: ['campaignId', 'status'],
      where: { tenantId, campaignId: { in: rows.map((row) => row.id) } },
      _count: { _all: true },
    });
    const count = (campaignId: string, status: string) =>
      counts.find((c) => c.campaignId === campaignId && c.status === status)?._count._all ?? 0;
    const names = await this.names(
      tx,
      rows.map((row) => row.createdBy),
    );
    return rows.map((row) => ({
      id: row.id,
      channel: row.channel,
      subject: row.subject,
      body: row.body,
      status: row.status,
      recipients: row.recipients,
      queued: count(row.id, 'QUEUED'),
      sent: count(row.id, 'SENT'),
      failed: count(row.id, 'FAILED'),
      skipped: count(row.id, 'SKIPPED'),
      createdByName: row.createdBy ? (names.get(row.createdBy) ?? null) : null,
      createdAt: row.createdAt.toISOString(),
      completedAt: row.completedAt?.toISOString() ?? null,
    }));
  }

  private async names(tx: Tx, ids: Array<string | null>): Promise<Map<string, string>> {
    const wanted = [...new Set(ids.filter((id): id is string => id !== null))];
    if (wanted.length === 0) return new Map();
    const users = await tx.user.findMany({
      where: { id: { in: wanted } },
      select: { id: true, fullName: true },
    });
    return new Map(users.map((user) => [user.id, user.fullName]));
  }
}
