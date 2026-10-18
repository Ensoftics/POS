import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type {
  Dashboard,
  ProfitReport,
  ReceivablesReport,
  SalesGroup,
  SalesReport,
  StockValuation,
  TaxReport,
} from '@pos/contracts';
import {
  ageReceivable,
  AGEING_BUCKETS,
  COST_SCALE,
  costOf,
  fromMilli,
  marginBp,
  toMilli,
} from '@pos/domain';
import { variantLabel } from '../inventory/inventory-helpers';
import { AppException } from '../common/app-exception';
import { assertBranchAllowed } from '../common/branch-access';
import { RequestContext } from '../common/request-context';
import { PrismaService, type Tx } from '../prisma/prisma.service';

interface Range {
  start: Date;
  end: Date;
  from: string;
  to: string;
}

type Num = bigint | number | null;
const n = (value: Num) => Number(value ?? 0);
const decimal = (value: string | null) => (value ? fromMilli(toMilli(trimDecimal(value))) : '0');
/** PostgreSQL may print numerics with more than three decimals after SUM; quantities never need them. */
function trimDecimal(value: string): string {
  const [whole, fraction = ''] = value.split('.');
  return fraction ? `${whole}.${fraction.slice(0, 3)}` : whole!;
}

/**
 * Reports read the immutable records (sales, returns, payments, stock movements,
 * account entries) and aggregate in the database. Each query is fixed SQL with
 * parameters; grouping expressions come from a closed set, never from input.
 */
@Injectable()
export class ReportsService {
  constructor(private readonly prisma: PrismaService) {}

  /* Shared ------------------------------------------------------------------ */

  private async context(tx: Tx, tenantId: string) {
    const settings = await tx.tenantSettings.findUniqueOrThrow({
      where: { tenantId },
      select: { timezone: true, currency: true },
    });
    return settings;
  }

  /** Business days → instants; defaults to the last seven days up to today. */
  private async range(tx: Tx, timezone: string, from?: string, to?: string): Promise<Range> {
    const rows = await tx.$queryRaw<Range[]>`
      WITH d AS (SELECT COALESCE(${to ?? null}::date, (now() AT TIME ZONE ${timezone})::date) AS t),
           r AS (SELECT COALESCE(${from ?? null}::date, (SELECT t FROM d) - 6) AS f, (SELECT t FROM d) AS t)
      SELECT (f::timestamp AT TIME ZONE ${timezone}) AS start,
             ((t + 1)::timestamp AT TIME ZONE ${timezone}) AS "end",
             f::text AS from, t::text AS to
      FROM r`;
    return rows[0]!;
  }

  private branchFilter(column: Prisma.Sql, branchId?: string) {
    return branchId ? Prisma.sql`AND ${column} = ${branchId}::uuid` : Prisma.empty;
  }

  /**
   * The branch a report may cover: any for unrestricted members; for staff limited to
   * some branches, one of theirs (their only branch when none is chosen).
   */
  private scope(branchId: string | undefined): string | undefined {
    const principal = RequestContext.get()?.principal;
    const allowed = principal?.branchIds ?? null;
    if (allowed === null) return branchId;
    if (branchId) {
      assertBranchAllowed(principal, branchId);
      return branchId;
    }
    if (allowed.length === 1) return allowed[0];
    throw AppException.validation([{ path: 'branchId', message: 'validation.branch.required' }]);
  }

  /* Sales -------------------------------------------------------------------- */

