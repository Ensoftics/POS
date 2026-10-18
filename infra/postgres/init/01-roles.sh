#!/bin/sh
# Runs once when the Postgres volume is first created.
# - Creates the restricted application role `pos_app` (no superuser, no BYPASSRLS).
# - Creates the integration-test database `pos_test`.
# - Grants pos_app DML privileges on tables that pos_owner creates via migrations.
set -eu

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-EOSQL
  CREATE ROLE pos_app LOGIN PASSWORD '${POS_APP_PASSWORD}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
  CREATE DATABASE pos_test OWNER ${POSTGRES_USER};
EOSQL

for db in "$POSTGRES_DB" pos_test; do
  psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$db" <<-EOSQL
    REVOKE ALL ON DATABASE ${db} FROM PUBLIC;
    GRANT CONNECT, TEMPORARY ON DATABASE ${db} TO pos_app;
    GRANT USAGE ON SCHEMA public TO pos_app;
    ALTER DEFAULT PRIVILEGES FOR ROLE ${POSTGRES_USER} IN SCHEMA public
      GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO pos_app;
    ALTER DEFAULT PRIVILEGES FOR ROLE ${POSTGRES_USER} IN SCHEMA public
      GRANT USAGE, SELECT ON SEQUENCES TO pos_app;
EOSQL
done
