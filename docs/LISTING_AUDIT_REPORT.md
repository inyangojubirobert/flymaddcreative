# One Dream listing configuration audit, proposed fixes and migration review

Date: 9 Oct 2026. Status: for approval. No migration has been executed, and no application code or database object has been changed.

Evidence sources:

- **[code]:** repository files, read only.
- **[live-data]:** the read-only script `scripts/audit-listings-readonly.cjs`. It ran SELECT queries plus the Supabase API's schema description against the live project.
- **[sql]:** `supabase/review_catalogue_items_rls.sql`, a read-only query the owner ran in the Supabase SQL editor on 9 Oct 2026. It covers security rules, grants, constraints, triggers and database functions, which cannot be read through the API. Results are under "Database audit results" in section B.

---

## A. Current configuration audit

### A1. `catalogue_items` [live-data]

| Column | Type | Null | Default |
|---|---|---|---|
| id | uuid | NOT NULL | gen_random_uuid() (primary key) |
| seller_username | text | NOT NULL | — |
| title | text | NOT NULL | — |
| description | text | null | — |
| price_usd | numeric | NOT NULL | — |
| images, payment_methods | jsonb | null | — |
| status | text | **null allowed** | 'active' |
| created_at, updated_at | timestamptz | null | now() |
| size, promo_video_url | text | null | — |
| category_id | uuid | **NOT NULL**, foreign key to categories | — (no default) |

Data:

