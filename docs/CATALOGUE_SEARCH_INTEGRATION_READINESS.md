# Search alias integration readiness — One Dream Initiative

Date: 2026-10-11 (Africa/Lagos)

**Integration implemented. 31 automated tests pass; TypeScript, Android Hermes export and Expo web export pass. Deployment authorized by the user, awaiting renewed Vercel authentication.** The supplied migration is treated as already applied. No SQL was sent to a remote database and the migration file was not edited or reapplied remotely.

## 1. Modified files

- [lib/catalogueSearch.js](../lib/catalogueSearch.js)
- [lib/catalogueSearchLegacy.js](../lib/catalogueSearchLegacy.js)
- [lib/catalogueSearchLegacy.d.ts](../lib/catalogueSearchLegacy.d.ts)
- [pages/api/onedream/search.js](../pages/api/onedream/search.js)
- [pages/api/catalogue/categories.js](../pages/api/catalogue/categories.js)
- [mobile/metro.config.js](../mobile/metro.config.js)
- [mobile/src/api/participants.ts](../mobile/src/api/participants.ts)
- [mobile/src/app/(tabs)/search.tsx](../mobile/src/app/(tabs)/search.tsx)
- [mobile/src/app/shop/index.tsx](../mobile/src/app/shop/index.tsx)
- [mobile/src/app/shop/category/[id].tsx](../mobile/src/app/shop/category/[id].tsx)
- [mobile/src/hooks/use-marketplace-search.ts](../mobile/src/hooks/use-marketplace-search.ts)
- [mobile/src/lib/catalogue-directory.ts](../mobile/src/lib/catalogue-directory.ts)
- [mobile/src/lib/marketplace-search-results.ts](../mobile/src/lib/marketplace-search-results.ts)
- [scripts/search-staging/database.mjs](../scripts/search-staging/database.mjs)
- [scripts/search-staging/backend.test.mjs](../scripts/search-staging/backend.test.mjs)
- [scripts/search-staging/frontend.test.mjs](../scripts/search-staging/frontend.test.mjs)
- [scripts/search-staging/check-setup.mjs](../scripts/search-staging/check-setup.mjs)

This report is also new. Several marketplace files and unrelated files already had local changes before this task. Existing edits were preserved. Payment, wallet, subscription, billing, commission and settlement implementation files, dependency manifests and lockfiles were not edited by this task.

## 2. Search architecture

Native Discover, Shop and category screens, and the corresponding Expo web screens, use useMarketplaceSearch → GET /api/onedream/search → lib/catalogueSearch.js → the existing Supabase client and search_catalogue_categories RPC.

The RPC supplies exact names, aliases, partial and multiword matches, plus labelled fuzzy suggestions. Listings are independently searched by title, description, size and seller, including unordered multiword searches. Exact titles are reserved and ranked before other text results, then related category listings. Duplicate items are removed. Matching a specific category suppresses automatic expansion into unrelated siblings from its parent department. Fuzzy results are suggestions to select; they do not silently fill the gallery with loosely related listings.

GET /api/catalogue/categories?q=... exposes the same category service; a GET without q preserves the existing directory response and schema fallbacks. The authenticated write-only pages/api/catalogue/items.js was inspected and left unchanged.

Limits: 200 input characters, 12 listing tokens, 20 categories, 40 listings and 20 creators per search; department expansion is capped at 500 children. Requests use a 300 ms client debounce, 30-second query freshness and cancellation. Each database request has a 4-second deadline; the client request aborts after 20 seconds. Larger result sets need pagination before search becomes a complete catalogue browser at that scale.

## 3. Frontend integration

All three marketplace screens now use the shared API. Category selection keeps the original category ID; departments keep existing slugs; product and seller links keep their existing routes. Department/category scope and product/service filters apply before result limits on the server and are enforced again in the gallery helper. Existing listing cards, photos, video indicators and price formatting remain in place. Discover now places categories and listings inside its scrolling result list so creator results remain reachable.

Successful empty searches remain empty. Partial outages show a retry message; RPC failures use category name/slug fallback and the retained compatibility vocabulary. Shop/category screens can use already loaded listing data on outages. Uncached offline data cannot be invented. New categories display default visuals until the directory refreshes, rather than being dropped because their ID is missing from a local cache.

Web coverage is the existing Expo web marketplace. The legacy website participant-code search (public/search.html and public/js/search.js) retains its separate code-lookup behavior. The root Vercel site excludes mobile/ from its source deployment; an API deployment alone does not ship updated native clients or the Expo web frontend.

## 4. Backend and compatibility results

Local staging reconstructed the catalogue from repository SQL in in-memory PGlite: 17 departments, 187 categories and 825 aliases. Listings and creators were synthetic. Tests use the real Supabase JS request builder with a narrow, local PostgREST transport adapter; this is not an independent hosted Supabase staging environment.

