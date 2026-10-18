import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import {
  EXPIRY_ALERT_DAYS,
  isDailyRunDue,
  NOTIFICATION_RETENTION_DAYS,
  previousDate,
} from '@pos/domain';
import { APP_CONFIG, type AppConfig } from '../config/app-config';
import { Mailer } from '../mail/mailer';
import { digestEmail } from '../mail/templates';
import { PrismaService, type Tx } from '../prisma/prisma.service';
import { FeatureFlags } from './feature-flags.service';
import { type NewNotification, NotificationsService } from './notifications.service';

type Message = Parameters<Mailer['send']>[0];

interface DueTenant {
  id: string;
  name: string;
  currency: string;
  local_date: string;
  local_hour: number;
}

interface BranchAlert {
  branch_id: string;
  branch_name: string;
  low: number;
  expiring: number;
  low_examples: string[] | null;
  expiring_examples: string[] | null;
}

const minorText = (minor: number, currency: string) =>
  `${currency} ${(minor / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/**
 * Once a day per business, after 07:00 in its own time zone: stock alerts per
 * branch (low and expiring) for people who handle stock, yesterday's sales for
 * owners and managers, and one digest e-mail per person who wants it. Each
 * business's day is claimed in `daily_runs` inside the same transaction, so a
 * run happens once even with several API instances, and a failed run retries.
 */
@Injectable()
export class DailySweep implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(DailySweep.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly flags: FeatureFlags,
    private readonly mailer: Mailer,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  onApplicationBootstrap(): void {
    const seconds = this.config.NOTIFICATIONS_SWEEP_SECONDS;
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
      await this.run(new Date());
    } catch (error) {
      this.logger.error({ msg: 'daily sweep failed', error: String(error) });
    } finally {
      this.running = false;
    }
  }

  /** Runs everything due at `now`. Returns how many businesses were processed. */
  async run(now: Date): Promise<{ businesses: number; notifications: number }> {
    const tenants = await this.prisma.asSystem(
      (tx) =>
        tx.$queryRaw<DueTenant[]>`
        SELECT t.id, t.name, ts.currency,
               to_char((${now}::timestamptz AT TIME ZONE ts.timezone)::date, 'YYYY-MM-DD') AS local_date,
               EXTRACT(HOUR FROM ${now}::timestamptz AT TIME ZONE ts.timezone)::int AS local_hour
        FROM tenants t
        JOIN tenant_settings ts ON ts.tenant_id = t.id
        JOIN subscriptions s ON s.tenant_id = t.id
        WHERE t.status = 'ACTIVE' AND t.onboarding_status = 'COMPLETED'
          AND s.status IN ('TRIALING', 'ACTIVE', 'PAST_DUE')`,
    );
    let businesses = 0;
    let created = 0;
    for (const tenant of tenants.filter((t) => isDailyRunDue(t.local_hour))) {
      const result = await this.processTenant(tenant);
      if (result) {
        businesses += 1;
        created += result.created;
        for (const message of result.messages)
          this.mailer.send(message).catch((error: unknown) =>
            this.logger.error({
              msg: 'digest email failed',
              tenantId: tenant.id,
              error: String(error),
            }),
          );
      }
    }
    await this.prisma.asSystem((tx) =>
      tx.notification.deleteMany({
        where: {
          createdAt: { lt: new Date(now.getTime() - NOTIFICATION_RETENTION_DAYS * 86_400_000) },
        },
      }),
    );
    return { businesses, notifications: created };
  }

  private processTenant(
    tenant: DueTenant,
  ): Promise<{ created: number; messages: Message[] } | null> {
    return this.prisma.asSystem(async (tx) => {
      const claimed = await tx.$queryRaw<Array<{ tenant_id: string }>>`
        INSERT INTO daily_runs (tenant_id, run_date) VALUES (${tenant.id}::uuid, ${tenant.local_date}::date)
        ON CONFLICT DO NOTHING RETURNING tenant_id`;
      if (claimed.length === 0) return null;

      const flags = await this.flags.enabledFor(tx, tenant.id);
      const entries: NewNotification[] = [];
      const lines = new Map<string, string[]>();
      const addLine = (userId: string, line: string) =>
        lines.set(userId, [...(lines.get(userId) ?? []), line]);

      for (const alert of await this.branchAlerts(tx, tenant.id, tenant.local_date)) {
        const recipients = await this.notifications.recipients(
          tx,
          tenant.id,
          'inventory.read',
          alert.branch_id,
        );
        const filter = alert.low > 0 ? 'LOW' : 'EXPIRING';
        for (const r of recipients) {
          entries.push({
            tenantId: tenant.id,
            userId: r.userId,
            kind: 'INVENTORY_ALERT',
            dedupeKey: `inventory:${alert.branch_id}:${tenant.local_date}`,
            data: {
              date: tenant.local_date,
              branchId: alert.branch_id,
              branchName: alert.branch_name,
              low: alert.low,
              expiring: alert.expiring,
              lowExamples: alert.low_examples ?? [],
              expiringExamples: alert.expiring_examples ?? [],
              days: EXPIRY_ALERT_DAYS,
            },
            link: `/inventory?branch=${alert.branch_id}&filter=${filter}`,
          });
          addLine(
            r.userId,
            `${alert.branch_name}: ${alert.low} item(s) low on stock, ${alert.expiring} expiring within ${EXPIRY_ALERT_DAYS} days.`,
          );
        }
      }

      if (flags.includes('notifications.daily_summary')) {
        const date = previousDate(tenant.local_date);
        const summary = await this.salesOn(tx, tenant.id, date);
        if (summary.count > 0 || summary.refunds > 0) {
          // Whole-business figures: only for people who may see every branch.
          const recipients = (
            await this.notifications.recipients(tx, tenant.id, 'reports.view')
          ).filter((r) => r.branchIds === null);
          for (const r of recipients) {
            entries.push({
              tenantId: tenant.id,
              userId: r.userId,
              kind: 'DAILY_SUMMARY',
              dedupeKey: `summary:${date}`,
              data: {
                date,
                salesMinor: summary.sales,
                saleCount: summary.count,
                refundsMinor: summary.refunds,
                currency: tenant.currency,
              },
              link: '/reports',
            });
            addLine(
              r.userId,
              `Yesterday (${date}): ${minorText(summary.sales, tenant.currency)} from ${summary.count} sale(s)` +
                (summary.refunds > 0
                  ? `, refunds ${minorText(summary.refunds, tenant.currency)}.`
                  : '.'),
            );
          }
        }
      }

      const created = await this.notifications.notify(tx, entries);
      const messages: Message[] = [];
      if (flags.includes('notifications.email') && lines.size > 0) {
        const people = await this.notifications.recipients(tx, tenant.id, 'tenant.read');
        for (const person of people) {
          const personLines = lines.get(person.userId);
          if (!person.emailDigest || !personLines) continue;
          messages.push(
            digestEmail({
              to: person.email,
              fullName: person.fullName,
              businessName: tenant.name,
              lines: personLines,
              url: `${this.config.WEB_APP_URL}/notifications`,
            }),
          );
        }
      }
      return { created, messages };
    });
  }

  private branchAlerts(tx: Tx, tenantId: string, localDate: string): Promise<BranchAlert[]> {
    return tx.$queryRaw<BranchAlert[]>`
      WITH totals AS (
        SELECT branch_id, variant_id, SUM(quantity) AS total
        FROM stock_levels WHERE tenant_id = ${tenantId}::uuid GROUP BY branch_id, variant_id
      ),
      low AS (
        SELECT b.id AS branch_id, COUNT(*)::int AS low,
               (array_agg(p.name ORDER BY p.name))[1:3] AS examples
        FROM branches b
        JOIN product_variants v ON v.tenant_id = b.tenant_id
        JOIN products p ON p.tenant_id = v.tenant_id AND p.id = v.product_id
        LEFT JOIN totals t ON t.branch_id = b.id AND t.variant_id = v.id
        WHERE b.tenant_id = ${tenantId}::uuid AND b.status = 'ACTIVE'
          AND v.status = 'ACTIVE' AND p.status = 'ACTIVE' AND v.reorder_level IS NOT NULL
          AND COALESCE(t.total, 0) <= v.reorder_level
        GROUP BY b.id
      ),
      expiring AS (
        SELECT sl.branch_id, COUNT(DISTINCT sl.variant_id)::int AS expiring,
               (array_agg(DISTINCT p.name))[1:3] AS examples
        FROM stock_levels sl
        JOIN stock_batches sb ON sb.tenant_id = sl.tenant_id AND sb.id = sl.batch_id
        JOIN product_variants v ON v.tenant_id = sl.tenant_id AND v.id = sl.variant_id
        JOIN products p ON p.tenant_id = v.tenant_id AND p.id = v.product_id
        WHERE sl.tenant_id = ${tenantId}::uuid AND sl.quantity > 0
          AND sb.expiry_date IS NOT NULL
          AND sb.expiry_date <= ${localDate}::date + ${EXPIRY_ALERT_DAYS}::int
        GROUP BY sl.branch_id
      )
      SELECT b.id AS branch_id, b.name AS branch_name,
             COALESCE(low.low, 0) AS low, COALESCE(expiring.expiring, 0) AS expiring,
             low.examples AS low_examples, expiring.examples AS expiring_examples
      FROM branches b
      LEFT JOIN low ON low.branch_id = b.id
      LEFT JOIN expiring ON expiring.branch_id = b.id
      WHERE b.tenant_id = ${tenantId}::uuid AND b.status = 'ACTIVE'
        AND (low.low > 0 OR expiring.expiring > 0)
      ORDER BY b.name`;
  }

  private async salesOn(
    tx: Tx,
    tenantId: string,
    date: string,
  ): Promise<{ sales: number; count: number; refunds: number }> {
    const rows = await tx.$queryRaw<
      Array<{ sales: bigint | null; count: number; refunds: bigint | null }>
    >`
      SELECT
        (SELECT SUM(s.total_minor) FROM sales s JOIN tenant_settings ts ON ts.tenant_id = s.tenant_id
          WHERE s.tenant_id = ${tenantId}::uuid AND (s.created_at AT TIME ZONE ts.timezone)::date = ${date}::date) AS sales,
        (SELECT COUNT(*)::int FROM sales s JOIN tenant_settings ts ON ts.tenant_id = s.tenant_id
          WHERE s.tenant_id = ${tenantId}::uuid AND (s.created_at AT TIME ZONE ts.timezone)::date = ${date}::date) AS count,
        (SELECT SUM(r.refund_minor) FROM sale_returns r JOIN tenant_settings ts ON ts.tenant_id = r.tenant_id
          WHERE r.tenant_id = ${tenantId}::uuid AND (r.created_at AT TIME ZONE ts.timezone)::date = ${date}::date) AS refunds`;
    const row = rows[0];
    return {
      sales: Number(row?.sales ?? 0),
      count: row?.count ?? 0,
      refunds: Number(row?.refunds ?? 0),
    };
  }
}