- 2 listings, both `active`, priced $1.99 and $15.00, both in category `other` (which can't be selected), from 2 sellers. Both have payment methods `["paystack","usdt"]`.
- No listing has an invalid price, no `category_id` is missing, and no price has more than two decimal places.
- Only the status `active` occurs. The application code also uses `paused` and `deleted`.

Confirmed by [sql]:

- There is no check constraint on `status` or `price_usd`, and there are no triggers.
- The only indexes are the primary key and `category_id`.
- Security rules are open for insert and update (EX-2). The repository contains no migration defining these rules; they were created outside the repository.

### A2. `catalogue_categories` [live-data]

- 204 rows: 17 departments and 187 categories.
- No same-department duplicate names, no duplicate slugs, no third level, no orphaned parents, and none inactive.
- Non-selectable categories: `digital`, `fashion`, `services`, `other` (broad buckets).
- Categories per department:

  | Department | Categories |
  |---|---|
  | fashion-beauty | 13 |
  | technology | 11 |
  | home-living | 8 |
  | food-grocery | 17 |
  | health-fitness | 4 |
  | kids-family | 3 |
  | books-art-entertainment | 6 |
  | digital-products | 8 |
  | professional-services | 27 |
  | local-services | 7 |
  | travel-transport | 10 |
  | automotive | 3 |
  | property | 2 |
  | business-industry | 3 |
  | gifts-specialty | 5 |
  | construction-building | 35 |
  | artisans-technicians | 25 |

- Security rules (from `add_catalogue_categories.sql` [code]): RLS is on, there is a public select policy, and anon/authenticated have select only. Confirmed live by [sql]: RLS on with a select-only policy. anon/authenticated also hold write grants, but RLS blocks them.
- There is no product/service classification in the database today. It exists only as section labels in `mobile/src/lib/catalogue-directory.ts`.

### A3. How listings are written today [code]

| Path | Mechanism | Server-side checks |
|---|---|---|
| Mobile app (create/edit/delete) | `pages/api/catalogue/items.js` with the participant's token | Token and ownership; category exists, is active, is selectable and is not a department; `title` and `price_usd` present on create. **No price value check, no status check, no check of payment_methods or image contents.** |
| Website dashboard (create/edit/delete) | `public/js/supabase-config.js` `saveCatalogueItem` / `deleteCatalogueItem`, writing **directly to Supabase with the public key** | None on the server. `seller_username` and the ownership filter come from the browser. **[sql] confirms the security rules allow any insert or update by the public role (EX-2).** |
| Payment code | Only reads `catalogue_items` (`price_usd`, `status`, `title`, `images`, `seller_username`) | Not applicable. Confirmed: no payment file writes `catalogue_items`. |

The mobile form checks `price > 0` in the app, and the website form checks `price > 0` in the browser. Neither is enforced on the server.

### A4. How statuses behave [code]

| Status | Public shop / profile lists | Product page | Checkout endpoints |
|---|---|---|---|
| active | shown | buy options shown | accepted |
| paused | hidden | **buy options shown** (website blocks only deleted; mobile item screen checks nothing) | **accepted** |
| deleted | hidden | website shows an error; mobile shows the item | refused |
| null / other text | hidden | buy options shown | accepted |

The website dashboard describes "Paused" as "hidden from buyers".

### A5. Existing catalogue extensions [live-data, code]

- `add_catalogue_product_details.sql` added `size` and `promo_video_url`, and both are present.
- The only `catalogue_*` tables are `catalogue_items`, `catalogue_orders` and `catalogue_categories`.
- None of the tables, columns or functions the proposed migration creates already exist. [sql] confirms there are no function name collisions either.

---

## B. Findings and proposed fixes

Each finding is labelled as an existing problem (EX) or a migration problem (MG). Payment issues are listed separately in `docs/PAYMENT_SECURITY_FINDINGS.md` and are not fixed here.

### EX-1. Creating a product from the website fails

- **Class:** confirmed existing defect. **Severity:** High (functional).
- **Evidence:** `category_id` is NOT NULL with no default [live-data]. The website payload (`user-dashboard.html`, lines 2518–2526) sends no `category_id`, and the form has no category field [code].
- **Affects users now:** yes, for any website seller creating a new listing. Editing existing listings still works.
- **Could break the migration:** no.
- **Fix:**
  - Add a category picker to the website form, using the same department-then-category list as the app.
  - Send saves through `/api/catalogue/items` (see EX-2).
  - Files: `public/user-dashboard.html`, `public/js/supabase-config.js`.
- **Expected result:** website creation works, with the same validation as mobile.
- **Risk:** low. **Rollback:** revert the two files.
- **Tests:**
  - Create, edit and delete from the website as the owner.
  - Try to edit another seller's listing (expect 403).
  - Try to create without a category (expect 400).
- **Mandatory.**

### EX-2. Anyone with the public key can create and edit any listing

- **Class:** confirmed security vulnerability. **Severity: Critical.**
- **Evidence** [sql, run 9 Oct 2026]:
  - RLS is on, but the policy `"insert items"` is INSERT for `public` with `check (true)`, and the policy `"update items"` is UPDATE for `public` with `using (true)`.
  - anon and authenticated hold INSERT/UPDATE/DELETE/TRUNCATE grants.
  - The public key ships in `public/js/supabase-config.js`, and `saveCatalogueItem` writes with it [code].
  - So anyone can change any listing's price (including to 0), title, seller or status, or create listings under another seller's name.
  - Combined with payment finding 1, a price of 0 lets a trivial USDT transfer be recorded as a paid order.
- **Affects users now:** yes. It is exposed today for both live listings and any new ones.
- **Could break the migration:** no. The migration's listing guard would reject invalid prices from these writes, but it cannot stop ownership or title changes, so it is not a fix.
- **Fix:**
  1. Route saves and deletes through `/api/catalogue/items` using the existing `onedream_token`. Files: `public/js/supabase-config.js`, `public/user-dashboard.html`.
  2. Immediately after that ships, run `supabase/lockdown_catalogue_items_writes.sql` (parsed, not executed). It:
     - drops the two open policies;
     - revokes write, truncate, references and trigger grants from anon and authenticated on `catalogue_items` and `catalogue_categories`;
     - keeps public read unchanged, because the shop and the app read with the public key.
- **Risk:** medium. Removing write access before the website is switched would break website saves, hence the ordering.
- **Rollback:** revert the files. The lockdown script contains a commented rollback that restores the previous (insecure) rules.
- **Tests:**
  - Website create/edit/delete works.
  - A direct public-key insert/update attempt fails after step 2.
  - The mobile app is unaffected.
- **Mandatory, highest priority.** It is independent of the listing engine and should not wait for it.

### EX-3. The listings API does not validate price values

- **Class:** confirmed existing defect, security-relevant because of payment findings 1 and 2.
- **Evidence:** `items.js` only checks that `price_usd !== undefined` on create, and nothing on edit [code]. Current data is clean [live-data].
- **Affects users now:** no bad data exists yet; the risk is in future writes.
- **Fix:** in `items.js`, require `Number.isFinite(price) && price > 0`, rounded to cents, on create and whenever the price is sent. The migration's trigger adds the same rule in the database.
- **Risk:** low. **Rollback:** revert `items.js`.
- **Tests:** 0, -1, "abc", "NaN", "Infinity" and null are rejected; 1.99 is accepted.
- **Mandatory.**

### EX-4. The listings API accepts any status, payment_methods or images values

- **Class:** confirmed existing defect. **Severity:** Medium.
- **Evidence:** `items.js` copies `status`, `payment_methods` and `images` unchecked [code]. Checkout treats any status other than `deleted` as purchasable.
- **Fix:**
  - `status` must be `active` or `paused` (deletion only through DELETE).
  - `payment_methods` must be a non-empty subset of `paystack`/`usdt`.
  - `images` must be an array of `https` URLs.
  - Title: 1–120 characters.
  - File: `items.js`.
- **Risk:** low. Current data already complies.
- **Tests:** invalid values get 400; current clients still work.
- **Mandatory.**

### EX-5. Paused listings are described as hidden, but can still be bought

- **Class:** confirmed existing defect, with a payment component.
- **Evidence:** section A4 [code].
- **Fix within scope:** change the website dashboard label to "Paused (removed from shop listings)", which is accurate. File: `user-dashboard.html`.
- **Fix needing authorization:** hide buy options for non-active listings on the product pages, and refuse non-active listings in the payment endpoints. Both product pages host checkout, so this falls under the payment exclusion (`PAYMENT_SECURITY_FINDINGS.md` items 3 and 7).
- **Label change:** optional but recommended.

### EX-6. The two live listings cannot be edited without changing category

- **Class:** confirmed existing behaviour. **Severity:** Low.
- **Evidence:** both live listings are in `other`, which can't be selected [live-data]. The mobile form always re-sends `category_id`, and `items.js` rejects categories that can't be selected [code].
- **Fix options for the owner:**
  - Keep this behaviour (it nudges these 2 sellers to choose a real category). Recommended, no change.
  - Or only validate the category in `items.js` when it actually changes.
- **Not mandatory.**

### EX-7. The public profile page inserts listing text as raw HTML

- **Class:** confirmed security vulnerability (stored script injection). **Severity:** High while writes are open; Medium after the lockdown.
- **Evidence:** `public/vote.html` (lines 542–546) puts `item.title` and `item.description` into the page as HTML [code].
- **Impact:**
  - While public writes are open, anyone can plant a script in any seller's listing. Afterwards, sellers can still do it in their own listings.
  - A planted script runs for every visitor to that profile and can read the visitor's `onedream_token` from the browser's local storage.
  - The integrity check found no markup in either live listing.
- **Mitigation (done, no payment file touched):** the listings API now refuses `<` and `>` in the title, description and size, and stores image and video links in normalised form.
- **Remaining:** escaping inside `vote.html` itself. That page also runs the vote payment flow, so editing it needs your authorization.

### Remediation status (9 Oct 2026)

Implemented and tested locally; not yet deployed:

- `lib/catalogueListingValidation.js` (new) and `pages/api/catalogue/items.js`:
  - Validates the price as finite, greater than 0 and rounded to cents. Status must be `active` or `paused`.
  - Validates title, description and size length, and refuses markup characters in them.
  - Image and video links must be http(s) and are stored normalised.
  - Payment methods must be a known, non-empty subset.
  - A category is required on create.
  - Unknown and server-controlled fields are ignored.
  - Edits refuse deleted listings. Updates and deletes repeat the ownership check in the write itself.
- `public/js/supabase-config.js`: website save and delete now go through `/api/catalogue/items` with the seller's token.
- `public/user-dashboard.html`:
  - New department and category picker. A listing in a general category is asked to choose a specific one.
  - `category_id` is sent with saves.
  - Listing text and links are escaped in the dashboard.
  - The status label now reads "Paused (removed from shop listings)".
- Tests:
  - 13 of 13 unit tests pass (`__tests__/lib/catalogueListingValidation.test.mjs`).
  - With the local Next.js server, unauthenticated and forged-token create/edit/delete requests return 401, and the categories endpoint returns 204 categories.
  - Lint is clean, and the website scripts pass a syntax check.
  - Authenticated writes were not exercised, because the local server uses the live database.
- Integrity check (`scripts/integrity-check-listings-readonly.mjs`, read-only):
  - Both live listings have registered sellers, plausible prices ($1.99 and $15), no markup, and allowed image hosts. Both pass the new validation.
  - The only order (on "Child Delivery") was for $15, matching the price.
  - Caveat: `updated_at` is set by the client, so a direct tampering write could have left it unchanged. The checks confirm the current values are plausible; they can't prove nothing was ever changed.
- Lockdown SQL `supabase/lockdown_catalogue_items_writes.sql` is final and ready for your approval.
  - Before changing anything, it verifies that `service_role` exists, bypasses RLS, and holds SELECT/INSERT/UPDATE on both tables.
  - After the change, it verifies that anon/authenticated have SELECT only, no write policies remain, and the public read policy still exists.
  - Any failed check rolls back the whole change.
  - The server's `SUPABASE_SERVICE_ROLE_KEY` was confirmed to carry `role: service_role`.

### Database audit results [sql, run 9 Oct 2026]

- Postgres 17.6; `check_function_bodies` is on; `gen_random_uuid` is available.
- `catalogue_items`: RLS on (not forced). Policies:
  - `"public read active items"`: SELECT where `status <> 'deleted'`, so paused listings are publicly readable.
  - `"insert items"`: open to everyone (EX-2).
  - `"update items"`: open to everyone (EX-2).
  - There is no DELETE policy, so hard deletes are blocked for the public role.
- `catalogue_categories`: RLS on, SELECT-only policy, so public writes are already blocked despite the broad grants.
- Constraints: primary keys, the category foreign keys, the slug unique, the 1–60 name length, and the department-scoped name index. **No check on `status` or `price_usd`.**
- No user-defined triggers, no database functions or views referencing either table, and no name collisions with the migration.
- No listings with an invalid price.

### Missing functionality the new engine needs (not defects)

Listing type, pricing models, units, product and service details, category attributes, drafts, and the listing-type suggestion for categories. All are provided additively by the migration.

---

## C. Migration compatibility review (`add_dynamic_listing_engine.sql`, revision 3)

| Check | Result |
|---|---|
| Proposed tables or columns already exist | None exist: tables and columns [live-data], functions [sql] |
| Seeded category slugs exist | All 78 exist (72 service, 6 product) [live-data] |
| Legacy listings | Both become product + fixed (unchanged checkout behaviour). Both are flagged `category_other` for review. Both prices are valid, so nothing blocks them. |
| `status` allows null | Revision 4 restricts status to active/paused/deleted (null refused) after verifying existing rows; public detail reads follow the listing's own read policy (non-deleted) |
| `gen_random_uuid` | Available (already the default for `catalogue_items.id`) |
| Syntax | All 70 statements parse with PostgreSQL's parser (`libpg_query`). Function bodies are validated by Postgres at creation time, inside the single transaction. |
| Repeatability | Seeds are insert-if-missing; constraints are added only if missing; policies and triggers are dropped then recreated; legacy flagging skips reviewed rows |
| Category impact | Additive columns only. IDs, slugs, names and parents are unchanged. Every category accepts both types; the suggestion only guides the form. |
| Payment objects | None created, altered or dropped |

Change made in revision 3 (from this audit): the three guard functions now run with their own privileges, with a fixed `search_path`. Without this, a write made as the public role (the website's current direct writes) could fail just because that role cannot read the new configuration tables.

Revision 4 (after the Phase A lockdown was verified): approval authority, detail visibility, status values, draft ownership and rollback archiving were changed. See `docs/LISTING_ENGINE_REV4.md`.

Rollback: `supabase/rollback_dynamic_listing_engine.sql` (revision 4). It archives engine data into the private schema `catalogue_engine_archive`, verifies it, and only then drops what the migration added.

### Proposed sequence (each step needs your approval)

1. Done: the audit query has been run. No conflicts with the migration were found.
2. **Priority security fix, independent of the listing engine:**
   1. route website saves and deletes through `/api/catalogue/items` and add the category picker (EX-1, EX-2);
   2. add price, status and field validation in `items.js` (EX-3, EX-4);
   3. then run `lockdown_catalogue_items_writes.sql`.
3. Done: lockdown applied and verified. **Next:** run `supabase/dry_run_dynamic_listing_engine.sql` (generated from the exact revision 4 files, always rolled back) and review its report.
4. After approval: full database backup, then run the migration as the database owner, then re-run the audit query to verify.
5. Application changes for the engine:
   1. new fields in `items.js`;
   2. drafts API;
   3. mobile form and display;
   4. website form fields;
   5. dashboard label (EX-5).

Payment repairs stay out of this sequence until you authorize them separately.
