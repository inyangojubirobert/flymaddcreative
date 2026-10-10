# Revision 4 Migration Readiness Report

Date: 2026-10-10. Scope: isolated local staging only (real PostgreSQL 18 via embedded-postgres, PostgREST 16.4, real API handlers). No SQL was run against live Supabase, nothing was deployed, and no payment infrastructure was touched. Live access was limited to read-only anon `GET` requests.

## Verdict: READY for production execution, conditional on the items under "Before you run it"

The **revised** migration passed every check. The original migration failed checks 3 and 8.

## Results

| # | Check | Result | Evidence |
|---|---|---|---|
| 1 | Earlier catalogue write lockdown is applied | **BLOCKED** live, **PASS** on staging | The anon key cannot read grants, and no write probes were attempted. The migration refuses to run, and changes nothing, if `anon` or `authenticated` can still write `catalogue_items` (C1a, C1b). Verify live with the SQL below. |
| 2 | Checkout-compatible models cannot change without approval | **PASS** | `anon`, `authenticated` and `service_role` cannot change models, record approvals or call the approval function. A stale approval cannot authorise a change. Identity and timestamp cannot be forged. The approval log is append-only (C2a-C2e). |
| 3 | Concurrent draft linking vs seller ownership change | **FAIL** original, **PASS** revised | On real PostgreSQL the original left an inconsistent draft/listing seller row in both orderings. The revised migration leaves 0 inconsistent rows. |
| 4 | Categories, covers, listings, relationships preserved | **PASS** | IDs, slugs, parents, covers, banners and listings are identical. Columns are purely additive. Payment tables, indexes, triggers, functions, grants, policies and rows fingerprint identically before and after (C4, C4-pay, C4b). |
| 5 | Backward compatibility with the deployed API | **PASS** | The previous API's create, update, pause, soft-delete and read shapes work after migration. Engine tables are unreadable by `anon` and `authenticated` (C5, C5b; API phase C 3/3). |
| 6 | Full migration and rollback on staging | **PASS** | The migration is idempotent. Rollback restores the original schema and keeps categories, covers, listings and payments, and archives engine data. The migration re-applies cleanly after rollback (C6a-C6c). |
| 7 | Staging API creates products, services and drafts | **PASS** | Real handlers behind PostgREST: 32/32 pass. Covers product and service creation, authentication, seller ownership, drafts and publish. Before migration, drafts return 503 and new-field creation is rejected. |
| 8 | Deployment interruption and locking risk | **FAIL** original, **PASS** revised | The original queued behind an open transaction with no `lock_timeout`. The revised one fails with `55P03` after about 5 s and leaves the schema clean. The migration took about 150 ms on staging. |

## Fixes applied (unapplied to production)

- `supabase/add_dynamic_listing_engine.sql`
  - `set local lock_timeout = '5s';` after `begin;`.
  - The draft owner guard reads the item seller with `FOR SHARE`.
  - The seller-change guard locks its own row with `FOR UPDATE` before counting linked drafts.
- `supabase/rollback_dynamic_listing_engine.sql`: `set local lock_timeout = '5s';`.
- `supabase/dry_run_dynamic_listing_engine.sql`: regenerated. Local dry run: 141 assertions passed, 0 failed.

## Residual risk (accepted)

The database owner can insert an approval row and update in the same transaction (C2f). No API role can do this, it leaves an append-only audit row, and owners can already disable triggers.

## Before you run it

1. Verify the lockdown in the Supabase SQL editor. Only `SELECT` should appear.
   ```sql
   select grantee, privilege_type from information_schema.role_table_grants
   where table_schema='public' and table_name='catalogue_items' and grantee in ('anon','authenticated');
   ```
2. Take a fresh backup.
3. Use the revised files, not the earlier copy.
4. Never deploy new API code ahead of the migration. Until the schema exists, `POST /api/catalogue/items` returns 500 and drafts return 503. The "Saved drafts could not be loaded" error suggests the new code may already be live.

## Test harnesses

- `scripts/local-listing-engine-check/readiness-checks.mjs` (19 checks; `node readiness-checks.mjs [migration.sql] [rollback.sql]`)
- `scripts/local-listing-engine-check/api-staging-check.mjs` (32 checks against the real handlers)
- `scripts/local-listing-engine-check/run-local-dry-run.mjs` (PGlite dry run)

## Payment infrastructure

No payment file, function, API, database object or configuration was changed. The payment-object fingerprint is identical before and after the migration.
