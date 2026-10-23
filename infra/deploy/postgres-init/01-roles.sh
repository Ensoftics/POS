#!/bin/sh
# Runs once, when the database volume is first created.
# pos_owner owns the schema and runs migrations; pos_app is what the API uses
# (no superuser, no BYPASSRLS, so row-level security applies to every query).
set -eu
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname postgres <<-EOSQL
  CREATE ROLE pos_owner LOGIN PASSWORD '${POS_OWNER_PASSWORD}' NOSUPERUSER NOCREATEDB NOCREATEROLE;
  CREATE ROLE pos_app LOGIN PASSWORD '${POS_APP_PASSWORD}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
  CREATE DATABASE pos OWNER pos_owner;
EOSQL
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname pos <<-EOSQL
  REVOKE ALL ON DATABASE pos FROM PUBLIC;
  GRANT CONNECT, TEMPORARY ON DATABASE pos TO pos_app;
  ALTER SCHEMA public OWNER TO pos_owner;
  GRANT USAGE ON SCHEMA public TO pos_app;
  ALTER DEFAULT PRIVILEGES FOR ROLE pos_owner IN SCHEMA public
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO pos_app;
  ALTER DEFAULT PRIVILEGES FOR ROLE pos_owner IN SCHEMA public
    GRANT USAGE, SELECT ON SEQUENCES TO pos_app;
EOSQL
