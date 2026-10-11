# Advertising Stage 1 — final safety review & migration readiness

**Date:** 2026-10-11 · **Scope:** the advertising and listing boost system (`supabase/add_advertising.sql` and its API, app and admin code).
**Production:** nothing run, nothing deployed, promotional billing not activated. Package prices unchanged.

> **Update:** promotional billing is now built **on**, with placeholder product IDs. See [`ADVERTISING_BILLING_ACTIVATION.md`](ADVERTISING_BILLING_ACTIVATION.md). That version also adds link freshness (a 7-day re-check and daily link checks) and more trigger tests: **122 + 78** checks pass. Items 7 and §5 below ("purchasing disabled", "leave `PROMOTIONAL_BILLING_ENABLED` unset") are superseded.

**Verdict: ready to migrate**, subject to the deployment requirements in §5. All 10 review items are addressed, and **197 automated checks pass** (§3). The remaining risks are listed in §4.

---

## 1. Review items — findings and fixes

| # | Item | Finding before the review | Fix | Verified by |
|---|---|---|---|---|
| 1 | Capacity on every placement; no races | Approval only needed **one** of the ad's placements to have room, so its other placements could be overbooked. Two simultaneous approvals could both take the last slot. Reinstating had **no** capacity check. | `ads_assert_capacity()`: **every** placement the ad uses must be active and below its cap. A live ad paused for re-review **keeps its slot** and doesn't count against itself. The check runs under a transaction-scoped advisory lock, so approvals and reinstatements are serialised. Used by approve **and** reinstate. | A1.1–A1.8, A2.5 |
| 2 | No reinstatement after expiry; full revalidation | Reinstate didn't check expiry, media, link, entitlement or capacity. | Reinstate runs `ads_assert_publishable()`: entitlement still valid (not refunded), **not expired**, every creative approved and public, link checked, boost listing still owned and live. It then runs the capacity check. A campaign suspended before it ever started goes back to review instead. | A2.1–A2.6 |
| 3 | Media privacy on real Cloudinary | Untested against the live API. Approved media couldn't be taken private again. The earlier report wrongly called the signed preview URLs "short-lived". | **Tested on real Cloudinary** (isolated throwaway folder, everything deleted). New `unpublishAdAsset()` plus `ads_reject_media()`: an admin can **withdraw** an approved creative, which makes it private again in Cloudinary first, then marks it rejected and **suspends every live campaign using it**. Delivery only ever serves approved and public media, and the database forbids public delivery of unapproved media. Documentation corrected: signed URLs don't expire and are only given to the owner and admins. | Live L1–L14, A3.1–A3.3 |
| 4 | Changes withdraw approval | Enforced only in one API route. A no-op save still took a live ad offline. | **Database triggers** on campaigns and campaign media: any change to a live ad's headline, text, button, link, listing or creatives sends it back to review and pauses delivery, **whoever** makes the change. A live boost can't be retargeted at all. The API sends only fields that actually changed, so an unchanged save leaves the ad live. | A4.1–A4.7 |
| 5 | Fair duration handling | Time spent in re-review after an edit was lost. There was no way to compensate for outages. | Policy in §2, implemented in `ads_go_live()` and `ads_extend_campaign()` (new admin **Extend** button: logged, note required, capped). | A5.1–A5.7 |
| 6 | Google Play purchase safety | The rules were embedded in the HTTP handler and untested. An unbound purchase got a misleading error. | Rules moved to `lib/adsPurchase.js`; the route injects real dependencies, tests inject database-backed ones. Covered: replay, uniqueness (real constraint), ownership, pending, cancelled, multi-quantity, unbound purchase (now its own clear refusal), concurrent duplicate, consume only after a grant. Refund sync only touches advertising entitlements; an AI-subscription token changes nothing. | B6.1–B6.11, A6.1–A6.3 |
| 7 | Database-driven, purchasing off | — | Confirmed: 7 packages at the approved prices; every `google_play_product_id` is NULL; `PROMOTIONAL_BILLING_ENABLED` is absent from `.env.local` and from Vercel. Purchasing is refused unless **both** the flag and a product ID are set. | A7.1–A7.2, B7.1–B7.3 |
| 8 | Unrelated infrastructure untouched | — | `git diff` since the last release (`dd33e2c`): **zero** changes to Paystack, USDT, cart, orders, escrow, the seller ledger, wallet, withdrawals or the AI subscription. The only edit to existing billing code is `export` on `getGooglePlayAccessToken` in `lib/aiPayments.js`. | §3 inventory |
| 9 | Real role restrictions + API access control | Privileges were checked by catalogue queries only. | Tests run **as** the `anon`, `authenticated` and `service_role` roles (`SET ROLE`): client roles are denied SELECT on all 8 tables, INSERT, and every function. The **real route handlers** are exercised: no login → 401, forged token → 401, participant token on admin routes → 401, wrong cron secret → 401, malformed input → 400 before any database access. | A9.1–A9.6, D1–D7 |
| 10 | Staging only | — | Local PGlite (production-shaped tables, Supabase-equivalent roles) plus an isolated Cloudinary folder. No production SQL, no deploy. | — |

**Also fixed during testing:** a purchase with no account binding was refused with "belongs to another account". It now gets its own message and status (B6.6).

---

## 2. Duration policy (implemented)