| Query | Verified category | Listing result |
| --- | --- | --- |
| Perfume | Fragrances, ahead of its department | Perfume plus fragrance listings; unrelated shoes excluded |
| Sneakers | Shoes | Shoe listings; specific title first |
| Electrician | Electrical Installation & Repairs and related electrical categories | Active electrical service |
| Men's perfume | Fragrances | Fragrance listings |
| Wedding cake | Cakes, Pastries & Baking; Event Catering Services | Wedding cake service |
| Car hire | Car Hire & Transport; Travel & Transport | Car hire service |
| zzzznotreal | Empty | Empty |
| perfuem | Fragrances marked as a suggestion | No automatic fuzzy listing expansion |

**Compatibility finding:** 386 historic keyword-to-category pairs were audited; 121 were not covered for their original category by the applied SQL alone. Examples include switches, sockets, breakers, stabilizer, UPS, mason and bricklayer. The vocabulary was moved unchanged into one shared compatibility module, consumed by the server and the offline client. All missing pairs are verified to remain searchable. It must not be deleted yet. Future terminology is still read from catalogue_search_aliases and does not require an app update; this compatibility module is not a list of the 204 records. Future category names and an additional synthetic listing type were also verified without client code changes.

## 5. Regression and frontend tests

- 20 backend tests: all requested queries, exact/partial/fuzzy matching, creator discovery, active-only visibility, no duplicates, original IDs, independent title/description/size/seller matching, unordered words, scope/type intersection, empty scopes, RPC absence, participant/item outages, timeout, input bounds, filter punctuation, dynamic aliases/categories/types, anon permissions and both API handlers.
- 11 frontend tests: debounce, stale-response isolation, cancellation, scope propagation, empty/error handling, cached fallback, new-category rendering, native navigation events and real ReactDOMServer/react-native-web output. Each of the six required SQL-backed queries is rendered independently for native and web.
- Full mobile TypeScript check passes.
- Android Hermes and Expo web production exports pass (35 static web routes). Exports are staged in .tmp/search-integration/export with a localhost API URL for isolated validation; they are **not distribution artifacts**.
- git diff --check passes (only repository line-ending warnings).

Interactive browser, Android/iOS device, network-latency UX and hosted Supabase/PostgREST staging checks were not available/performed. The native component harness controls device/router APIs, and web checks are server-rendered component checks rather than browser end-to-end tests. No native APK/AAB or app-store release was published.

Commands:

```powershell
node --test scripts/search-staging/backend.test.mjs scripts/search-staging/frontend.test.mjs
node mobile/node_modules/typescript/bin/tsc --project mobile/tsconfig.json --noEmit --incremental false
# From mobile/, with EXPO_NO_DOTENV=1, EXPO_OFFLINE=1, CI=1 and EXPO_PUBLIC_API_BASE_URL=http://127.0.0.1:3999:
node node_modules/expo/bin/cli export --platform web --platform android --output-dir ../.tmp/search-integration/export --max-workers 2
```

## 6. Performance

Latest 20-sample in-process service run: p50 **15.01 ms**, p95 **39.46 ms**, maximum **60.38 ms**. A roughly 60 KB adversarial input completed in **24.21 ms** after input truncation. Earlier uncontended warm runs were around 11 ms p50 / 14 ms p95. These measurements exclude real network and hosted PostgREST overhead, and use a small synthetic listing table. They are not production throughput guarantees. Listing text scans and the 500-child expansion bound should be evaluated against production-scale data before claiming unlimited scale.

## 7. Security findings

All new data operations are reads. Only active listings are returned and public fields are explicitly selected. Existing server-side Supabase credential precedence is retained; no service credential is included in the client. Filter values are quoted and LIKE metacharacters escaped; wildcard-only queries cannot become a match-all search. Query arrays and invalid filter IDs/types are rejected, and database errors do not expose raw messages. Timeout/error status is returned per result group so an unavailable RPC does not disable creator or listing discovery.

Local role tests confirm anon can call the supplied RPC and cannot write aliases. Production grants/RLS were not re-audited here. This task adds input/work bounds, not a distributed rate limiter; existing hosting protections still apply. There are no category mutations and no payment-related changes.

## 8. Migration and deployment requirements

No new migration is required for this integration, and add_catalogue_search_aliases.sql must not be rerun as part of this release. The user confirmed it was already applied.

The user subsequently authorized deployment if checks pass. The saved Vercel access token is expired and its refresh token returned invalid_grant; Vercel device authentication is pending. Once authenticated, prepare a release from the current deployed baseline plus only the search files, verify the deployed response and then report the production URL. Do not publish unrelated pre-existing local changes.

The native app requires a separate build/distribution step to put these screens on users' devices. Expo web also needs its actual hosting/release path and production API URL; the staged localhost export must not be deployed. Removing the compatibility map is a later, optional change after the 121 missing keyword pairs are curated into the database and the coverage audit passes. No database write is performed by the tests except inside isolated local PGlite.