  async sales(
    tenantId: string,
    query: { from?: string; to?: string; branchId?: string; groupBy: SalesGroup },
  ): Promise<SalesReport> {
    query = { ...query, branchId: this.scope(query.branchId) };
    return this.prisma.withTenant(tenantId, async (tx) => {
      const { timezone, currency } = await this.context(tx, tenantId);
      const r = await this.range(tx, timezone, query.from, query.to);
      const tz = timezone;
      type Row = {
        key: string;
        label: string;
        sale_count: number;
        quantity: string | null;
        discount: Num;
        tax: Num;
        total: Num;
      };
      type Refund = { key: string; label: string; refunds: Num };
      let sales: Row[];
      let refunds: Refund[];
      const salesIn = Prisma.sql`s.tenant_id = ${tenantId}::uuid AND s.created_at >= ${r.start} AND s.created_at < ${r.end} ${this.branchFilter(Prisma.sql`s.branch_id`, query.branchId)}`;
      // Lines carry their sale's date and branch, so line reports never visit every sale.
      const linesIn = Prisma.sql`l.tenant_id = ${tenantId}::uuid AND l.created_at >= ${r.start} AND l.created_at < ${r.end} ${this.branchFilter(Prisma.sql`l.branch_id`, query.branchId)}`;
      const returnsIn = Prisma.sql`rt.tenant_id = ${tenantId}::uuid AND rt.created_at >= ${r.start} AND rt.created_at < ${r.end} ${this.branchFilter(Prisma.sql`rt.branch_id`, query.branchId)}`;

      if (query.groupBy === 'day' || query.groupBy === 'branch' || query.groupBy === 'cashier') {
        const pick = (alias: 's' | 'rt') => {
          const a = Prisma.raw(alias);
          return query.groupBy === 'day'
            ? {
                key: Prisma.sql`to_char((${a}.created_at AT TIME ZONE ${tz})::date, 'YYYY-MM-DD')`,
                label: Prisma.sql`to_char((${a}.created_at AT TIME ZONE ${tz})::date, 'YYYY-MM-DD')`,
                join: Prisma.empty,
              }
            : query.groupBy === 'branch'
              ? {
                  key: Prisma.sql`${a}.branch_id::text`,
                  label: Prisma.sql`b.name`,
                  join: Prisma.sql`JOIN branches b ON b.tenant_id = ${a}.tenant_id AND b.id = ${a}.branch_id`,
                }
              : {
                  key: Prisma.sql`COALESCE(${a}.cashier_id::text, 'none')`,
                  label: Prisma.sql`COALESCE(u.full_name, '—')`,
                  join: Prisma.sql`LEFT JOIN users u ON u.id = ${a}.cashier_id`,
                };
        };
        const s = pick('s');
        const rt = pick('rt');
        sales = await tx.$queryRaw<Row[]>`
          SELECT ${s.key} AS key, ${s.label} AS label, COUNT(*)::int AS sale_count, NULL AS quantity,
                 SUM(s.discount_minor)::bigint AS discount, SUM(s.tax_minor)::bigint AS tax, SUM(s.total_minor)::bigint AS total
          FROM sales s ${s.join} WHERE ${salesIn} GROUP BY 1, 2`;
        refunds = await tx.$queryRaw<Refund[]>`
          SELECT ${rt.key} AS key, ${rt.label} AS label, SUM(rt.refund_minor)::bigint AS refunds
          FROM sale_returns rt ${rt.join} WHERE ${returnsIn} GROUP BY 1, 2`;
      } else if (query.groupBy === 'product' || query.groupBy === 'category') {
        const product = query.groupBy === 'product';
        const key = product
          ? Prisma.sql`l.variant_id::text`
          : Prisma.sql`COALESCE(c.id::text, 'none')`;
        const label = product
          ? Prisma.sql`l.product_name || CASE WHEN l.variant_label <> '' THEN ' (' || l.variant_label || ')' ELSE '' END`
          : Prisma.sql`COALESCE(c.name, '—')`;
        const join = product
          ? Prisma.empty
          : Prisma.sql`JOIN product_variants v ON v.tenant_id = l.tenant_id AND v.id = l.variant_id
                       JOIN products p ON p.tenant_id = v.tenant_id AND p.id = v.product_id
                       LEFT JOIN categories c ON c.tenant_id = p.tenant_id AND c.id = p.category_id`;
        sales = await tx.$queryRaw<Row[]>`
          SELECT ${key} AS key, MIN(${label}) AS label, COUNT(DISTINCT l.sale_id)::int AS sale_count, SUM(l.quantity)::text AS quantity,
                 SUM(l.line_discount_minor + l.cart_discount_minor)::bigint AS discount,
                 SUM(l.tax_minor)::bigint AS tax, SUM(l.total_minor)::bigint AS total
          FROM sale_lines l ${join}
          WHERE ${linesIn} GROUP BY 1`;
        refunds = await tx.$queryRaw<Refund[]>`
          SELECT ${key} AS key, MIN(${label}) AS label, SUM(rl.refund_minor)::bigint AS refunds
          FROM sale_return_lines rl
          JOIN sale_returns rt ON rt.tenant_id = rl.tenant_id AND rt.id = rl.return_id
          JOIN sale_lines l ON l.tenant_id = rl.tenant_id AND l.id = rl.sale_line_id ${join}
          WHERE ${returnsIn} GROUP BY 1`;
      } else {
        // Payment methods: cash is counted net of the change handed back.
        sales = await tx.$queryRaw<Row[]>`
          SELECT p.method::text AS key, p.method::text AS label, COUNT(DISTINCT s.id)::int AS sale_count, NULL AS quantity,
                 0::bigint AS discount, 0::bigint AS tax, SUM(p.amount_minor)::bigint AS total
          FROM sale_payments p JOIN sales s ON s.tenant_id = p.tenant_id AND s.id = p.sale_id
          WHERE ${salesIn} GROUP BY 1, 2`;
        const change = await tx.$queryRaw<Array<{ change: Num }>>`
          SELECT SUM(s.change_minor)::bigint AS change FROM sales s WHERE ${salesIn}`;
        const cash = sales.find((row) => row.key === 'CASH');
        if (cash) cash.total = n(cash.total) - n(change[0]?.change ?? 0);
        refunds = await tx.$queryRaw<Refund[]>`
          SELECT f.method::text AS key, f.method::text AS label, SUM(f.amount_minor)::bigint AS refunds
          FROM sale_return_refunds f JOIN sale_returns rt ON rt.tenant_id = f.tenant_id AND rt.id = f.return_id
          WHERE ${returnsIn} GROUP BY 1, 2`;
      }

      const rows = new Map<string, SalesReport['rows'][number]>();
      for (const row of sales)
        rows.set(row.key, {
          key: row.key,
          label: row.label,
          saleCount: row.sale_count,
          quantity: row.quantity === null ? null : decimal(row.quantity),
          discountMinor: n(row.discount),
          taxMinor: n(row.tax),
          totalMinor: n(row.total),
          refundsMinor: 0,
          netMinor: n(row.total),
        });
      for (const refund of refunds) {
        const row =
          rows.get(refund.key) ??
          ({
            key: refund.key,
            label: refund.label,
            saleCount: 0,
            quantity: null,
            discountMinor: 0,
            taxMinor: 0,
            totalMinor: 0,
            refundsMinor: 0,
            netMinor: 0,
          } as SalesReport['rows'][number]);
        row.refundsMinor += n(refund.refunds);
        row.netMinor = row.totalMinor - row.refundsMinor;
        rows.set(refund.key, row);
      }
      const list = [...rows.values()].sort((a, b) =>
        query.groupBy === 'day' ? a.key.localeCompare(b.key) : b.netMinor - a.netMinor,
      );
      const sum = (pick: (row: SalesReport['rows'][number]) => number) =>
        list.reduce((t, row) => t + pick(row), 0);
      const totalSales = await tx.$queryRaw<Array<{ count: number }>>`
        SELECT COUNT(*)::int AS count FROM sales s WHERE ${salesIn}`;
      const quantities = list.filter((row) => row.quantity !== null);
      return {
        from: r.from,
        to: r.to,
        currency,
        groupBy: query.groupBy,
        rows: list,
        totals: {
          saleCount: totalSales[0]!.count,
          quantity: quantities.length
            ? fromMilli(quantities.reduce((t, row) => t + toMilli(row.quantity!), 0))
            : null,
          discountMinor: sum((row) => row.discountMinor),
          taxMinor: sum((row) => row.taxMinor),
          totalMinor: sum((row) => row.totalMinor),
          refundsMinor: sum((row) => row.refundsMinor),
          netMinor: sum((row) => row.netMinor),
        },
      };
    });
  }

