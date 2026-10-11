# Migration-Readiness Report — Universal Search Alias System

**Migration file:** [`supabase/add_catalogue_search_aliases.sql`](../supabase/add_catalogue_search_aliases.sql)
**Status:** Reviewed, corrected, and verified in isolated local staging. **Not applied to production.**
**Date:** 2026-10-10

## Method

No production writes were performed. The live `catalogue_categories` table was re-read read-only via the
Supabase REST API to confirm current state (17 departments, 187 categories, 204 rows total — unchanged
since the prior inspection). An isolated local Postgres was then stood up using
[PGlite](https://github.com/electric-sql/pglite) (a real Postgres engine compiled to WASM, running fully
in-process — not a mock or emulator), seeded with that real category snapshot, and the actual migration
file was applied and exercised through an automated test battery. The migration was corrected in place
based on what the tests found; see **Issues found & corrected** below.

## Issues found & corrected

| # | Area | Issue found | Fix applied |
|---|------|-------------|-------------|
| 1 | Ranking | Fuzzy trigram matching on the whole phrase produced false positives that outranked/polluted real results — `sneakers` matched "Audio & Headphones" (via alias "Speakers", similarity 0.50); `wedding cake` matched "Welding, Fabrication & Metal Works" (alias "Welding", similarity 0.31) and "Home & Living" (alias "Bedding"). | Fuzzy matching is now a **last-resort fallback only** — it is skipped entirely whenever any exact/partial/word match already exists, and it operates per-word via `word_similarity` instead of whole-phrase `similarity`. |
| 2 | Ranking | Multiword queries ("Men's perfume", "car hire") returned noise or missed the real match. A 3-char token like `men` or `car` is a coincidental substring of unrelated words ("equip**men**t", "skin**car**e"), and those name-token hits outranked the real alias hit. | Raised the token floor to 4 characters; split partial matching into explicit tiers (exact → whole-phrase partial name → whole-phrase partial alias → **alias**-word → **name**-word → fuzzy), so curated alias hits always beat coincidental name substrings. |
| 3 | Ranking | When a category and its own parent department tied on rank (e.g. "Perfume" matching both "Fragrances" and the "Fashion & Beauty" department), the department sometimes sorted first alphabetically. | Added a tie-break so the more specific category always surfaces before its parent department, per the spec's "don't force navigation to a department when a precise category exists." |
| 4 | Security | The function had only the explicit `GRANT EXECUTE` added during authoring; Postgres's own default (`EXECUTE` granted to `PUBLIC` on every new function) was never explicitly revoked. Table write privileges for `service_role` were never explicit either — writes only worked in production by relying on an unverified, project-level default-privilege assumption. | Added explicit `REVOKE ALL ... FROM PUBLIC` on both the table and the function, then explicit re-grants to exactly `anon`/`authenticated` (select + execute only) and `service_role` (full CRUD on the table, since it is the only role trusted with writes). |
| 5 | Performance / DoS | An adversarially long or word-stuffed `search_term` fans out linearly (one scan per distinct word) with no bound. | Capped input to 200 characters and tokens to 12 distinct words up front. A 74KB / ~5,000-word adversarial input now completes in ~86ms instead of scaling unbounded. |

## Test results

All tests ran against the isolated local PGlite instance, seeded from the real 204-row category snapshot.

