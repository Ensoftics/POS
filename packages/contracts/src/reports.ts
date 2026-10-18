import { z } from 'zod';
import { AGEING_BUCKETS } from '@pos/domain';
import { isoDateTimeSchema, uuidSchema } from './common';
import { isoDateSchema } from './inventory';

/**
 * Reports run over business days in the tenant's timezone (inclusive). Without
 * dates they cover the last seven days up to today. `format=csv` returns the same
 * rows as a CSV download (spreadsheet formulas neutralised).
 */
export const reportRangeQuerySchema = z.object({
  from: isoDateSchema.optional(),
  to: isoDateSchema.optional(),
  branchId: uuidSchema.optional(),
  format: z.enum(['json', 'csv']).default('json'),
});
export type ReportRangeQuery = z.input<typeof reportRangeQuerySchema>;

export const SALES_GROUPS = [
  'day',
  'branch',
  'cashier',
  'category',
  'product',
  'payment_method',
] as const;
export type SalesGroup = (typeof SALES_GROUPS)[number];

export const salesReportQuerySchema = reportRangeQuerySchema.extend({
  groupBy: z.enum(SALES_GROUPS).default('day'),
});
export type SalesReportQuery = z.input<typeof salesReportQuerySchema>;

const amounts = {
  saleCount: z.number().int(),
  /** Decimal string; only for product and category groups. */
  quantity: z.string().nullable(),
  discountMinor: z.number().int(),
  taxMinor: z.number().int(),
  /** What customers paid (tax included). For payment methods: received, net of change. */
  totalMinor: z.number().int(),
  /** Refunded in the period (by the date of the return). */
  refundsMinor: z.number().int(),
  netMinor: z.number().int(),
};

export const salesReportSchema = z.object({
  from: isoDateSchema,
  to: isoDateSchema,
  currency: z.string(),
  groupBy: z.enum(SALES_GROUPS),
  rows: z.array(z.object({ key: z.string(), label: z.string(), ...amounts })),
  totals: z.object(amounts),
});
export type SalesReport = z.infer<typeof salesReportSchema>;

export const taxReportSchema = z.object({
  from: isoDateSchema,
  to: isoDateSchema,
  currency: z.string(),
  rows: z.array(
    z.object({
      name: z.string().nullable(),
      rateBp: z.number().int(),
      taxableMinor: z.number().int(),
      taxMinor: z.number().int(),
      refundedTaxMinor: z.number().int(),
      netTaxMinor: z.number().int(),
    }),
  ),
  totals: z.object({
    taxableMinor: z.number().int(),
    taxMinor: z.number().int(),
    refundedTaxMinor: z.number().int(),
    netTaxMinor: z.number().int(),
  }),
});
export type TaxReport = z.infer<typeof taxReportSchema>;

export const PROFIT_GROUPS = ['day', 'category', 'product'] as const;
export const profitReportQuerySchema = reportRangeQuerySchema.extend({
  groupBy: z.enum(PROFIT_GROUPS).default('day'),
});
export type ProfitReportQuery = z.input<typeof profitReportQuerySchema>;

const profitAmounts = {
  /** Sales excluding tax, net of returns. */
  revenueMinor: z.number().int(),
  /** Cost of goods sold at moving average cost, net of returned goods. */
  costMinor: z.number().int(),
  profitMinor: z.number().int(),
  marginBp: z.number().int().nullable(),
  /** Sold quantity without any known cost (excluded from cost; profit is overstated by it). */
  unknownCostQuantity: z.string(),
};
export const profitReportSchema = z.object({
  from: isoDateSchema,
  to: isoDateSchema,
  currency: z.string(),
  groupBy: z.enum(PROFIT_GROUPS),
  rows: z.array(z.object({ key: z.string(), label: z.string(), ...profitAmounts })),
  totals: z.object(profitAmounts),
});
export type ProfitReport = z.infer<typeof profitReportSchema>;

export const stockValuationQuerySchema = z.object({
  branchId: uuidSchema.optional(),
  format: z.enum(['json', 'csv']).default('json'),
});
export type StockValuationQuery = z.input<typeof stockValuationQuerySchema>;

export const stockValuationSchema = z.object({
  asOf: isoDateTimeSchema,
  currency: z.string(),
  rows: z.array(
    z.object({
      variantId: uuidSchema,
      sku: z.string(),
      productName: z.string(),
      variantLabel: z.string(),
      quantity: z.string(),
      /** Rounded to a minor unit; null when the item has no cost at all. */
      averageCostMinor: z.number().int().nullable(),
      valueMinor: z.number().int().nullable(),
    }),
  ),
  totals: z.object({ valueMinor: z.number().int(), itemsWithoutCost: z.number().int() }),
});
export type StockValuation = z.infer<typeof stockValuationSchema>;

const ageing = Object.fromEntries(AGEING_BUCKETS.map((b) => [b, z.number().int()])) as Record<
  (typeof AGEING_BUCKETS)[number],
  z.ZodNumber
>;
export const receivablesReportSchema = z.object({
  asOf: isoDateTimeSchema,
  currency: z.string(),
  rows: z.array(
    z.object({
      customerId: uuidSchema,
      number: z.string(),
      name: z.string(),
      phone: z.string().nullable(),
      balanceMinor: z.number().int(),
      ...ageing,
    }),
  ),
  totals: z.object({ balanceMinor: z.number().int(), ...ageing }),
});
export type ReceivablesReport = z.infer<typeof receivablesReportSchema>;

export const receivablesQuerySchema = z.object({ format: z.enum(['json', 'csv']).default('json') });

export const dashboardQuerySchema = z.object({ branchId: uuidSchema.optional() });

const dayTotals = z.object({
  salesMinor: z.number().int(),
  saleCount: z.number().int(),
  averageSaleMinor: z.number().int(),
  refundsMinor: z.number().int(),
});
export const dashboardSchema = z.object({
  today: isoDateSchema,
  currency: z.string(),
  todayTotals: dayTotals,
  yesterdayTotals: dayTotals,
  last7Days: z.array(
    z.object({ date: isoDateSchema, salesMinor: z.number().int(), saleCount: z.number().int() }),
  ),
  topProducts: z.array(
    z.object({ label: z.string(), quantity: z.string(), totalMinor: z.number().int() }),
  ),
  lowStockCount: z.number().int(),
  openShifts: z.number().int(),
  openConflicts: z.number().int(),
  receivablesMinor: z.number().int(),
});
export type Dashboard = z.infer<typeof dashboardSchema>;
