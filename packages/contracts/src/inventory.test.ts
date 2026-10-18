import { describe, expect, it } from 'vitest';
import {
  createGoodsReceiptRequestSchema,
  createPurchaseOrderRequestSchema,
  createStockAdjustmentRequestSchema,
  createStockTransferRequestSchema,
} from './index';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const V = '33333333-3333-4333-8333-333333333333';

const messages = (result: { error?: { issues: { message: string; path: PropertyKey[] }[] } }) =>
  result.error?.issues.map((issue) => `${issue.path.join('.')}:${issue.message}`) ?? [];

describe('inventory requests', () => {
  it('requires positive quantities with at most three decimals', () => {
    const base = {
      id: A,
      branchId: B,
      lines: [{ variantId: V, unitCostMinor: 100, quantity: '0' }],
    };
    expect(messages(createGoodsReceiptRequestSchema.safeParse(base))).toContain(
      'lines.0.quantity:validation.quantity.positive',
    );
    expect(
      createGoodsReceiptRequestSchema.safeParse({
        ...base,
        lines: [{ variantId: V, unitCostMinor: 100, quantity: '2.5' }],
      }).success,
    ).toBe(true);
    expect(
      createGoodsReceiptRequestSchema.safeParse({
        ...base,
        lines: [{ variantId: V, unitCostMinor: 100, quantity: '1.0001' }],
      }).success,
    ).toBe(false);
  });

  it('rejects the same item twice on an order', () => {
    const result = createPurchaseOrderRequestSchema.safeParse({
      supplierId: A,
      branchId: B,
      lines: [
        { variantId: V, quantity: '1', unitCostMinor: 1 },
        { variantId: V, quantity: '2', unitCostMinor: 1 },
      ],
    });
    expect(messages(result)).toContain('lines.1.variantId:validation.lines.duplicate_item');
  });

  it('enforces the direction implied by the adjustment reason', () => {
    const adjust = (reason: string, quantity: string) =>
      messages(
        createStockAdjustmentRequestSchema.safeParse({
          id: A,
          branchId: B,
          reason,
          lines: [{ variantId: V, quantity }],
        }),
      );
    expect(adjust('DAMAGED', '2')).toContain(
      'lines.0.quantity:validation.adjustment.must_decrease',
    );
    expect(adjust('FOUND', '-2')).toContain('lines.0.quantity:validation.adjustment.must_increase');
    expect(adjust('CORRECTION', '-2')).toEqual([]);
    expect(adjust('CORRECTION', '0')).toContain('lines.0.quantity:validation.quantity.non_zero');
  });

  it('rejects transfers to the same branch', () => {
    const result = createStockTransferRequestSchema.safeParse({
      id: A,
      fromBranchId: B,
      toBranchId: B,
      lines: [{ variantId: V, quantity: '1' }],
    });
    expect(messages(result)).toContain('toBranchId:validation.transfer.same_branch');
  });
});
