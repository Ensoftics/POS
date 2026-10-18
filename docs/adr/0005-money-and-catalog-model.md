# ADR 0005 — Money, quantities and the catalogue model

- **Status:** Accepted (2026-10-16)

## Context

A POS that adds up prices with binary floating point eventually produces receipts that are a
cent out. Shops in scope sell very different things: lipstick in shades, fabric by the metre,
groceries by the pack. One codebase must serve all of them.

## Decision

### Money

- Amounts are **integer minor units** of the tenant currency (`BIGINT` in PostgreSQL, a safe
  integer in JSON, capped at 999,999,999,999 minor units).
- User input is parsed from **decimal strings** (`parseMoney("1,250.50", "LKR") → 125050`)
  without ever creating a float. Too many decimals for the currency is an error, never rounded.
- Display uses `Intl.NumberFormat` with the tenant currency and the UI locale; CSV and edit
  fields use plain decimal strings (`minorToDecimalString`).
- Rounding policy for derived amounts (discounts, tax, splits) is defined with checkout in
  Slice 5; until then nothing is derived, so no rounding happens.

### Quantities

- Decimal strings with at most 3 decimals in the API; `DECIMAL(12,3)` in the database.
  Fractions are allowed only when the business profile enables part quantities.

### Catalogue

- **Product** = family (name, brand, category, unit). **Variant** = the sellable item
  (SKU, barcode, options, price, cost, pack size, reorder level). Every product has at least
  one variant; single-variant products simply have one with no options.
- Variant options are a JSON object restricted to the tenant's enabled attributes
  (shade, colour, size, …) with a canonical `attributes_key` that is unique per product.
- **SKUs and barcodes are unique per tenant, including archived items**, so a scan never
  resolves to two items and history stays unambiguous. Products and variants are archived,
  never deleted.
- Barcodes are stored as scanned; numeric GTIN-length codes must have a valid check digit.
- Costs are hidden from roles without `products.manage` (cashiers).
- Historical sale lines will copy name, SKU and price at sale time (Slice 5), so later catalogue
  edits never rewrite past receipts.

### CSV

- Import is two-phase: a dry run reports every problem with line and column; applying
  re-validates and writes everything in one transaction or nothing. Existing SKUs update their
  variant; new SKUs join the product with the same name and category or create it.
- Export neutralises spreadsheet formulas (`=`, `+`, `-`, `@` prefixes) and includes a UTF-8
  BOM so Excel shows Sinhala and Tamil text correctly.

## Consequences

- Clients must never do arithmetic on display strings; they convert through `@pos/domain`.
- Variant listing order is by SKU for now; a manual sort order can be added if shops need
  sizes in S/M/L order rather than alphabetical.
- `pg_trgm` is required for name search; managed PostgreSQL services allow it, but the
  migration role needs permission to `CREATE EXTENSION`.
