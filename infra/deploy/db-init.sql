-- Run once on a new production database as an administrator, before the first release.
--   psql "$ADMIN_URL" -v owner_password=... -v app_password=... -f db-init.sql
-- pos_owner owns the schema and runs migrations; pos_app is what the API uses
-- (no superuser, no BYPASSRLS, so row-level security applies to every query).
CREATE ROLE pos_owner LOGIN PASSWORD :'owner_password' NOSUPERUSER NOCREATEDB NOCREATEROLE;
CREATE ROLE pos_app LOGIN PASSWORD :'app_password' NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
CREATE DATABASE pos OWNER pos_owner;
\connect pos
REVOKE ALL ON DATABASE pos FROM PUBLIC;
GRANT CONNECT, TEMPORARY ON DATABASE pos TO pos_app;
ALTER SCHEMA public OWNER TO pos_owner;
GRANT USAGE ON SCHEMA public TO pos_app;
ALTER DEFAULT PRIVILEGES FOR ROLE pos_owner IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO pos_app;
ALTER DEFAULT PRIVILEGES FOR ROLE pos_owner IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO pos_app;