  /* Tax ----------------------------------------------------------------------- */

  async tax(
    tenantId: string,
    query: { from?: string; to?: string; branchId?: string },
  ): Promise<TaxReport> {
    query = { ...query, branchId: this.scope(query.branchId) };
    return this.prisma.withTenant(tenantId, async (tx) => {
      const { timezone, currency } = await this.context(tx, tenantId);
      const r = await this.range(tx, timezone, query.from, query.to);
      const collected = await tx.$queryRaw<
        Array<{ name: string | null; rate: number; taxable: Num; tax: Num }>
      >`
        SELECT l.tax_name AS name, l.tax_rate_bp AS rate, SUM(l.total_minor - l.tax_minor)::bigint AS taxable,
               SUM(l.tax_minor)::bigint AS tax
        FROM sale_lines l
        WHERE l.tenant_id = ${tenantId}::uuid AND l.created_at >= ${r.start} AND l.created_at < ${r.end}
          ${this.branchFilter(Prisma.sql`l.branch_id`, query.branchId)}
        GROUP BY 1, 2`;
      const refunded = await tx.$queryRaw<Array<{ name: string | null; rate: number; tax: Num }>>`
        SELECT l.tax_name AS name, l.tax_rate_bp AS rate, SUM(rl.tax_minor)::bigint AS tax
        FROM sale_return_lines rl
        JOIN sale_returns rt ON rt.tenant_id = rl.tenant_id AND rt.id = rl.return_id
        JOIN sale_lines l ON l.tenant_id = rl.tenant_id AND l.id = rl.sale_line_id
        WHERE rt.tenant_id = ${tenantId}::uuid AND rt.created_at >= ${r.start} AND rt.created_at < ${r.end}
          ${this.branchFilter(Prisma.sql`rt.branch_id`, query.branchId)}
        GROUP BY 1, 2`;
      const rows = new Map<string, TaxReport['rows'][number]>();
      const keyOf = (name: string | null, rate: number) => `${name ?? ''}|${rate}`;
      for (const c of collected)
        rows.set(keyOf(c.name, c.rate), {
          name: c.name,
          rateBp: c.rate,
          taxableMinor: n(c.taxable),
          taxMinor: n(c.tax),
          refundedTaxMinor: 0,
          netTaxMinor: n(c.tax),
        });
      for (const f of refunded) {
        const row = rows.get(keyOf(f.name, f.rate)) ?? {
          name: f.name,
          rateBp: f.rate,
          taxableMinor: 0,
          taxMinor: 0,
          refundedTaxMinor: 0,
          netTaxMinor: 0,
        };
        row.refundedTaxMinor += n(f.tax);
        row.netTaxMinor = row.taxMinor - row.refundedTaxMinor;
        rows.set(keyOf(f.name, f.rate), row);
      }
      const list = [...rows.values()].sort((a, b) => b.rateBp - a.rateBp);
      const sum = (pick: (row: TaxReport['rows'][number]) => number) =>
        list.reduce((t, row) => t + pick(row), 0);
      return {
        from: r.from,
        to: r.to,
        currency,
        rows: list,
        totals: {
          taxableMinor: sum((x) => x.taxableMinor),
          taxMinor: sum((x) => x.taxMinor),
          refundedTaxMinor: sum((x) => x.refundedTaxMinor),
          netTaxMinor: sum((x) => x.netTaxMinor),
        },
      };
    });
  }

