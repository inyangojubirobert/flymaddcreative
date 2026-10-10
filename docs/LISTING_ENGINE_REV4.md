# Listing engine revision 4: changes, security review, rollback and dry run

Status: **listing-engine code implemented locally; migration not applied to production.** Production approval is withheld until you have run the dry run in Supabase and reviewed its report. No payment file, endpoint, table, function, trigger, policy or setting was changed (see the last section).

Files:

| File | Purpose |
|---|---|
| `supabase/add_dynamic_listing_engine.sql` | Revision 4 migration (unexecuted) |
| `supabase/rollback_dynamic_listing_engine.sql` | Matching rollback: archive, verify, then drop |
| `supabase/dry_run_dynamic_listing_engine.sql` | Generated from the two files above. Always rolls back |
| `scripts/build-listing-engine-dry-run.mjs` | Regenerates the dry run. Rerun after any change to the migration or rollback |
| `scripts/local-listing-engine-check/` | Local PostgreSQL emulation used to test the dry run before you run it |
| `pages/api/catalogue/drafts.js` | Authenticated, seller-owned draft CRUD and guarded publish endpoint |
| `lib/catalogueListingConfigurationValidation.js` | Shared server-side validation for configured units and category attributes |

Application integration added locally:

- Authenticated listing writes validate listing type, pricing configuration, category compatibility, configured units, service terms and configured attributes in `pages/api/catalogue/items.js` and `lib/catalogueListingValidation.js`.
- Sellers can save, edit, delete and publish private listing drafts from the website and mobile forms. Draft data is scoped to the authenticated seller; server-controlled ownership and publish links cannot be supplied by clients.
- Draft-only pricing, price ranges, stock descriptions and quantity constraints remain private until they fit the existing single-item checkout. Publishing rejects non-checkout-compatible pricing, ranges, pricing options, inventory constraints and incomplete listing details.
- The mobile and website seller forms collect product/service type, compatible category, checkout-compatible advertised pricing, configured/custom units, fulfillment or service modes and service scope/terms. Category-configured fields are rendered dynamically in both forms.
- Mobile catalogue details/cards show the listing type, advertised price unit, scope, terms and informational metadata. The existing checkout screen and payment routes remain unchanged.
- The listing migration remains a separate prerequisite. The updated seller clients/API require it before new-type listings can be created.

## 1. Revision 3 vs revision 4

| Area | Revision 3 | Revision 4 |
|---|---|---|
| Who can change which pricing models checkout accepts | Function closed to `anon`/`authenticated`, but `service_role` kept Supabase's default access to the function, the approvals table and `catalogue_pricing_models` | Only the database owner. `service_role` can read pricing models and has **no** access to approval records, the approval function or pricing-model writes. The function also refuses any caller that is not the owner (second line of defence) |
| Approver identity | Free-text `approved_by` supplied by the caller | Removed. The database records `session_user` and `current_user` and overwrites anything supplied, including the timestamp |
| Approval audit trail | Blocked UPDATE/DELETE, not TRUNCATE; initial seeds had no record | UPDATE, DELETE **and TRUNCATE** blocked for every role, including the owner; every checkout-compatible model, seeds included, has an approval record (checked by the migration) |
| Function signature | `catalogue_set_checkout_compatible(key, value, reference, approved_by)` | `catalogue_set_checkout_compatible(key, value, reference)` |
| Visibility of product/service details and attributes | Only when the listing was `active` (a paused listing showed without its details) | Whenever the caller can see the listing itself. The policy sub-selects `catalogue_items` under the caller's own RLS, so the existing rule (`status <> 'deleted'`) is followed with no copy of it. `catalogue_items`' own read policy is unchanged. A security-definer helper function was removed |
| Drafts | Private | Still private: RLS on, no grants to `anon`/`authenticated`, API only |
| Listing status | Any text | `active`, `paused` or `deleted` only; null refused. The migration first checks existing rows and stops with a message if any listing is outside the set, so the constraint is added fully validated |
| Draft-to-listing ownership | Not enforced | Database triggers (every role): a draft links only to a listing with the same `seller_username`; the listing's seller cannot be changed while another seller's draft is linked; a draft's seller cannot be changed to break the link |
| Public execution of functions | Approval function revoked; others implicit | All eight functions revoked from PUBLIC, `anon`, `authenticated` and `service_role`. The migration verifies this and aborts if not true. `search_path` is `pg_catalog, public, pg_temp` on every function |
| Preconditions | None | Refuses to run if the lockdown is missing, if the Supabase roles are missing or if a listing has an invalid status |
| Migration self-check | Counts only | Aborts the whole transaction if any role has a privilege it should not have, or lacks one it needs |
| Rollback | Dropped everything, losing data | Archives all engine data to a private schema, verifies row-for-row, then drops (see section 4) |

