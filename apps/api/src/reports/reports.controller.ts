import { Controller, Get, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiProduces, ApiTags } from '@nestjs/swagger';
import {
  type Dashboard,
  dashboardQuerySchema,
  dashboardSchema,
  profitReportQuerySchema,
  profitReportSchema,
  receivablesQuerySchema,
  receivablesReportSchema,
  reportRangeQuerySchema,
  salesReportQuerySchema,
  salesReportSchema,
  stockValuationQuerySchema,
  stockValuationSchema,
  taxReportSchema,
} from '@pos/contracts';
import {
  type CurrencyCode,
  formatPercent,
  isCurrencyCode,
  minorToDecimalString,
  toCsv,
} from '@pos/domain';
import type { Response } from 'express';
import type { z } from 'zod';
import { CurrentPrincipal, RequirePermissions } from '../auth/auth.decorators';
import type { AuthPrincipal } from '../common/request-context';
import { ApiZodQuery, ApiZodResponse, ZodQuery } from '../common/zod';
import { ReportsService } from './reports.service';

type Cell = string | number | null;

/** Basis points as a signed percentage text, e.g. -12.5. */
const percent = (bp: number | null) =>
  bp === null ? '' : bp < 0 ? `-${formatPercent(-bp)}` : formatPercent(bp);

/** Sends JSON, or the same rows as a CSV attachment when `format=csv`. */
function respond<T extends { currency: string }>(
  res: Response,
  format: 'json' | 'csv',
  report: T,
  filename: string,
  table: (money: (minor: number | null) => string) => Cell[][],
): T | string {
  if (format === 'json') return report;
  const currency: CurrencyCode = isCurrencyCode(report.currency) ? report.currency : 'LKR';
  const money = (minor: number | null) =>
    minor === null ? '' : minorToDecimalString(minor, currency);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}.csv"`);
  return toCsv(table(money));
}

