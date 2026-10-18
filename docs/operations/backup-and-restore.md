# Backup and restore

What is backed up, how, for how long, and how a restore is proven to work. The scripts are
in `infra/backup`.

## What is backed up

| Data                           | Primary protection                                                                      | Our own backup                                                                                                                             |
| ------------------------------ | --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| PostgreSQL (all business data) | Managed database: automated snapshots and point-in-time recovery (keep at least 7 days) | Nightly `pg_dump` (custom format, compressed) with a SHA-256 checksum and a row-count manifest, copied off-site encrypted and kept 35 days |
| Product images (S3 bucket)     | Bucket versioning                                                                       | Nightly encrypted mirror off-site; deleted or replaced images kept 35 days                                                                 |
| Configuration and secrets      | The host's secret store                                                                 | Kept by operations in the company password manager, never in the backup bucket                                                             |

**Off-site copies**

- They go to a bucket in **another account, ideally another provider or region**, with
  credentials that cannot touch production.
- They are encrypted on the backup machine with rclone `crypt` before upload: the backup
  provider sees neither file names nor contents.
- The passphrase (`BACKUP_PASSPHRASE`) lives in the company password manager. **Without it,
  the backups cannot be read.**

## Targets

|                                             | Target   | How                                                                                                      |
| ------------------------------------------- | -------- | -------------------------------------------------------------------------------------------------------- |
| RPO (data that may be lost)                 | minutes  | Managed point-in-time recovery                                                                           |
| RPO if the database provider itself is lost | 24 hours | Nightly off-site dump                                                                                    |
| RTO (time to serve again)                   | 4 hours  | Restore into a new database, point the API at it (the restore itself takes minutes, see the drill below) |

## Nightly job

On the server, `infra/backup/nightly.sh` runs from cron or a systemd timer
(`15 1 * * *` is about 06:45 in Sri Lanka). It:

1. dumps the database (`backup-db.sh`, in `postgres:17.6-alpine`);
2. copies dumps off-site, mirrors the image bucket, and prunes copies older than 35 days
   (`offsite.sh backup`, in `rclone/rclone:1.71.1`);
3. keeps the newest three dumps on the server.

Settings come from `infra/backup/.env` (see `.env.example`). Alert if the job's log stops
showing `nightly backup finished` each day.

## Restoring

**Database, from point-in-time recovery** (most incidents):

1. Restore the managed database to a new instance at the chosen time.
2. Point `DATABASE_URL` and `MIGRATION_DATABASE_URL` at it.
3. Run `docker compose up -d`.

**Database, from an off-site dump** (provider lost, or older than the PITR window):

1. Fetch and decrypt the dumps: `docker compose run --rm offsite fetch-db`.
2. Create the roles on the new server (`infra/deploy/db-init.sql`, without
   `CREATE DATABASE`), then `createdb -O pos_owner pos`.
3. Restore: `pg_restore --dbname=<pos_owner url> --exit-on-error <dump>`.
4. Point the API at it and start. Running `restore-drill.sh` against the new server first
   proves the restore before switching over.

**Images:**

1. Run `offsite.sh restore-images` with `RESTORE_BUCKET` set to a new, empty bucket. The
   script copies the images and verifies every file against the encrypted copy.
2. Point `S3_BUCKET` (and `IMAGE_ORIGIN`) at that bucket.

## Restore drills

**Monthly**, and after any change to the database layout, run
`docker compose --profile drill run --rm drill`. It runs against a **separate drill
database server**, never production. The drill:

1. checks the dump's checksum;
2. restores it into a new database;
3. compares every table's row count with the manifest taken at backup time;
4. checks every migration finished;
5. connects as `pos_app` and confirms row-level security still applies: no rows without a
   tenant, the tenant's own rows with one;
6. drops the drill database and prints `DRILL PASSED` with the time taken.

Record each drill below.

### Drill log

| Date       | Backup                                                                    | Size                     | Result                 | Restore time | Notes                                                                                                                                         |
| ---------- | ------------------------------------------------------------------------- | ------------------------ | ---------------------- | ------------ | --------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-10-18 | load-test database (179,000 sales, 523,000 lines, 63 tables)              | 93 MB dump, 45 s to take | Passed                 | 34 s         | Development machine. All 63 tables' counts matched; 20 migrations; app role saw 0 rows without a tenant and 112,779 sales for the busiest one |
| 2026-10-18 | same dump, **fetched and decrypted from the off-site copy**               | 93 MB                    | Passed                 | 35 s         | Full disaster path: encrypted off-site copy → local → restore → checks                                                                        |
| 2026-10-18 | tampered copy of the dump (one byte changed)                              | 93 MB                    | **Failed as intended** | —            | Checksum mismatch detected before restoring                                                                                                   |
| 2026-10-18 | development database through `nightly.sh` and the compose `drill` service | small                    | Passed                 | 3 s          | First run caught a migration check that was too strict: early development had failed, rolled-back attempts. The check now looks per migration |
| 2026-10-18 | product images (137 files)                                                | 96 KB                    | Passed                 | —            | Restored into an empty bucket; `rclone cryptcheck` matched every file; the backup bucket held only encrypted names and contents               |

Production drills start with the pilot (Slice 14d).