## 2. Security review

**Pricing-model approval.** The decision "this pricing model is a correct, complete sale under the existing checkout" is the only thing in the engine that widens what can be sold. It is now restricted to the database owner (`postgres` in the Supabase SQL editor). A leaked `service_role` key, a bug in the API or a malicious seller cannot change it, and cannot add or edit pricing models either. `approval_reference` is a human label for your change request; it is not proof of authorization. The proof is who the database says made the change, recorded in `recorded_session_user` and `recorded_current_user`.

**Boundaries that are not absolute.** The table owner and PostgreSQL superusers (for example `supabase_admin`) can still drop triggers, disable them, or edit rows. Nothing here can stop them, and the document does not claim it does. Protection is against the API roles and compromised application code, not against someone with owner-level database access.

**Privilege escalation review.**

| Object | Finding |
|---|---|
| `catalogue_set_checkout_compatible` | `SECURITY INVOKER`: it runs with the caller's own rights, so it cannot lend the owner's privileges. Not executable by any API role. Refuses non-owner callers |
| Trigger functions (`SECURITY DEFINER`: pricing-models guard, listing rules, categories guard, draft owner guard, listing seller guard) | Each pins `search_path` and schema-qualifies its tables. Not executable by any API role. Trigger functions are not exposed as API RPC endpoints, and EXECUTE is not needed for a trigger to fire. They only read configuration and raise errors; none can modify data on behalf of a caller |
| Trigger functions (`SECURITY INVOKER`: identity stamp, append-only) | No privileges beyond the writer's |
| New tables | RLS on for all eight. Public roles: read-only on configuration and details, nothing on drafts or approvals |
| Public API surface | PostgREST only exposes functions the role can execute and tables it can access. After revocation `anon` and `authenticated` can call none of the new functions and cannot reach drafts, approvals or the archive |
| Supabase default grants | Supabase grants new tables and functions to the API roles by default. The migration revokes them explicitly and then verifies the effective result with `has_table_privilege` / `has_function_privilege` / `has_sequence_privilege` per privilege (not "any of"), failing the whole transaction on any mismatch |
| `service_role` and `catalogue_items` | Existing access to `catalogue_items` is unchanged because checkout and the listings API depend on it. The new triggers apply to it like any other role |
| Direct database connections with API roles | Supabase API keys cannot run DDL through the REST API; this review assumes the database password is not shared |

**Remaining risks (not fixed here):**

- Payment endpoints still accept `paused` listings and invalid prices, and a USDT transaction can be reused. The status constraint is data integrity only and does not stop a paused listing being purchased. See `docs/PAYMENT_SECURITY_FINDINGS.md`. The marketplace is not described as fully secured.
- Ownership of product/service details and item attributes is checked by the API only (they have no seller column). Listing writes and draft publishing check the logged-in seller for every write.
- `catalogue_units` and `catalogue_attribute_definitions` stay writable by `service_role`: they are display configuration and not security-relevant. Say if you want them owner-only too.

## 3. Effective permissions after the migration

Reported by the dry run and checked by the migration itself (from the local run; the Supabase run prints the same table for production).

