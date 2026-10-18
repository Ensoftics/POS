import type { ValidationIssue } from '@pos/contracts';
import { parseQuantity } from '@pos/domain';
import { AppException } from '../common/app-exception';
import { assertBranchAllowed } from '../common/branch-access';
import { RequestContext } from '../common/request-context';
import type { Tx } from '../prisma/prisma.service';

export const DOCUMENT_PREFIXES = {
  purchase_order: 'PO',
  goods_receipt: 'GRN',
  stock_adjustment: 'ADJ',
  stock_transfer: 'TRF',
  stock_count: 'CNT',
  shift: 'SHF',
  sale: 'INV',
  sale_return: 'RET',
  customer: 'CUS',
  customer_payment: 'PAY',
  billing_invoice: 'SUB',
} as const;
export type DocumentKind = keyof typeof DOCUMENT_PREFIXES;

/**
 * Next gapless number for a tenant and document kind, e.g. "GRN-000042". The
 * upsert locks the sequence row until the surrounding transaction ends, so a
 * rolled-back document never consumes a number.
 */
export async function nextDocumentNumber(
  tx: Tx,
  tenantId: string,
  kind: DocumentKind,
): Promise<string> {
  const rows = await tx.$queryRaw<Array<{ value: number }>>`
    INSERT INTO document_sequences (tenant_id, kind, next_value) VALUES (${tenantId}::uuid, ${kind}, 2)
    ON CONFLICT (tenant_id, kind) DO UPDATE SET next_value = document_sequences.next_value + 1
    RETURNING next_value - 1 AS value`;
  return `${DOCUMENT_PREFIXES[kind]}-${String(rows[0]!.value).padStart(6, '0')}`;
}

export function variantLabel(attributes: unknown): string {
  return Object.values((attributes ?? {}) as Record<string, string>).join(' / ');
}

export interface ItemInfo {
  variantId: string;
  productId: string;
  productName: string;
  sku: string;
  variantLabel: string;
  unit: string;
  active: boolean;
}

export async function loadItems(
  tx: Tx,
  tenantId: string,
  variantIds: string[],
): Promise<Map<string, ItemInfo>> {
  const rows = await tx.productVariant.findMany({
    where: { tenantId, id: { in: [...new Set(variantIds)] } },
    include: { product: { select: { name: true, unit: true, status: true } } },
  });
  return new Map(
    rows.map((row) => [
      row.id,
      {
        variantId: row.id,
        productId: row.productId,
        productName: row.product.name,
        sku: row.sku,
        variantLabel: variantLabel(row.attributes),
        unit: row.product.unit,
        active: row.status === 'ACTIVE' && row.product.status === 'ACTIVE',
      },
    ]),
  );
}

export const itemFields = (item: ItemInfo | undefined, variantId: string) => ({
  variantId,
  productName: item?.productName ?? '',
  sku: item?.sku ?? '',
  variantLabel: item?.variantLabel ?? '',
  unit: item?.unit ?? 'piece',
});

/**
 * Checks that every line's item exists in this tenant (other tenants' items are
 * invisible under RLS, so they report as not found), is active when required,
 * and that fractional quantities are allowed by the business profile.
 */
export function checkLines(
  lines: Array<{ variantId: string; quantity?: string }>,
  items: Map<string, ItemInfo>,
  options: { allowFraction: boolean; requireActive: boolean },
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  lines.forEach((line, index) => {
    const item = items.get(line.variantId);
    if (!item) {
      issues.push({ path: `lines.${index}.variantId`, message: 'validation.item.not_found' });
      return;
    }
    if (options.requireActive && !item.active) {
      issues.push({ path: `lines.${index}.variantId`, message: 'validation.item.archived' });
    }
    if (line.quantity) {
      const parsed = parseQuantity(line.quantity.replace(/^-/, ''), {
        allowFraction: options.allowFraction,
      });
      if (!parsed.ok)
        issues.push({
          path: `lines.${index}.quantity`,
          message: `validation.quantity.${parsed.issue}`,
        });
    }
  });
  return issues;
}

/** Active branch of this tenant, or a field issue. */
export async function checkBranch(
  tx: Tx,
  tenantId: string,
  branchId: string,
  path: string,
  /** False for a transfer's destination: staff may send stock to branches they don't work at. */
  requireAccess = true,
) {
  if (requireAccess) assertBranchAllowed(RequestContext.get()?.principal, branchId);
  const branch = await tx.branch.findFirst({ where: { id: branchId, tenantId } });
  if (!branch) return { branch: null, issues: [{ path, message: 'validation.branch.not_found' }] };
  if (branch.status !== 'ACTIVE')
    return { branch: null, issues: [{ path, message: 'validation.branch.archived' }] };
  return { branch, issues: [] as ValidationIssue[] };
}

export function invalidState(message: string) {
  return new AppException('INVALID_STATE', 409, message);
}
