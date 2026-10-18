import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import { addDays, daysLeft, nextTransition } from '@pos/domain';
import { AuditService } from '../audit/audit.service';
import { APP_CONFIG, type AppConfig } from '../config/app-config';
import { Mailer } from '../mail/mailer';
import { billingNoticeEmail } from '../mail/templates';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import { ownerEmails } from './billing.service';

/** Reminder lead times. */
export const TRIAL_REMINDER_DAYS = 3;
export const RENEWAL_REMINDER_DAYS = 7;

type Message = Parameters<Mailer['send']>[0];

/**
 * Moves subscriptions along as time passes: unpaid trials and periods become
 * past due, then suspended (read-only) after the grace period, or cancelled when
 * the owner chose to stop. Also sends one reminder before a trial or paid period
 * ends. Runs on a timer; each subscription is processed in its own transaction
 * with `SKIP LOCKED`, so several API instances can sweep at once safely.
 */
@Injectable()
export class SubscriptionLifecycle implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(SubscriptionLifecycle.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  /** When the last sweep finished (shown in the platform console). */
  lastRunAt: Date | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly mailer: Mailer,
    private readonly notifications: NotificationsService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  onApplicationBootstrap(): void {
    const seconds = this.config.BILLING_SWEEP_SECONDS;
    if (seconds <= 0) return;
    this.timer = setInterval(() => void this.sweep(), seconds * 1000);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  private async sweep(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      await this.run(new Date());
    } catch (error) {
      this.logger.error({ msg: 'subscription sweep failed', error: String(error) });
    } finally {
      this.running = false;
    }
  }

  /** Processes everything due at `now`. Returns how many subscriptions changed or were reminded. */
  async run(now: Date): Promise<{ transitioned: number; reminded: number }> {
    const candidates = await this.prisma.asSystem((tx) =>
      tx.subscription.findMany({
        where: {
          status: { in: ['TRIALING', 'ACTIVE', 'PAST_DUE'] },
          OR: [
            { trialEndsAt: { lte: addDays(now, TRIAL_REMINDER_DAYS) } },
            { currentPeriodEnd: { lte: addDays(now, RENEWAL_REMINDER_DAYS) } },
            { graceEndsAt: { lte: now } },
          ],
        },
        select: { tenantId: true },
      }),
    );
    let transitioned = 0;
    let reminded = 0;
    for (const { tenantId } of candidates) {
      const result = await this.process(tenantId, now);
      if (result === 'transitioned') transitioned += 1;
      if (result === 'reminded') reminded += 1;
    }
    this.lastRunAt = new Date();
    return { transitioned, reminded };
  }

  private async process(tenantId: string, now: Date): Promise<'transitioned' | 'reminded' | null> {
    const outcome = await this.prisma.asSystem(async (tx) => {
      const locked = await tx.$queryRaw<Array<{ tenant_id: string }>>`
        SELECT tenant_id FROM subscriptions WHERE tenant_id = ${tenantId}::uuid
        FOR UPDATE SKIP LOCKED`;
      if (locked.length === 0) return null;
      const sub = await tx.subscription.findUniqueOrThrow({
        where: { tenantId },
        include: { plan: { select: { name: true } }, tenant: { select: { name: true } } },
      });
      const billingUrl = `${this.config.WEB_APP_URL}/settings/billing`;
      const owners = await ownerEmails(tx, tenantId);
      const notice = (subject: string, paragraphs: string[], actionLabel: string): Message[] =>
        owners.map((to) =>
          billingNoticeEmail({ to, subject, paragraphs, actionUrl: billingUrl, actionLabel }),
        );

      const transition = nextTransition(sub, now, this.config.GRACE_DAYS);
      if (transition) {
        await tx.subscription.update({
          where: { tenantId },
          data: {
            status: transition.status,
            graceEndsAt: transition.graceEndsAt,
            version: { increment: 1 },
          },
        });
        const action =
          transition.status === 'PAST_DUE'
            ? 'subscription.past_due'
            : transition.status === 'SUSPENDED'
              ? 'subscription.suspended'
              : 'subscription.cancelled';
        await this.audit.record(tx, {
          tenantId,
          actorUserId: null,
          action,
          entityType: 'subscription',
          entityId: tenantId,
          metadata: {
            from: sub.status,
            graceEndsAt: transition.graceEndsAt?.toISOString() ?? null,
          },
        });
        // Also in the owners' notification list, so it is seen without e-mail.
        const owners = await this.notifications.recipients(tx, tenantId, 'billing.manage');
        await this.notifications.notify(
          tx,
          owners.map((owner) => ({
            tenantId,
            userId: owner.userId,
            kind: 'SUBSCRIPTION' as const,
            dedupeKey: `subscription:${transition.status}:${now.toISOString().slice(0, 10)}`,
            data: {
              status: transition.status,
              graceEndsAt: transition.graceEndsAt?.toISOString() ?? null,
            },
            link: '/settings/billing',
          })),
        );
        const business = sub.tenant.name;
        const messages =
          transition.status === 'PAST_DUE'
            ? notice(
                `Payment needed for ${business}`,
                [
                  sub.status === 'TRIALING'
                    ? `The free trial for ${business} has ended.`
                    : `The paid period for ${business} has ended.`,
                  `Everything keeps working until ${transition.graceEndsAt!.toISOString().slice(0, 10)}. ` +
                    'After that the account becomes read-only until a plan is paid.',
                ],
                'Choose a plan',
              )
            : transition.status === 'SUSPENDED'
              ? notice(
                  `${business} is now read-only`,
                  [
                    `No payment was received for ${business}, so the account is read-only: ` +
                      'you can still see your data and reports, but cannot sell or make changes.',
                    'Pay for a plan to continue straight away. Nothing has been deleted.',
                  ],
                  'Pay now',
                )
              : notice(
                  `${business} subscription has ended`,
                  [
                    `As requested, the ${sub.plan.name} subscription for ${business} has ended and the account is read-only.`,
                    'Choose a plan at any time to continue. Nothing has been deleted.',
                  ],
                  'Choose a plan',
                );
        return { result: 'transitioned' as const, messages };
      }

      // One reminder before the trial or paid period ends.
      const due =
        sub.status === 'TRIALING' && sub.trialEndsAt && !sub.cancelAtPeriodEnd
          ? sub.trialEndsAt
          : sub.status === 'ACTIVE' && sub.currentPeriodEnd && !sub.cancelAtPeriodEnd
            ? sub.currentPeriodEnd
            : null;
      const lead = sub.status === 'TRIALING' ? TRIAL_REMINDER_DAYS : RENEWAL_REMINDER_DAYS;
      if (!due || due > addDays(now, lead) || sub.remindedFor?.getTime() === due.getTime())
        return null;
      await tx.subscription.update({ where: { tenantId }, data: { remindedFor: due } });
      const days = daysLeft(due, now);
      const messages =
        sub.status === 'TRIALING'
          ? notice(
              `Your free trial ends in ${days} day${days === 1 ? '' : 's'}`,
              [
                `The free trial for ${sub.tenant.name} ends on ${due.toISOString().slice(0, 10)}.`,
                'Choose a plan to keep selling without interruption. Trial days left are kept when you pay early.',
              ],
              'Choose a plan',
            )
          : notice(
              `Your ${sub.plan.name} plan renews in ${days} day${days === 1 ? '' : 's'}`,
              [
                `The paid period for ${sub.tenant.name} ends on ${due.toISOString().slice(0, 10)}.`,
                'Pay for the next period now; paying early does not shorten the current one.',
              ],
              'Pay for next period',
            );
      return { result: 'reminded' as const, messages };
    });
    if (!outcome) return null;
    for (const message of outcome.messages)
      this.mailer
        .send(message)
        .catch((error: unknown) =>
          this.logger.error({ msg: 'billing email failed', tenantId, error: String(error) }),
        );
    return outcome.result;
  }
}