| Table | anon | authenticated | service_role | owner |
|---|---|---|---|---|
| `catalogue_pricing_models` | SELECT | SELECT | SELECT | all |
| `catalogue_checkout_model_approvals` | none | none | **none** | all |
| `catalogue_units`, `catalogue_attribute_definitions`, `catalogue_product_details`, `catalogue_service_details`, `catalogue_item_attributes` | SELECT | SELECT | SELECT, INSERT, UPDATE, DELETE | all |
| `catalogue_listing_drafts` | none | none | SELECT, INSERT, UPDATE, DELETE | all |
| All eight functions | no | no | no | owner only (the approval function) |
| `catalogue_engine_archive` (created only by a rollback) | none | none | none | all |

`service_role` never gets TRUNCATE, REFERENCES or TRIGGER on any new table.

## 4. Rollback and archive

`supabase/rollback_dynamic_listing_engine.sql` is an emergency recovery tool, not an undo button. Take a full database backup before running it.

1. Creates the schema `catalogue_engine_archive`, **outside** everything the script drops. No grants to PUBLIC, `anon`, `authenticated` or `service_role`, RLS on. Never add it to the API's exposed schemas.
2. Copies, per run: drafts, product/service details, item attributes, attribute definitions, pricing models (including `checkout_compatible`), units, approval records, each listing's classification (type, pricing model, unit, scope, terms, review flags) and each category's listing types.
3. Verifies each source row-for-row (count and content hash) and confirms no API role can reach the archive. Any mismatch aborts before anything is dropped.
4. Gate: nothing is dropped unless this transaction produced a verified archive.
5. Drops the engine, without CASCADE, so an unexpected dependency fails loudly and undoes everything, archive included. Original listing columns and values are untouched.
6. Final check that the archive survived.

The archive is never deleted by the script, so a rollback cannot destroy the only copy. Because it holds drafts and seller business details, only the database owner can read it. Delete it yourself when no longer needed: `drop schema catalogue_engine_archive cascade;`. Backups taken earlier will still contain the data.

