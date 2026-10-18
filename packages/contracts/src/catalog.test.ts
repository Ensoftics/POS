import { describe, expect, it } from 'vitest';
import {
  createProductRequestSchema,
  updateVariantRequestSchema,
  variantInputSchema,
} from './index';

const messages = (result: { error?: { issues: { message: string; path: PropertyKey[] }[] } }) =>
  result.error?.issues.map((issue) => `${issue.path.join('.')}:${issue.message}`) ?? [];

const product = {
  name: 'Matte Lipstick',
  unit: 'piece',
  variants: [
    { sku: 'lip-red', barcode: '4006381333931', attributes: { shade: 'Red' }, priceMinor: 125000 },
    { sku: 'LIP-NUDE', attributes: { shade: 'Nude' }, priceMinor: 125000 },
  ],
};

describe('createProductRequestSchema', () => {
  it('normalises SKUs and defaults attributes', () => {
    const parsed = createProductRequestSchema.parse({
      ...product,
      variants: [{ sku: ' sku-1 ', priceMinor: 100 }],
    });
    expect(parsed.variants[0]).toMatchObject({ sku: 'SKU-1', attributes: {} });
  });

  it('flags duplicate SKUs, barcodes and option combinations within the request', () => {
    const result = createProductRequestSchema.safeParse({
      ...product,
      variants: [
        { sku: 'A1', barcode: 'CODE-1', attributes: { shade: 'Red' }, priceMinor: 1 },
        { sku: 'a1', barcode: 'CODE-1', attributes: { shade: ' red ' }, priceMinor: 1 },
      ],
    });
    expect(messages(result)).toEqual(
      expect.arrayContaining([
        'variants.1.sku:validation.sku.duplicate',
        'variants.1.barcode:validation.barcode.duplicate',
        'variants.1.attributes:validation.attribute.duplicate_combination',
      ]),
    );
  });

  it('requires at least one variant', () => {
    expect(messages(createProductRequestSchema.safeParse({ ...product, variants: [] }))).toContain(
      'variants:validation.variants.required',
    );
  });
});

describe('variantInputSchema', () => {
  it('rejects bad barcodes, fractional or negative money and unknown attributes', () => {
    const result = variantInputSchema.safeParse({
      sku: 'X',
      barcode: '4006381333932',
      priceMinor: 10.5,
      costMinor: -1,
      attributes: { flavour: 'Mint', wingspan: 'big' },
    });
    expect(messages(result)).toEqual(
      expect.arrayContaining([
        'barcode:validation.barcode.checksum',
        'priceMinor:validation.money.invalid',
        'costMinor:validation.money.negative',
      ]),
    );
    expect(
      result.error?.issues.some((issue) => issue.path.join('.').startsWith('attributes')),
    ).toBe(true);
  });

  it('accepts decimal reorder levels as strings', () => {
    expect(
      variantInputSchema.parse({ sku: 'FAB-1', priceMinor: 50000, reorderLevel: '12.5' })
        .reorderLevel,
    ).toBe('12.5');
    expect(
      variantInputSchema.safeParse({ sku: 'FAB-1', priceMinor: 1, reorderLevel: '1.2345' }).success,
    ).toBe(false);
  });
});

describe('updateVariantRequestSchema', () => {
  it('turns an empty barcode into null (clear it)', () => {
    expect(updateVariantRequestSchema.parse({ version: 1, barcode: '' }).barcode).toBeNull();
  });
});