  /* Profit ---------------------------------------------------------------------- */

  async profit(
    tenantId: string,
    query: {
      from?: string;
      to?: string;
      branchId?: string;
      groupBy: 'day' | 'category' | 'product';
    },
  ): Promise<ProfitReport> {
    query = { ...query, branchId: this.scope(query.branchId) };
    return this.prisma.withTenant(tenantId, async (tx) => {
      const { timezone, currency } = await this.context(tx, tenantId);
      const r = await this.range(tx, timezone, query.from, query.to);
      const tz = timezone;
      // The same grouping over sale lines (revenue) and stock movements (cost), joined by key.
      const group = (variant: Prisma.Sql, at: Prisma.Sql) =>
        query.groupBy === 'day'
          ? {
              key: Prisma.sql`to_char((${at} AT TIME ZONE ${tz})::date, 'YYYY-MM-DD')`,
              label: Prisma.sql`to_char((${at} AT TIME ZONE ${tz})::date, 'YYYY-MM-DD')`,
              join: Prisma.empty,
            }
          : query.groupBy === 'product'
            ? {
                key: Prisma.sql`${variant}::text`,
                label: Prisma.sql`p.name || CASE WHEN v.attributes::text <> '{}' THEN ' (' || v.sku || ')' ELSE '' END`,
                join: Prisma.sql`JOIN product_variants v ON v.tenant_id = ${Prisma.raw('x')}.tenant_id AND v.id = ${variant}
                                 JOIN products p ON p.tenant_id = v.tenant_id AND p.id = v.product_id`,
              }
            : {
                key: Prisma.sql`COALESCE(c.id::text, 'none')`,
                label: Prisma.sql`COALESCE(c.name, '—')`,
                join: Prisma.sql`JOIN product_variants v ON v.tenant_id = ${Prisma.raw('x')}.tenant_id AND v.id = ${variant}
                                 JOIN products p ON p.tenant_id = v.tenant_id AND p.id = v.product_id
                                 LEFT JOIN categories c ON c.tenant_id = p.tenant_id AND c.id = p.category_id`,
              };

      const sale = group(Prisma.sql`x.variant_id`, Prisma.sql`x.created_at`);
      const revenue = await tx.$queryRaw<Array<{ key: string; label: string; amount: Num }>>`
        SELECT ${sale.key} AS key, MIN(${sale.label}) AS label, SUM(x.total_minor - x.tax_minor)::bigint AS amount
        FROM sale_lines x ${sale.join}
        WHERE x.tenant_id = ${tenantId}::uuid AND x.created_at >= ${r.start} AND x.created_at < ${r.end}
          ${this.branchFilter(Prisma.sql`x.branch_id`, query.branchId)}
        GROUP BY 1`;
      const ret = group(Prisma.sql`l.variant_id`, Prisma.sql`rt.created_at`);
      const returned = await tx.$queryRaw<Array<{ key: string; label: string; amount: Num }>>`
        SELECT ${ret.key} AS key, MIN(${ret.label}) AS label, SUM(x.refund_minor - x.tax_minor)::bigint AS amount
        FROM sale_return_lines x
        JOIN sale_returns rt ON rt.tenant_id = x.tenant_id AND rt.id = x.return_id
        JOIN sale_lines l ON l.tenant_id = x.tenant_id AND l.id = x.sale_line_id ${ret.join}
        WHERE rt.tenant_id = ${tenantId}::uuid AND rt.created_at >= ${r.start} AND rt.created_at < ${r.end}
          ${this.branchFilter(Prisma.sql`rt.branch_id`, query.branchId)}
        GROUP BY 1`;
      const mov = group(Prisma.sql`x.variant_id`, Prisma.sql`x.created_at`);
      const costs = await tx.$queryRaw<
        Array<{ key: string; label: string; cost: Num; unknown: string | null }>
      >`
        SELECT ${mov.key} AS key, MIN(${mov.label}) AS label,
               SUM(CASE WHEN x.type = 'SALE' THEN x.cost_minor ELSE -x.cost_minor END)::bigint AS cost,
               SUM(CASE WHEN x.type = 'SALE' AND x.cost_minor IS NULL THEN -x.quantity ELSE 0 END)::text AS unknown
        FROM stock_movements x ${mov.join}
        WHERE x.tenant_id = ${tenantId}::uuid AND x.type IN ('SALE', 'RETURN')
          AND x.created_at >= ${r.start} AND x.created_at < ${r.end}
          ${this.branchFilter(Prisma.sql`x.branch_id`, query.branchId)}
        GROUP BY 1`;

      const rows = new Map<
        string,
        { key: string; label: string; revenue: number; cost: number; unknown: number }
      >();
      const row = (key: string, label: string) => {
        const existing = rows.get(key) ?? { key, label, revenue: 0, cost: 0, unknown: 0 };
        rows.set(key, existing);
        return existing;
      };
      for (const x of revenue) row(x.key, x.label).revenue += n(x.amount);
      for (const x of returned) row(x.key, x.label).revenue -= n(x.amount);
      for (const x of costs) {
        const target = row(x.key, x.label);
        target.cost += n(x.cost);
        target.unknown += toMilli(trimDecimal(x.unknown ?? '0'));
      }
      const toRow = (x: { revenue: number; cost: number; unknown: number }) => ({
        revenueMinor: x.revenue,
        costMinor: x.cost,
        profitMinor: x.revenue - x.cost,
        marginBp: marginBp(x.revenue, x.revenue - x.cost),
        unknownCostQuantity: fromMilli(x.unknown),
      });
      const list = [...rows.values()]
        .map((x) => ({ key: x.key, label: x.label, ...toRow(x) }))
        .sort((a, b) =>
          query.groupBy === 'day' ? a.key.localeCompare(b.key) : b.profitMinor - a.profitMinor,
        );
      const totals = [...rows.values()].reduce(
        (t, x) => ({
          revenue: t.revenue + x.revenue,
          cost: t.cost + x.cost,
          unknown: t.unknown + x.unknown,
        }),
        { revenue: 0, cost: 0, unknown: 0 },
      );
      return {
        from: r.from,
        to: r.to,
        currency,
        groupBy: query.groupBy,
        rows: list,
        totals: toRow(totals),
      };
    });
  }