| Test | Result |
|---|---|
| Coverage: all 17 departments have ≥1 alias | ✅ 17/17 |
| Coverage: all 187 categories have ≥1 alias | ✅ 187/187, 0 missing, 825 alias rows total |
| Idempotency: run migration twice | ✅ 825 rows both times, no error |
| Rollback: `DROP FUNCTION` / `DROP TABLE` then re-apply | ✅ clean removal, clean re-apply |
| Phase 11 single-word cases (Perfume→Fragrances, Sneakers→Shoes, Locksmith, Inheritance→Wills/Probate/Estate Planning, Software, Jewelry, Cleaning, ...) | ✅ all pass; category now ranks before its parent department |
| Unknown term → empty result | ✅ empty set |
| Case-insensitivity | ✅ |
| Ambiguous term ("Apple") | ✅ returns multiple plausible categories, does not force one (no literal "Apple"/fruit category exists in this catalog, so the result is a labelled fuzzy-fallback suggestion) |
| Multiword: "Men's perfume" | ✅ → Fragrances, Fashion & Beauty (was noise before fix #2) |
| Multiword: "wedding cake" | ✅ → Cakes/Pastries/Baking, Event Catering Services (false positives gone after fix #1) |
| Multiword: "car hire" | ✅ → Travel & Transport, Car Hire & Transport (was noise before fix #2) |
| SQL injection via `search_term` | ✅ treated as data, table untouched (parameterized function argument, no dynamic SQL) |
| `anon` SELECT on alias table | ✅ allowed |
| `anon` INSERT / `authenticated` UPDATE / DELETE on alias table | ✅ all rejected — "permission denied" |
| A hypothetical role with no grant at all | ✅ rejected |
| `anon` can execute the search RPC | ✅ |
| `service_role` write + `updated_at` trigger | ✅ (only passed after fix #4) |
| Performance at ~24x volume (4,879 categories / 14,625 aliases) | ~33–42ms typical, ~150ms worst case (fully-unmatched term, forces fuzzy fallback scan); trigram GIN indexes confirmed used by the planner via `EXPLAIN ANALYZE` |
| Adversarial 74KB / 5,000-word input | ✅ 86ms (was unbounded before fix #5) |

## Frontend/backend integration — confirmed gap, not yet wired up

The actual search code paths were inspected directly:

- **Mobile app** (`mobile/src/app/(tabs)/search.tsx` + `mobile/src/lib/catalogue-directory.ts`) does
  client-side substring matching against categories already in memory, using its own pre-existing,
  hardcoded `CATEGORY_KEYWORDS` map (covers only the newer Construction/Artisans/Legal/Accommodation
  categories, not Fashion/Tech/Food/etc.).
- **Web API** (`pages/api/catalogue/categories.js`, `pages/api/catalogue/items.js`) lists/CRUDs categories
  and items directly; there is no search/alias endpoint at all.
- No `.rpc()` call anywhere in the codebase references `search_catalogue_categories` — every existing
  `.rpc()` usage is unrelated (AI credits, merchant withdrawals, vote counting, etc.).

**Conclusion: deploying this migration alone changes nothing for users.** It is purely additive and
currently has zero consumers, so there is no regression risk to existing product/service search — nothing
in `catalogue_items`, the mobile keyword map, or the web API was touched or depends on this table. The
`search_catalogue_categories` function will not actually be used until a follow-up change wires the
frontend/API to call it (and optionally retires the now-redundant, incomplete client-side
`CATEGORY_KEYWORDS` map in favor of this complete, admin-editable, server-side one). That frontend/API
work is out of scope of this SQL-only change and has not been done.

## Safety confirmation

- Diff scope: the only file created/changed for this work is `supabase/add_catalogue_search_aliases.sql`
  (new, untracked). Verified via `git status` / `git diff --stat` that no payment, wallet, withdrawal,
  subscription, or commission file was touched.
- No department/category was created, renamed, deleted, or reordered; the alias insert is slug-keyed and
  silently no-ops for any slug absent in a given environment.
- Process note: validating this required installing an `npm` package for local testing, which briefly
  modified the root `package.json` / `package-lock.json` as a side effect of an unscoped `npm install`.
  This was immediately reverted with `git checkout` and confirmed clean before continuing.

## Remaining steps before production

1. Have someone else review the corrected ranking function and the 825-row alias dataset.
2. Apply the migration to a real staging Supabase project (not just local PGlite) and spot-check the
   commented queries at the bottom of the migration file.
3. Separately scope and implement the frontend/API wiring (mobile + web) to actually call
   `search_catalogue_categories`, and decide whether to retire the old `CATEGORY_KEYWORDS` client map once
   it is in place.
4. Only then apply to production — this has not been done and will not be done without separate explicit
   approval.
