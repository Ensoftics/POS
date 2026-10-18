-- Returns, refunds and cash movements are financial records: the application may add
-- them but never change or remove them. The role's default privileges grant UPDATE and
-- DELETE on new tables, so they are revoked explicitly (as for sales and the stock ledger).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'pos_app') THEN
    REVOKE UPDATE, DELETE, TRUNCATE ON "sale_returns", "sale_return_lines", "sale_return_refunds", "cash_movements" FROM pos_app;
  END IF;
END
$$;
