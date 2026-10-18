import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import { isSriLankanMobile, personalise, smsLength, smsOptOutLine } from '@pos/domain';
import { APP_CONFIG, type AppConfig } from '../config/app-config';
import { Mailer } from '../mail/mailer';
import { campaignEmail } from '../mail/templates';
import { FeatureFlags } from '../notifications/feature-flags.service';
import { PrismaService, type Tx } from '../prisma/prisma.service';
import { MessagingService } from './messaging.service';
import { SmsSender } from './sms-sender';

const MAX_ATTEMPTS = 3;

type Outcome =
  | { status: 'SENT' }
  | { status: 'SKIPPED'; reason: string }
  | { status: 'RETRY' | 'FAILED'; reason: string };

/**
 * Sends queued customer messages a batch at a time. Each delivery is locked
 * (FOR UPDATE SKIP LOCKED) in its own transaction while it is sent, so several
 * API instances never send the same message twice. Consent and the address are
 * checked again just before sending. Temporary failures are retried on later
 * runs, up to three attempts.
 */
@Injectable()
export class MessagingSweep implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(MessagingSweep.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly messaging: MessagingService,
    private readonly flags: FeatureFlags,
    private readonly mailer: Mailer,
    private readonly sms: SmsSender,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  onApplicationBootstrap(): void {
    const seconds = this.config.MESSAGING_SWEEP_SECONDS;
    if (seconds <= 0) return;
    this.timer = setInterval(() => void this.tick(), seconds * 1000);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  private async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      await this.run();
    } catch (error) {
      this.logger.error({ msg: 'messaging sweep failed', error: String(error) });
    } finally {
      this.running = false;
    }
  }

  /** Sends up to one batch. Returns how many deliveries were handled. */
  async run(): Promise<number> {
    const tried: string[] = [];
    while (tried.length < this.config.MESSAGING_BATCH) {
      const handled = await this.prisma.asSystem((tx) => this.sendNext(tx, tried), {
        timeout: 30_000,
      });
      if (!handled) break;
      tried.push(handled);
    }
    await this.prisma.asSystem(
      (tx) =>
        tx.$executeRaw`
        UPDATE message_campaigns c SET status = 'DONE', completed_at = now()
        WHERE c.status = 'SENDING' AND NOT EXISTS (
          SELECT 1 FROM message_deliveries d WHERE d.campaign_id = c.id AND d.status = 'QUEUED')`,
    );
    return tried.length;
  }

  /** Locks, sends and records one queued delivery not yet tried in this run. */
  private async sendNext(tx: Tx, tried: string[]): Promise<string | null> {
    const rows = await tx.$queryRaw<Array<{ id: string; attempts: number }>>`
      SELECT id, attempts FROM message_deliveries
      WHERE status = 'QUEUED' AND NOT (id = ANY(${tried}::uuid[]))
      ORDER BY created_at, id
      LIMIT 1
      FOR UPDATE SKIP LOCKED`;
    const row = rows[0];
    if (!row) return null;
    const delivery = await tx.messageDelivery.findUniqueOrThrow({
      where: { id: row.id },
      include: {
        campaign: true,
        customer: {
          select: {
            name: true,
            email: true,
            phone: true,
            status: true,
            marketingConsentAt: true,
            unsubscribeCode: true,
          },
        },
        tenant: { select: { name: true } },
      },
    });

    const outcome = await this.deliver(tx, delivery);
    const attempts = row.attempts + 1;
    const final =
      outcome.status === 'RETRY' && attempts >= MAX_ATTEMPTS
        ? ({ status: 'FAILED', reason: outcome.reason } as const)
        : outcome;
    await tx.messageDelivery.update({
      where: { id: row.id },
      data: {
        attempts: outcome.status === 'SKIPPED' ? row.attempts : attempts,
        status: final.status === 'RETRY' ? 'QUEUED' : final.status,
        error: final.status === 'SENT' ? null : final.reason,
        sentAt: final.status === 'SENT' ? new Date() : null,
      },
    });
    return row.id;
  }

  private async deliver(
    tx: Tx,
    delivery: {
      tenantId: string;
      channel: 'EMAIL' | 'SMS';
      campaign: { subject: string | null; body: string };
      customer: {
        name: string;
        email: string | null;
        phone: string | null;
        status: string;
        marketingConsentAt: Date | null;
        unsubscribeCode: string;
      };
      tenant: { name: string };
    },
  ): Promise<Outcome> {
    const { customer, campaign } = delivery;
    if (!customer.marketingConsentAt || customer.status !== 'ACTIVE')
      return { status: 'SKIPPED', reason: 'consent_withdrawn' };
    if (!(await this.flags.isEnabled(tx, delivery.tenantId, 'messaging')))
      return { status: 'SKIPPED', reason: 'messaging_off' };

    const body = personalise(campaign.body, customer.name);
    const optOut = this.messaging.unsubscribeUrl(customer.unsubscribeCode);
    if (delivery.channel === 'EMAIL') {
      if (!customer.email) return { status: 'SKIPPED', reason: 'no_address' };
      try {
        await this.mailer.send(
          campaignEmail({
            to: customer.email,
            subject: campaign.subject ?? delivery.tenant.name,
            body,
            businessName: delivery.tenant.name,
            unsubscribeUrl: optOut,
          }),
        );
        return { status: 'SENT' };
      } catch (error) {
        this.logger.warn({ msg: 'campaign email failed', error: String(error) });
        return { status: 'RETRY', reason: 'email_failed' };
      }
    }

    if (!customer.phone || !isSriLankanMobile(customer.phone))
      return { status: 'SKIPPED', reason: 'no_address' };
    const text = `${body}${smsOptOutLine(optOut)}`;
    const result = await this.sms.send(customer.phone, text, smsLength(text).unicode);
    if (result.ok) return { status: 'SENT' };
    return { status: result.retry ? 'RETRY' : 'FAILED', reason: result.reason };
  }
}