  /* Stock valuation ------------------------------------------------------------- */

  async stockValuation(tenantId: string, requested?: string): Promise<StockValuation> {
    const branchId = this.scope(requested);
    return this.prisma.withTenant(tenantId, async (tx) => {
      const { currency } = await this.context(tx, tenantId);
      const rows = await tx.$queryRaw<
        Array<{
          id: string;
          sku: string;
          name: string;
          attributes: unknown;
          quantity: string;
          average_cost4: bigint | null;
          cost_minor: bigint | null;
        }>
      >`
        SELECT v.id, v.sku, p.name, v.attributes, SUM(l.quantity)::text AS quantity, c.average_cost4, v.cost_minor
        FROM stock_levels l
        JOIN product_variants v ON v.tenant_id = l.tenant_id AND v.id = l.variant_id
        JOIN products p ON p.tenant_id = v.tenant_id AND p.id = v.product_id
        LEFT JOIN variant_costs c ON c.tenant_id = v.tenant_id AND c.variant_id = v.id
        WHERE l.tenant_id = ${tenantId}::uuid ${this.branchFilter(Prisma.sql`l.branch_id`, branchId)}
        GROUP BY v.id, v.sku, p.name, v.attributes, c.average_cost4, v.cost_minor
        HAVING SUM(l.quantity) <> 0
        ORDER BY p.name, v.sku`;
      let total = 0;
      let withoutCost = 0;
      const items = rows.map((row) => {
        const average =
          row.average_cost4 ?? (row.cost_minor === null ? null : row.cost_minor * COST_SCALE);
        const quantity = decimal(row.quantity);
        const negative = quantity.startsWith('-');
        const value =
          average === null
            ? null
            : (negative ? -1 : 1) * costOf(quantity.replace('-', ''), average);
        if (value === null) withoutCost += 1;
        else total += value;
        return {
          variantId: row.id,
          sku: row.sku,
          productName: row.name,
          variantLabel: variantLabel(row.attributes),
          quantity,
          averageCostMinor: average === null ? null : costOf('1', average),
          valueMinor: value,
        };
      });
      return {
        asOf: new Date().toISOString(),
        currency,
        rows: items,
        totals: { valueMinor: total, itemsWithoutCost: withoutCost },
      };
    });
  }