@ApiTags('Reports')
@ApiBearerAuth()
@Controller('reports')
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Get('dashboard')
  @RequirePermissions('reports.view')
  @ApiZodQuery(dashboardQuerySchema)
  @ApiZodResponse(200, dashboardSchema)
  dashboard(
    @CurrentPrincipal() p: AuthPrincipal,
    @ZodQuery(dashboardQuerySchema) query: z.output<typeof dashboardQuerySchema>,
  ): Promise<Dashboard> {
    return this.reports.dashboard(p.tenantId, query.branchId);
  }

  @Get('sales')
  @RequirePermissions('reports.view')
  @ApiZodQuery(salesReportQuerySchema)
  @ApiZodResponse(200, salesReportSchema)
  @ApiProduces('application/json', 'text/csv')
  async sales(
    @CurrentPrincipal() p: AuthPrincipal,
    @ZodQuery(salesReportQuerySchema) query: z.output<typeof salesReportQuerySchema>,
    @Res({ passthrough: true }) res: Response,
  ) {
    const report = await this.reports.sales(p.tenantId, query);
    return respond(
      res,
      query.format,
      report,
      `sales-${query.groupBy}-${report.from}-${report.to}`,
      (money) => [
        [query.groupBy, 'sales', 'quantity', 'discount', 'tax', 'total', 'refunds', 'net'],
        ...report.rows.map((r) => [
          r.label,
          r.saleCount,
          r.quantity,
          money(r.discountMinor),
          money(r.taxMinor),
          money(r.totalMinor),
          money(r.refundsMinor),
          money(r.netMinor),
        ]),
        [
          'TOTAL',
          report.totals.saleCount,
          report.totals.quantity,
          money(report.totals.discountMinor),
          money(report.totals.taxMinor),
          money(report.totals.totalMinor),
          money(report.totals.refundsMinor),
          money(report.totals.netMinor),
        ],
      ],
    );
  }

  @Get('tax')
  @RequirePermissions('reports.view')
  @ApiZodQuery(reportRangeQuerySchema)
  @ApiZodResponse(200, taxReportSchema)
  @ApiProduces('application/json', 'text/csv')
  async tax(
    @CurrentPrincipal() p: AuthPrincipal,
    @ZodQuery(reportRangeQuerySchema) query: z.output<typeof reportRangeQuerySchema>,
    @Res({ passthrough: true }) res: Response,
  ) {
    const report = await this.reports.tax(p.tenantId, query);
    return respond(res, query.format, report, `tax-${report.from}-${report.to}`, (money) => [
      ['tax', 'rate %', 'taxable', 'tax', 'refunded tax', 'net tax'],
      ...report.rows.map((r) => [
        r.name ?? '',
        formatPercent(r.rateBp),
        money(r.taxableMinor),
        money(r.taxMinor),
        money(r.refundedTaxMinor),
        money(r.netTaxMinor),
      ]),
      [
        'TOTAL',
        '',
        money(report.totals.taxableMinor),
        money(report.totals.taxMinor),
        money(report.totals.refundedTaxMinor),
        money(report.totals.netTaxMinor),
      ],
    ]);
  }

  @Get('profit')
  @RequirePermissions('reports.profit')
  @ApiZodQuery(profitReportQuerySchema)
  @ApiZodResponse(200, profitReportSchema)
  @ApiProduces('application/json', 'text/csv')
  async profit(
    @CurrentPrincipal() p: AuthPrincipal,
    @ZodQuery(profitReportQuerySchema) query: z.output<typeof profitReportQuerySchema>,
    @Res({ passthrough: true }) res: Response,
  ) {
    const report = await this.reports.profit(p.tenantId, query);
    return respond(
      res,
      query.format,
      report,
      `profit-${query.groupBy}-${report.from}-${report.to}`,
      (money) => [
        [
          query.groupBy,
          'revenue (ex tax)',
          'cost of goods',
          'gross profit',
          'margin %',
          'quantity without cost',
        ],
        ...report.rows.map((r) => [
          r.label,
          money(r.revenueMinor),
          money(r.costMinor),
          money(r.profitMinor),
          percent(r.marginBp),
          r.unknownCostQuantity,
        ]),
        [
          'TOTAL',
          money(report.totals.revenueMinor),
          money(report.totals.costMinor),
          money(report.totals.profitMinor),
          percent(report.totals.marginBp),
          report.totals.unknownCostQuantity,
        ],
      ],
    );
  }

  @Get('stock-valuation')
  @RequirePermissions('reports.profit')
  @ApiZodQuery(stockValuationQuerySchema)
  @ApiZodResponse(200, stockValuationSchema)
  @ApiProduces('application/json', 'text/csv')
  async stockValuation(
    @CurrentPrincipal() p: AuthPrincipal,
    @ZodQuery(stockValuationQuerySchema) query: z.output<typeof stockValuationQuerySchema>,
    @Res({ passthrough: true }) res: Response,
  ) {
    const report = await this.reports.stockValuation(p.tenantId, query.branchId);
    return respond(
      res,
      query.format,
      report,
      `stock-valuation-${report.asOf.slice(0, 10)}`,
      (money) => [
        ['sku', 'product', 'variant', 'quantity', 'average cost', 'value'],
        ...report.rows.map((r) => [
          r.sku,
          r.productName,
          r.variantLabel,
          r.quantity,
          money(r.averageCostMinor),
          money(r.valueMinor),
        ]),
        ['TOTAL', '', '', '', '', money(report.totals.valueMinor)],
      ],
    );
  }

  @Get('receivables')
  @RequirePermissions('reports.view')
  @ApiZodQuery(receivablesQuerySchema)
  @ApiZodResponse(
    200,
    receivablesReportSchema,
    'Customer balances by how long they have been owed.',
  )
  @ApiProduces('application/json', 'text/csv')
  async receivables(
    @CurrentPrincipal() p: AuthPrincipal,
    @ZodQuery(receivablesQuerySchema) query: z.output<typeof receivablesQuerySchema>,
    @Res({ passthrough: true }) res: Response,
  ) {
    const report = await this.reports.receivables(p.tenantId);
    return respond(
      res,
      query.format,
      report,
      `receivables-${report.asOf.slice(0, 10)}`,
      (money) => [
        [
          'number',
          'customer',
          'phone',
          'balance',
          '0-30 days',
          '31-60 days',
          '61-90 days',
          'over 90 days',
        ],
        ...report.rows.map((r) => [
          r.number,
          r.name,
          r.phone,
          money(r.balanceMinor),
          money(r['0_30']),
          money(r['31_60']),
          money(r['61_90']),
          money(r.OVER_90),
        ]),
        [
          'TOTAL',
          '',
          '',
          money(report.totals.balanceMinor),
          money(report.totals['0_30']),
          money(report.totals['31_60']),
          money(report.totals['61_90']),
          money(report.totals.OVER_90),
        ],
      ],
    );
  }
}