| Situation | What happens to the paid time |
|---|---|
| Waiting for the first admin review | **Not charged.** The period starts when the ad first goes live. |
| Advertiser edits a live ad (text, link, creatives) | Ad pauses for re-review. **The paused time is added back** on re-approval, so the advertiser gets the full paid exposure, never more. |
| Admin suspends for a policy breach | **Clock keeps running.** Cannot be reinstated after the period ends. |
| Platform outage or wrongful suspension | Admin **Extend** adds hours (note required, logged). Total compensation is capped at the package duration. An already-ended campaign is extended from now. |
| Purchase refunded at Google | Entitlement refunded and campaign ended (via Sync refunds). |
| Creative withdrawn by admin | Creative made private; live campaigns using it are suspended (clock keeps running; Extend if the withdrawal was the platform's error). |

---

## 3. Tests performed

| Suite | Environment | Result |
|---|---|---|
| **Readiness suite** (`ads-readiness-test.mjs`): migration verification; items 1, 2, 4, 5, 6, 7 and 9 at database level; purchase rules on the real unique constraint; library checks; **real API handlers** for access control | PGlite + real repo files loaded directly | **105 / 105** |
| **Original suite** (re-run on the hardened migration): business rules, link and SSRF rules, Cloudinary signing and validation, billing gate | PGlite + library copies | **78 / 78** (one assertion updated for the new pause-return policy) |
| **Live Cloudinary**: signed private upload; tampered folder or delivery type rejected (401); SVG rejected (400); Admin API verification; pending asset gives 404 publicly and 401 unsigned; signed preview 200; forged signature 401; approval makes it public; withdrawal makes it private again (CDN cleared in ~10 s); deletion removes it | Real Cloudinary account, throwaway `onedream_ads/selftest-*` folder, 1×1 PNG, cleaned up | **14 / 14** |
| Syntax / type checks | All new server files parse; admin portal script parses; the app was typechecked when the screens were added (no app changes in this review) | ✅ |

**Total: 197 automated checks passing.**

---

## 4. Remaining risks

| Risk | Level | Mitigation / note |
|---|---|---|
| True multi-connection concurrency wasn't exercised (PGlite has one connection). | Low | The advisory lock is verified in the function body (A1.4). It's standard Postgres behaviour. Optionally test two simultaneous approvals on a Supabase branch. |
| Signed preview URLs for pending media don't expire. | Low | They're only given to the owner and admins, and they're unguessable. Rejected assets stay private; removed assets are deleted. Time-limited URLs need Cloudinary's paid token authentication. |
| No automated malware or content scanning. | Medium (grows with volume) | Formats are allow-listed (no raw, SVG or HTML), and size and duration are checked server-side. Admin review is mandatory. Consider Cloudinary's moderation and malware add-ons and Google Safe Browsing for links. |
| An external link could change behind an approved URL (the site edits its page or redirect later). | Medium | Redirects are re-checked at submission, admins see the final URL, and the app warns before leaving. Admins can suspend. Consider periodic re-checks of live links. |
| A DNS answer could change between our link check and our request. | Low | Only affects the server's one-time link check (HEAD/GET with no body read). It doesn't affect users. |
| Impressions and clicks can be inflated by rotating device IDs. | Low | De-duplicated per viewer per hour. Nothing is billed per impression, so there's no financial impact. Treat the numbers as indicative. |
| Live Google Play behaviour (purchase, consume, refund) is untested end to end. | Expected | Needs Stage 2 products and license testers (implementation report §7). Purchasing stays off until then. |
| Billing policy interpretation | — | In-app ads and boosts must use Google Play Billing on Android. Re-check Google's current policy at activation. |

---

## 5. Exact deployment requirements

**Order matters. Do not skip a step.**

1. **Supabase:** run **`supabase/add_advertising.sql`** (the whole file, in one paste) in the SQL editor. Confirm **every row of the final result is `ok = true`** (35 checks, including both triggers and the function privileges). It's additive: it creates 8 new tables and 11 functions and changes no existing table.
2. **Crosscheck** (read-only, via the API with the service role): packages readable, 7 rows, all product IDs NULL; `ads_record_event` callable; client roles blocked. I'll run this as before.
3. **Deploy the API and website** (`vercel deploy`, preview first, then production). Leave **`PROMOTIONAL_BILLING_ENABLED` unset.** No other new environment variables are needed: `CLOUDINARY_URL` and the Google credentials already exist.
4. **Rebuild the web app** (`/app` export) and the **APK**, then install.
5. **Smoke test (no money):** in the admin portal, **Grant a package** to a test account. Then upload an image, create an ad and submit it. Approve it in **Ads**, see it labelled "Sponsored", check impressions and clicks, try **Extend** and **Withdraw** on a creative, and suspend and reinstate.
6. **Stage 2 (separate approval):** create the Play products, enter their IDs in Admin → Ads, and test with license testers on a preview with `PROMOTIONAL_BILLING_ENABLED=true`. Only then enable it in production.

**Files changed in this review:**
- `supabase/add_advertising.sql` (rules, triggers, columns `paused_at` and `compensated_hours`, privileges, verification)
- `lib/adsPurchase.js` (new), `pages/api/ads/purchase-google-play.js`, `lib/adsGooglePlay.js`, `lib/cloudinaryAds.js`, `lib/ads.js`
- `pages/api/ads/campaigns.js`, `pages/api/admin/ads/review.js`
- `public/admin-portal.html` (Extend and Withdraw controls)
- `docs/ADVERTISING_IMPLEMENTATION_REPORT.md` (corrections)