  /* Receivables ------------------------------------------------------------------- */

  async receivables(tenantId: string): Promise<ReceivablesReport> {
    return this.prisma.withTenant(tenantId, async (tx) => {
      const { currency } = await this.context(tx, tenantId);
      const customers = await tx.customer.findMany({
        where: { tenantId, balanceMinor: { gt: 0 } },
        orderBy: { balanceMinor: 'desc' },
      });
      const entries = await tx.customerLedgerEntry.findMany({
        where: { tenantId, customerId: { in: customers.map((c) => c.id) } },
        select: { customerId: true, amountMinor: true, createdAt: true },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      });
      const asOf = new Date();
      const empty = Object.fromEntries(AGEING_BUCKETS.map((b) => [b, 0])) as Record<
        (typeof AGEING_BUCKETS)[number],
        number
      >;
      const totals = { balanceMinor: 0, ...empty };
      const rows = customers.map((c) => {
        const aged = ageReceivable(
          entries
            .filter((e) => e.customerId === c.id)
            .map((e) => ({
              amountMinor: Number(e.amountMinor),
              createdAt: e.createdAt.toISOString(),
            })),
          asOf,
        );
        totals.balanceMinor += Number(c.balanceMinor);
        for (const b of AGEING_BUCKETS) totals[b] += aged[b];
        return {
          customerId: c.id,
          number: c.number,
          name: c.name,
          phone: c.phone,
          balanceMinor: Number(c.balanceMinor),
          ...Object.fromEntries(AGEING_BUCKETS.map((b) => [b, aged[b]])),
        } as ReceivablesReport['rows'][number];
      });
      return { asOf: asOf.toISOString(), currency, rows, totals };
    });
  }

  /* Dashboard ---------------------------------------------------------------------- */

