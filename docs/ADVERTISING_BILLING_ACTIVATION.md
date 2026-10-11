# Advertising & boosts — Google Play billing: built, awaiting Play Console setup

**Date:** 2026-10-11 · **Status:** billing is fully built and **switched on**. The only outstanding work is your Google Play Console configuration. **No further code changes are needed to enter or replace the real product IDs.**
Not yet deployed and no production SQL run (see "Deployment" below).

---

## 1. What's built

| Capability | How it works |
|---|---|
| Product discovery | The app asks Google Play for the 7 product IDs stored in the database (`fetchProducts`, type `in-app`) |
| Purchase flow | One-time in-app purchase, bound to the buyer's account (`obfuscatedAccountIdAndroid`) |
| Price shown | **Google Play's own price and local currency** (`displayPrice`) appears on the button and in the confirmation. No hardcoded USD is charged. If the Play product is priced in USD and differs from the package price, that package is blocked until fixed. |
| Server verification | `POST /api/ads/purchase-google-play`: re-reads the purchase from Google with the existing service account. It must be PURCHASED (not pending or cancelled), bound to this account, quantity 1. |
| Replay protection | Purchase token is unique: retries and restores return the same entitlement; another account's token is refused |
| Grant + consume | Exactly one entitlement, then the purchase is **consumed** (which also acknowledges it), so the package can be bought again |
| Interrupted purchases | When Promote opens, unfinished purchases are re-verified automatically (`getAvailablePurchases`) |
| Refunds and revocations | A daily cron plus an admin **Sync Play refunds** button: the entitlement is marked refunded and the campaign ends |
| Purchase history | Promote → Packages → **Purchase history** (paid / granted, order ID, status, refund reason) |
| Campaign access | A purchased package appears under **Your packages**, and you create the ad or boost from there. Durations still start when the campaign goes live. |
| Admin configuration | Admin → **Ads → Packages**: product ID per package (editable, saved instantly), **Check Google Play** status, purchases and grants, refunds |

**Availability is per package.** One package not being set up never affects the others:

| Situation | What the buyer sees |
|---|---|
| Product ID set and Google Play returns the product | **Buy · ₦…/$…** (Google's price) |
| Product ID set but not created or active in Play Console | **Awaiting Google Play configuration** |
| Billing connection still starting | Connecting to Google Play… |
| Website or web app (not Android) | Buy in the Android app |
| Package retired by admin | Not available right now |

**Placeholders never grant anything.** A product that doesn't exist in Play can't produce a purchase. If a token is submitted anyway, Google's verification fails and the server refuses (tested: B7.5).

**Emergency stop:** setting `PROMOTIONAL_BILLING_PAUSED=true` in Vercel halts all sales. It's off by default and not needed for normal operation.

---

## 2. Placeholder product IDs (seeded — create these exact IDs in Play Console)

| Package | Price | Product ID |
|---|---|---|
| Starter Ads | $10 | `onedream_ad_starter` |
| Growth Ads | $20 | `onedream_ad_growth` |
| Premium Ads | $40 | `onedream_ad_premium` |
| Business Ads | $75 | `onedream_ad_business` |
| Quick Boost | $3 | `onedream_boost_quick` |
| Seller Boost | $10 | `onedream_boost_seller` |
| Power Boost | $25 | `onedream_boost_power` |

If you choose different IDs in Play Console, type them into **Admin → Ads → Packages** and press **Save**. That's all: no code change, rebuild or redeploy. The app picks them up the next time Promote opens.

Future packages work the same way: add a row (admin API `POST /api/admin/ads/packages`), give it a product ID, and create that product in Play.

---

## 3. Google Play Console setup

1. **Play Console → your app (com.flymaddcreative.onedream) → Monetize with Play → Products → One-time products → Create one-time product.** Do this once per row in §2.
   - **Product ID:** exactly as in §2. Product IDs can never be reused once created.
   - **Name and description:** e.g. "Growth Ads — 7 days of sponsored placement".
   - **Purchase option / price:** set the default price in **USD equal to the package price**. Review the local prices Play generates (NGN, etc.), or set them yourself.
   - Keep **multi-quantity off** (the server refuses quantity > 1).
   - **Activate** the product and its purchase option.
   - You don't need to set "consumable": our server consumes each purchase after granting it.
2. **Service account** (the one the AI subscription already uses), in Play Console → **Users and permissions**. It needs:
   - **View financial data, orders and cancellation survey responses**, for refund sync;
   - **Manage orders and subscriptions**, which it already has for the AI subscription; needed to consume and acknowledge;
   - **View app information**, for the admin **Check Google Play** button.
3. **License testers:** Setup → **License testing** → add the testers' Gmail accounts (test purchases aren't charged).
4. **A build with the Promote screens on a testing track:** upload the release containing this feature to **Internal testing**. Testers install the app **from the Play Store link** (billing doesn't work in sideloaded APKs).
5. **Vercel:** add **`CRON_SECRET`** (any long random string) so the daily refund sync and link re-check jobs can run. Nothing else is needed: the Google credentials and `CLOUDINARY_URL` already exist.
6. **Admin → Ads → Check Google Play:** every package should show **Purchasable** (green) with its price. **Not in Play Console** means the product ID doesn't exist yet, or differs from what's in Play. **Inactive in Play** means it isn't activated. **Check failed** usually means a missing permission from step 2. A "price differs" note means the USD price in Play doesn't match the package price.

### Acceptance test (mandatory before announcing paid ads)

With a license tester on the internal-testing build:
1. Promote → Packages: the cards show Google's prices and **Buy** is enabled.
2. Buy **Quick Boost** → it appears in *Your packages* and *Purchase history* → boost a listing → it goes live with "Sponsored".
3. Buy **Starter Ads** → upload an image → create the ad → submit → approve it in Admin → it shows on the shop page; impressions and clicks count.
4. Kill the app during a purchase, reopen Promote → the package appears (recovery).
5. In Play Console → Order management, **refund** one test order → Admin → **Sync Play refunds** → the entitlement shows Refunded and its campaign ends.
6. Confirm the **AI subscription** still loads and shows the correct plan (it uses separate code paths).

---

## 4. Tests (isolated staging — PGlite + real repo code, mocked Google responses)

| Suite | Result |
|---|---|
| Readiness suite: database rules, roles, purchases, link health, API access | **122 / 122** |
| Original suite (rules, link and SSRF safety, Cloudinary signing, billing gate) | **78 / 78** |
| Live Cloudinary privacy test (earlier this session; Cloudinary code unchanged since) | **14 / 14** |

Billing and purchase checks include:
- **Availability:** a retired package can't be bought; the emergency pause stops sales; an empty or unknown product ID is refused; **a placeholder with no real Play purchase never grants** (Google 404); no global switch.
- **Purchases:** a verified purchase grants exactly one entitlement and is consumed; replay returns the same entitlement; another account's token is refused; pending, cancelled, multi-quantity and unbound purchases are refused; a concurrent duplicate resolves to one entitlement; consumption happens only after a grant.
- **Refunds:** a refund ends the campaign exactly once; an AI-subscription token changes nothing.
- **Access control:** the new admin routes (Check Google Play, link re-check) require an admin login; cron calls with a wrong secret are refused.

Also added in this round:
- **Link freshness:** approval and reinstatement need a link check from the last 7 days. A daily job re-checks live links: a broken link suspends the ad, and a changed redirect sends it back to review (A4.11–A4.12, A8.1–A8.4).
- **Creative trigger:** re-ordering, replacing or deleting creatives on a live ad forces re-review; drafts are unaffected (A4.8–A4.10).

**Not testable here:** real Google Play purchases, prices and refunds. That's the acceptance test in §3, which needs your products.

---

## 5. Untouched

There have been no changes since the last release to Paystack, USDT, marketplace checkout, orders, escrow, the seller ledger, wallet, withdrawals or the AI subscription. The only edit to existing billing code is the `export` keyword on `getGooglePlayAccessToken` (`lib/aiPayments.js`), so the ads code can reuse the same Google login.

`vercel.json` gains two daily cron entries: refund sync at 03:15 UTC and link re-check at 03:45 UTC.

---

## 6. External dependencies remaining

| Dependency | Owner |
|---|---|
| Create and activate the 7 products in Play Console (IDs in §2, or enter your own in Admin) | You |
| Service-account permissions (§3 step 2) | You |
| License testers and an internal-testing release containing Promote | You (I can build the AAB) |
| `CRON_SECRET` in Vercel | You (or I can set it with your approval) |
| Run `supabase/add_advertising.sql` (35 verification rows, all `ok = true`) | You |
| Deploy the website, web app and APK | Me, after your approval |

---

## 7. Deployment (needs your approval)

1. You run **`supabase/add_advertising.sql`** in Supabase. Every verification row must say `ok = true`; one of them confirms the 7 placeholders are seeded.
2. I crosscheck the live database (read-only).
3. Set **`CRON_SECRET`** in Vercel; leave `PROMOTIONAL_BILLING_PAUSED` unset.
4. I deploy the website and API (preview, then production), rebuild the web app (`/app`) and APK, and can build an **AAB for the internal-testing track**.
5. Run the acceptance test (§3) with a license tester, then announce.
