# Product & Service Listing Engine: Implementation Status Report

Audit date: 2026-10-10. Scope: read-only. No files were edited by the audit, no SQL was run against any database, nothing was deployed, and payment infrastructure was not modified. Live-database access was limited to `GET` requests with the public anon key. Local tests and the local PGlite dry run were re-run (no Supabase contact).

## Headline findings

1. **Revision 4 is not applied to the live database.** All 8 new tables return `PGRST205` (not found), and the new `catalogue_items` and `catalogue_categories` columns return `42703` (column does not exist).
2. **Almost none of the listing-engine work is committed.** `HEAD` is `778df94`. The engine exists only as modified and untracked files in the working tree.
3. **Deploying the current code before the migration would break listing creation.** `POST /api/catalogue/items` requires `listing_type` and inserts `listing_type`, `pricing_model` and related columns that do not exist yet. The insert would fail and the API would return 500 "Failed to create item" ([items.js](../pages/api/catalogue/items.js)).
4. **The installed APK (1.0.13) was built from this uncommitted code** and sends the new fields. What API version production runs could not be determined, so sync between the two is unverified.

## Feature status

| Feature | Status | Evidence |
|---|---|---|
| Product/Service classification (validation) | IMPLEMENTED AND TESTED | [catalogueListingValidation.js](../lib/catalogueListingValidation.js); 18/18 tests pass |
| Pricing-model and unit validation (code) | IMPLEMENTED AND TESTED (unit level only) | Same test file |
| Pricing models, units, attribute definitions (DB) | BLOCKED BY DATABASE MIGRATION | `catalogue_pricing_models`, `catalogue_units`, `catalogue_attribute_definitions` absent live |
| Category-dependent types (`listing_types`) | BLOCKED BY DATABASE MIGRATION | Column absent live |
| Product and service details tables | BLOCKED BY DATABASE MIGRATION | Tables absent live |
| Seller-defined custom attributes | BLOCKED BY DATABASE MIGRATION | `catalogue_item_attributes` absent live |
| Create listing: `POST /api/catalogue/items` | IMPLEMENTED BUT UNTESTED; breaks without the migration | No API or integration tests |
| Edit listing: `PATCH /api/catalogue/items` | IMPLEMENTED BUT UNTESTED | Same |
| Drafts: `/api/catalogue/drafts` (GET/POST/PATCH publish/DELETE) | BLOCKED BY DATABASE MIGRATION | Returns 503 until migrated; validation tested, endpoint not |
| Configuration: `GET /api/catalogue/configuration` | IMPLEMENTED BUT UNTESTED | [configuration.js](../pages/api/catalogue/configuration.js) |
| Categories: `GET /api/catalogue/categories` | IMPLEMENTED BUT UNTESTED | [categories.js](../pages/api/catalogue/categories.js) |
| Web seller form (type, dynamic fields, drafts) | IMPLEMENTED BUT UNTESTED | [user-dashboard.html](../public/user-dashboard.html); inline scripts parse; never exercised against a migrated database |
| Mobile seller form, drafts, API client | IMPLEMENTED BUT UNTESTED | [my-listings.tsx](../mobile/src/app/catalogue/my-listings.tsx), [catalogue.ts](../mobile/src/api/catalogue.ts); `tsc --noEmit` passes |
| Mobile buyer item detail | PARTIALLY IMPLEMENTED | [item/[id].tsx](../mobile/src/app/catalogue/item/[id].tsx) shows type, scope, attributes; pricing model and unit display not verified |
| Web buyer item page | NOT IMPLEMENTED | [catalogue-product.html](../public/catalogue-product.html) has no references to the new fields |
| Admin portal awareness of new fields | NOT IMPLEMENTED | [admin-portal.html](../public/admin-portal.html) has no references |
| Legacy listing backfill and type review | BLOCKED BY DATABASE MIGRATION | Migration only |
| Migration, rollback and dry run | IMPLEMENTED AND TESTED (locally) | PGlite dry run re-ran cleanly; earlier run reported 141 assertions; never run on production |

## Backend checks

- **Authentication:** items and drafts use `requireParticipant`. `seller_username` comes from the session, never the request body.
- **Ownership:** PATCH and DELETE check the seller (403 otherwise). Drafts return 403 for another seller's draft and 409 for an already published one.
- **Validation:** category compatibility, pricing model, unit and attributes are checked server-side. A missing pricing table falls back to allowing only `fixed`.
- **Rollback behaviour:** if saving listing metadata fails the item is soft-deleted (`status='deleted'`); if the draft link fails the listing is unpublished.
- **Gaps:** no API tests; no rate limiting on drafts; ownership and RLS guards live in the unapplied migration and are unverified live.

## Migration status

| Migration | Verified live? |
|---|---|
| `add_dynamic_listing_engine.sql` (Revision 4) | Not applied (confirmed by probe) |
| Catalogue category/department seeds, banners | Data present (17 departments, 187 categories) |
| `lockdown_catalogue_items_writes.sql`, `catalogue_department_scoped_names.sql` | Not verifiable with the anon key |
| `check_migrations_applied.sql` | Exists; not run (needs privileged access) |

Preserved: 17 departments, 187 categories, IDs, slugs and parent links are unchanged. DB-side work in this audit was read-only.

## Payment boundary

- No changes to payment endpoints, schemas or processing were found in the diff.
- `catalogue_pricing_models.checkout_compatible` and the `catalogue_checkout_model_approvals` table are payment-adjacent. They gate which pricing models can be published against existing checkout behaviour. No checkout code changes, but checkout semantics are encoded in the new schema. **Needs explicit review.**
- Existing `payment_methods` (`paystack`, `usdt`) are passed through as existing listing metadata.
- [onedream/messages.js](../pages/api/onedream/messages.js) and [notifyAdminSupport.js](../lib/notifyAdminSupport.js) are modified or untracked and unrelated to listings.

## Issues and risks

- **Deploy-order dependency (critical):** code must not go live before the migration.
- **Large uncommitted change set:** 10 modified listing files (about 2,043 insertions) plus many untracked files; no rollback point in git.
- **Unrelated changes mixed in** (mobile icons, push notifications, metro config), making a single commit hard to review.
- **Test coverage:** validation unit tests are the only real passing tests for this feature.
- **Web buyer page and admin portal** do not show or understand the new fields.
- **Seed and audit SQL files** are untracked and not recorded as run.

## Test evidence

- **Passing:** 18 of 18 validation unit tests ([catalogueListingValidation.test.mjs](../__tests__/lib/catalogueListingValidation.test.mjs)); local PGlite dry run of the migration.
- **Static checks only:** mobile `tsc --noEmit`, API syntax checks, dashboard inline-script parsing.
- **Untested:** every API route; web and mobile forms against a migrated database; draft publish flow; RLS and triggers on production; web buyer display.

## Recommended next steps

1. Review this report and decide which uncommitted work to keep.
2. Split the working tree into focused commits: listing engine, catalogue directory and covers, unrelated mobile work. Do not push or deploy yet.
3. Review the `checkout_compatible` and approvals design against the payment boundary.
4. Take a full Supabase backup, then run the dry run against a staging copy of the live schema.
5. With explicit approval, apply Revision 4 to production, with the rollback script ready.
6. Only then deploy the API and web, then ship the APK.
7. Add API integration tests for create, edit, draft, publish and ownership checks.
8. Build the web buyer page and admin views for the new fields.

No further development starts until this report is reviewed.