  async dashboard(tenantId: string, requested?: string): Promise<Dashboard> {
    const branchId = this.scope(requested);
    return this.prisma.withTenant(tenantId, async (tx) => {
      const { timezone, currency } = await this.context(tx, tenantId);
      const week = await this.range(tx, timezone);
      const bySale = Prisma.sql`s.tenant_id = ${tenantId}::uuid ${this.branchFilter(Prisma.sql`s.branch_id`, branchId)}`;
      const days = await tx.$queryRaw<Array<{ date: string; sales: Num; count: number }>>`
        SELECT d::date::text AS date,
               COALESCE(SUM(s.total_minor), 0)::bigint AS sales, COUNT(s.id)::int AS count
        FROM generate_series(${week.from}::date, ${week.to}::date, interval '1 day') d
        LEFT JOIN sales s ON (s.created_at AT TIME ZONE ${timezone})::date = d::date AND ${bySale}
          AND s.created_at >= ${week.start} AND s.created_at < ${week.end}
        GROUP BY 1 ORDER BY 1`;
      const refunds = await tx.$queryRaw<Array<{ date: string; refunds: Num }>>`
        SELECT (rt.created_at AT TIME ZONE ${timezone})::date::text AS date, SUM(rt.refund_minor)::bigint AS refunds
        FROM sale_returns rt
        WHERE rt.tenant_id = ${tenantId}::uuid AND rt.created_at >= ${week.start}
          ${this.branchFilter(Prisma.sql`rt.branch_id`, branchId)}
        GROUP BY 1`;
      const totalsFor = (date: string) => {
        const day = days.find((d) => d.date === date);
        const sales = n(day?.sales ?? 0);
        const count = day?.count ?? 0;
        return {
          salesMinor: sales,
          saleCount: count,
          averageSaleMinor: count ? Math.round(sales / count) : 0,
          refundsMinor: n(refunds.find((x) => x.date === date)?.refunds ?? 0),
        };
      };
      const today = week.to;
      const yesterday = days.at(-2)?.date ?? today;
      const top = await tx.$queryRaw<Array<{ label: string; quantity: string; total: Num }>>`
        SELECT MIN(l.product_name || CASE WHEN l.variant_label <> '' THEN ' (' || l.variant_label || ')' ELSE '' END) AS label,
               SUM(l.quantity)::text AS quantity, SUM(l.total_minor)::bigint AS total
        FROM sale_lines l
        WHERE l.tenant_id = ${tenantId}::uuid ${this.branchFilter(Prisma.sql`l.branch_id`, branchId)}
          AND l.created_at >= (${today}::date::timestamp AT TIME ZONE ${timezone})
          AND l.created_at < ((${today}::date + 1)::timestamp AT TIME ZONE ${timezone})
        GROUP BY l.variant_id ORDER BY total DESC LIMIT 5`;
      const low = await tx.$queryRaw<Array<{ count: number }>>`
        SELECT COUNT(*)::int AS count FROM (
          SELECT v.id FROM product_variants v
          JOIN products p ON p.tenant_id = v.tenant_id AND p.id = v.product_id
          LEFT JOIN stock_levels l ON l.tenant_id = v.tenant_id AND l.variant_id = v.id
            ${this.branchFilter(Prisma.sql`l.branch_id`, branchId)}
          WHERE v.tenant_id = ${tenantId}::uuid AND v.status = 'ACTIVE' AND p.status = 'ACTIVE' AND v.reorder_level IS NOT NULL
          GROUP BY v.id, v.reorder_level HAVING COALESCE(SUM(l.quantity), 0) <= v.reorder_level) x`;
      const [openShifts, openConflicts, owed] = await Promise.all([
        tx.shift.count({ where: { tenantId, status: 'OPEN', ...(branchId ? { branchId } : {}) } }),
        tx.saleConflict.count({ where: { tenantId, resolvedAt: null } }),
        tx.customer.aggregate({
          where: { tenantId, balanceMinor: { gt: 0 } },
          _sum: { balanceMinor: true },
        }),
      ]);
      return {
        today,
        currency,
        todayTotals: totalsFor(today),
        yesterdayTotals: totalsFor(yesterday),
        last7Days: days.map((d) => ({ date: d.date, salesMinor: n(d.sales), saleCount: d.count })),
        topProducts: top.map((x) => ({
          label: x.label,
          quantity: decimal(x.quantity),
          totalMinor: n(x.total),
        })),
        lowStockCount: low[0]?.count ?? 0,
        openShifts,
        openConflicts,
        receivablesMinor: Number(owed._sum.balanceMinor ?? 0n),
      };
    });
  }
}