Restoring after a rollback: re-run the migration, then copy rows back with `jsonb_populate_record` (an example is in the rollback file's header). The dry run proves this for drafts, product details, service details and item attributes. Pricing configuration, approval records and listing classification are archived and can be read, but restoring them is a manual step.

## 5. Dry run

`supabase/dry_run_dynamic_listing_engine.sql` runs inside one transaction that always ends in a deliberate error, so nothing can be committed. It:

1. snapshots every public table, trigger, policy, constraint, index, function and grant, plus the listings and categories;
2. runs the migration twice (repeatability);
3. runs 125 required checks. They cover:
   - **Listing rules:** prices, pricing models, services, category restrictions.
   - **Status values:** only `active`, `paused` and `deleted` are accepted.
   - **Approvals:** owner-only approval, the database-recorded identity, spoofing attempts, and append-only protection including TRUNCATE.
   - **API roles:** as `service_role`, `authenticated` and `anon`, every write path is closed and every legitimate API path still works.
   - **Defence in depth:** the function refuses a non-owner even if EXECUTE were granted by mistake.
   - **Visibility:** an active, a paused and a deleted listing, each with its details.
   - **Draft ownership:** all directions, including `service_role`.
   - **Exposed functions:** none of the new functions is executable by PUBLIC or an API role.
4. diffs every database object against the snapshot to prove nothing outside the listing engine changed (payment tables, functions, triggers, policies, indexes and grants included);
5. adds sample data, runs the rollback script, checks the database equals the snapshot and the archive holds the data and is unreachable, runs the rollback again, re-applies the migration and restores drafts, details and attributes from the archive.

**Reading the result.** Supabase shows an error either way. Only a message starting `DRY_RUN_RESULT:` is a verdict:

- `DRY_RUN_RESULT: PASS` means every assertion passed and all 125 required test IDs ran. A script that stops early cannot produce PASS.
- `DRY_RUN_RESULT: FAIL` means it ran, but assertions failed. They are listed first.
- Any other error is a genuine SQL or migration failure and the dry run did not pass. Nothing was saved in any case.

**How to run it in Supabase:**

1. Supabase dashboard > SQL Editor > New query. Leave the role as the default (`postgres`).
2. Open `supabase/dry_run_dynamic_listing_engine.sql` in the repository, select all (about 260 KB, 4,900 lines), copy and paste it. Pasting can take a few seconds.
3. Click Run. Expect a red error. Copy the **whole** message (it is long; the first line is the verdict) and send it to me.
4. If a later query says "current transaction is aborted", run `rollback;`.
5. To confirm nothing was kept, run `select to_regclass('public.catalogue_pricing_models');`. It must return null.

Alternative with `psql`: `psql "<connection string>" -v ON_ERROR_STOP=1 -f supabase/dry_run_dynamic_listing_engine.sql`.

## 6. What was verified locally, and what was not

The dry run was executed against PGlite, a real PostgreSQL engine in WebAssembly, set up to imitate production: Supabase roles with `service_role` bypassing RLS, a non-superuser owner that is a member of those roles, Supabase default privileges, your catalogue tables with RLS and the single read policy, the lockdown grants, the two live listings with an order, and stand-in payment tables, a function and a trigger.

- Result: **PASS, 141 assertions, 0 failed, all 125 required tests ran.** The raw migration and rollback files also ran committed in sequence: migration, migration again, rollback, migration after rollback.
- The checks were mutation-tested. Fifteen deliberate defects each made the run fail, or made the migration abort, with a clear message:
  - a payment table altered;
  - `service_role` keeping approval access;
  - the approval function open to `anon`;
  - a trigger function executable by `anon`;
  - the owner check removed;
  - details visible only for active listings;
  - the status constraint missing;
  - the draft-owner, listing-seller, TRUNCATE and identity triggers each removed;
  - the rollback forgetting a table;
  - the archive exposed to `service_role`;
  - the lockdown missing;
  - a listing with status `sold`.
- Not covered: the local engine is PostgreSQL 18.3 and your production is 17.6; it is not Supabase itself, and its owner role is `app_owner` rather than `postgres`. Supabase-specific differences (extra default grants, event triggers, your actual grants) can only be seen by the real dry run, which is why it is still required.

## 7. Files changed and payment confirmation

Changed or added for this implementation: `lib/catalogueListingValidation.js`, `lib/catalogueListingConfigurationValidation.js`, `pages/api/catalogue/items.js`, `pages/api/catalogue/drafts.js`, `pages/api/catalogue/categories.js`, `pages/api/catalogue/configuration.js`, `public/user-dashboard.html`, `mobile/src/api/catalogue.ts`, `mobile/src/app/catalogue/my-listings.tsx`, `mobile/src/app/catalogue/item/[id].tsx`, `mobile/src/app/catalogue/[username].tsx`, `mobile/src/app/catalogue/manage.tsx`, `mobile/src/app/shop/index.tsx`, `mobile/src/app/shop/category/[id].tsx`, `mobile/src/lib/catalogue-directory.ts`, `supabase/add_dynamic_listing_engine.sql`, regenerated `supabase/dry_run_dynamic_listing_engine.sql`, `__tests__/lib/catalogueListingValidation.test.mjs`, and this document.

**No payment-related object changed.** No Paystack, USDT, wallet, subscription, boost, commission or order code, API, table, function, trigger, policy or configuration was touched. The migration touches only `catalogue_items` (new columns, constraints, indexes, two triggers) and `catalogue_categories` (two columns, one trigger) plus new `catalogue_*` engine tables. The dry run's object diff checks this and fails if anything else changes.

The existing web product detail checkout page and payment UI were intentionally left untouched. Consequently, service-specific contact-only purchase behavior is not added here; changing that would require a separate, explicit decision about the existing checkout UI. Drafts can describe stock and quantity, but those constraints, price ranges, multiple pricing options and non-checkout-compatible models cannot be published because existing checkout does not enforce them. Such drafts remain private until an independently authorized checkout change exists.

## 8. Next steps

1. Finish the Phase A tests while logged in (website create, edit, delete with a category; edit in the mobile app). Fix anything they expose before the engine is deployed.
2. Run the dry run in Supabase and send me the full message.
3. We review it together. Production execution is approved separately, after a full database backup.
