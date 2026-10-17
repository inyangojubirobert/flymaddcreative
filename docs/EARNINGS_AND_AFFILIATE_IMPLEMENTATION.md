# Merchant Affiliate Marketplace & Dream Coin Gift Revenue Sharing: Implementation Report

17 October 2026. Branch `web-app-apk-parity-ad-tiers`. Specifications:
- [MERCHANT_AFFILIATE_FRAMEWORK.md](MERCHANT_AFFILIATE_FRAMEWORK.md)
- [DREAM_COINS_GIFT_REVENUE_SHARING.md](DREAM_COINS_GIFT_REVENUE_SHARING.md)
- the owner's decisions of 17 October.

**State:**
- Built and tested locally.
- Nothing deployed, and no migration applied to production.
- No real-money feature is switched on.
- No protected payment code changed. P1, P3, P4, P5 and P6 are prepared and waiting for approval (P2 is not needed); see [protected-patches/README.md](protected-patches/README.md).

## 1. Owner decisions, as implemented

| Decision | Implementation |
|---|---|
| 50% recipient / 40% One Dream / 10% merchant who referred the recipient | `earnings_settings` 50 / 10. The platform keeps the remainder (40%, or 50% with no eligible merchant). The merchant's 10% is **not** taken from the recipient's 50% |
| Merchant share for 12 months from the recipient's registration | `participants.created_at + 12 months`, calendar months. The end date is stored on each gift; a gift sent before it ends stays eligible whenever it is paid |
| Value gifts from the real Google Play product economics, with no invented rate | Every coin purchase becomes a **lot**. Its value is the configured Play price for the product × the verified quantity (provisional), then the **actual** charge + Google fee + tax from Google's earnings report (final). A gift is valued from the lots that paid for it |
| Google's 15% fee is not assumed | Provisional values use a configurable fee estimate, defaulting to 30% so they are never overstated. Final values use the fee and tax Google actually charged on that order, whatever tier applied |
| No fixed holding period | Gift earnings become withdrawable when the admin records that **Google's payout for the report containing that lot has reached the bank**. Marketplace commission becomes withdrawable when the order is withdrawable for the seller under the existing rules (`buyer_confirmed` / `released`) |
| Net vs gross basis (open question) | `gift_value_basis = 'net'` by default (Google's actual proceeds), switchable to `'gross'` in admin. Each gift stores the basis it was valued on |
| All four affiliate models | Referral, storefront and resale in one offer engine. Creative services run as ordinary service listings, with engagements and optional performance offers |
| Seller-funded by default, explicit opt-in; platform-funded campaigns budgeted | The seller sees the financial impact and must accept it. Seller-funded commission is tracked now and accrues once P1 is applied. Platform-funded campaigns are capped by the platform commission share, the monthly budget and the per-partner cap |
| 30% maximum (admin-configurable), 7-day window, seller approval auto/manual | `earnings_settings` and `affiliate_offers.approval` |
| New-seller referral: a time-limited share of the platform commission | 20% of One Dream's commission on the referred seller's orders for 6 months (configurable), within the per-order budget |
| Unified merchant identity, separate ledgers | `merchant_participant_links` (one merchant ↔ one participant). One `partner_ledger` with `source` = `gift_recipient` / `gift_referral` / `affiliate` / `resale` / `referral`; each source has its own pending, available, reserved and paid balance |

## 2. Incompatibilities and limits found (reported, not hidden)

1. **Google's purchase check returns no price.**
   - `purchases.products.get` gives quantity, state and region, but no amount.
   - Per-order money therefore comes only from the Play Console **earnings report**, imported in the admin portal.
   - Until a lot is reconciled, its value is a provisional estimate, shown to users as an "estimate".
2. **Earnings reports in other payout currencies are refused.** Only USD reports can be imported; the ledger is USD and no rate is guessed. If One Dream's Play payout currency isn't USD, a conversion source has to be agreed first.
3. **No automated disbursement.**
   - Payout requests, approval and failure handling are built.
   - The transfer itself is made through the payout provider, and its reference is recorded.
   - Requests stay closed until `payouts_enabled` is on **and** `PAYOUTS_PROVIDER_LIVE=true`.
4. **Seller-funded commission can't come out of seller payouts without P1.** It is tracked as `awaiting_seller_settlement` and is never paid retroactively, because those sellers were paid in full.
5. **Resale at the reseller's price needs P3.** Until then, a resale partnership sells at the seller's price and earns the referral commission, if the offer allows referrals.
6. **Paid orders that are never created.**
   - A Paystack buyer who pays and never returns gets no order today (an existing gap).
   - The read-only monitor is built (`/api/admin/earnings/orphans`).
   - Automatic completion needs P6.
   - Single-listing payments can't be completed automatically, because Paystack has no buyer contact for them.
7. **Website pages (`public/*.html`) are unchanged.**
   - Storefronts live in the web app at `/m/<handle>`, which is rewritten into `/app`. Partner links (`/r/<code>`) open listings in the web app.
   - Website single-listing checkout (the inline Paystack popup) carries no attribution.
8. **Partner creatives are uploaded as public Cloudinary assets** in `onedream_affiliate/<partner>`. They only appear on a storefront after admin approval, but the raw URL is reachable before approval. Ads use authenticated delivery instead; switching creatives to the same model is a follow-up.
9. **Merchant gift-referral earnings are only as complete as referral tracking.** A merchant earns only on recipients who registered with that merchant's `ref_code`. Production currently has none.
10. **Platform-funded spend is checked per order, not under a lock.** Under concurrency the monthly budget can be exceeded by at most one order's commission. Seller-funded money is unaffected.

## 3. Database (additive migrations; run in this order)

| File | Contents |
|---|---|
| `supabase/add_earnings_and_payouts.sql` | `earnings_settings` (activation switches, all off), `merchant_participant_links`, `partner_ledger` (append-only, idempotent), `payee_profiles`, `payout_requests`, `payout_events`, `earnings_admin_audit`; `partner_ledger_post`, `partner_ledger_move`, `partner_balances`, `payout_request_create` (locked per party and source, available balance only, payee verified and 18+, minimum amount), `payout_request_decide` |
| `supabase/add_gift_revenue_sharing.sql` | `coin_lots`, `gift_lot_allocations`, `gift_earnings`, `gift_earning_components`, `play_settlement_batches`, `play_settlement_lines`; replaces five Dream Coins functions **with identical signatures and coin behaviour** (credit, reverse, send, gift reversal, admin adjust), adding lots and earnings; adds `play_settlement_import`, `coin_lots_reconcile`, `play_settlement_mark_funds` |
| `supabase/add_affiliate_marketplace.sql` | Partners, offers, memberships, resale price log, creatives, collections, links, clicks, intents, attributions (one per order), referral rewards, creative engagements; join, click, intent, attribution, resale attribution, matching, lifecycle, referral rewards, reversal and release |

Every table has RLS on with no policies and no client-role grants, and every function is `service_role` only. Each migration ends with a verification query.

**Rollback:**
- First, turn the switches off in the admin portal.
- Data: `supabase/rollback_earnings_affiliate.sql` refuses to run once ledger or payout records exist. Afterwards, re-run `add_dream_coins_gifting.sql` to restore the original Dream Coins functions. This is tested.

## 4. API

**Partner / participant:**
- `/api/affiliate/`:
  - `partner`, `link-merchant`;
  - `offers`, `memberships`, `links`, `collections`, `creatives`;
  - `click`, `intent`;
  - `engagements`, `seller/offers`, `seller/memberships`;
  - `storefront/[handle]` (public), `r/[code]` (redirect).
- `/api/earnings/`: `summary`, `payee`, `payouts`. These accept participant **or** merchant tokens.

**Admin** (`/api/admin/earnings/`):
- `index`, `settings`;
- `settlement` (import a Google report; mark the payout received);
- `payouts` (queue and payee verification);
- `affiliate` (creatives, partners, offers, attributions, One Dream-funded promotions);
- `jobs`, `export`, `orphans`, `complete-unreturned` (P6, inert).

**Crons** (`vercel.json`): `/api/admin/earnings/jobs` daily. The matching job also runs whenever a partner opens their earnings.

**Rewrites** (`next.config.js`): `/r/:code` → redirect API, `/m/:handle` → web app.

## 5. App and web app

- **Profile tab:** Partner programme; Earnings & withdrawals.
- **Partner hub:**
  - `/partner`: the four ways to earn, enrolment, merchant account linking.
  - `/partner/discover`: offers, with estimated earnings per sale and join actions.
  - `/partner/storefront`: bio, collections, tracked links, photo / video / text creatives, resale price.
  - `/partner/seller`: open listings to partners with the impact shown, accept terms, approve partners.
  - `/partner/engagements`: creative briefs and delivery.
- **`/earnings`:** balances per source, gifts received, gift referrals and referred recipients with their 12-month end dates, attributed sales, referral rewards, withdrawals, payout details.
- **`/merchant/earnings`:** the same view for merchant accounts, linked from the merchant dashboard.
- **`/m/<handle>`:** public storefront showing who sells and who ships. The seller's floor is never shown.
- **Checkout (additive, fire-and-forget):** the listing screen keeps `?aff=` tokens. The listing and cart screens send attribution intents as soon as the payment reference exists, or with the USDT hash. Payment calls are unchanged.
- **Admin portal:** new **🤝 Partners & Payouts** tab covering:
  - switches and settings;
  - signals;
  - Google report import and payout-received;
  - coin lots;
  - payout queue and payee verification;
  - creative moderation;
  - attributions (reverse / release), partners, offers and One Dream-funded promotions;
  - referral rewards, audit log, CSV exports, matching jobs, unreturned-payment check.

## 6. Tests (actual results)

`npm run test:earnings`: **55 / 55 pass**. These run the real migrations in an in-memory Postgres.
- `scripts/test-earnings.mjs` (27 tests):
  - every coin package and quantity priced as a lot;
  - gift earnings off by default;
  - one gift funded by two lots, with a 50/10/40 split that adds up exactly;
  - no referrer → platform keeps 50%;
  - merchant entitlement ends at exactly 12 months (both sides of the boundary);
  - circular and self-dealing gifts give the merchant nothing;
  - test and admin coins never create money;
  - retries never duplicate earnings;
  - partial and full refunds reverse only the gifts that lot funded (most recent first), and the ledger always equals the outstanding shares;
  - Google report reconciliation at 15% and at 30% plus tax, and re-importing is a no-op;
  - funds become available only when the payout is marked received;
  - a refund after release leaves a traceable negative balance;
  - admin gift reversal returns coins to their lots;
  - payouts: switched off, payee checks, under-18, minimum, available-only, idempotency, reserve / paid / failed, no double spend;
  - affiliate:
    - join rules and seller acceptance;
    - pre-payment intent matched later on the server;
    - capped platform commission;
    - one attribution per order;
    - dispute hold, release and reversal;
    - USDT front-running blocked;
    - window and click-after-order rules;
    - partner-as-buyer excluded;
    - seller-funded gated on P1;
    - monthly budget;
    - resale fallback and P3 margin;
  - seller and buyer referral rewards (once, time-limited, never twice on one order);
  - the P1 patch on a copy;
  - rollback.
- `scripts/test-dream-coins.mjs` (14) and `scripts/test-dream-coins-full.mjs` (14): the original Dream Coins suite, on its own migration and on the full stack with gift earnings on. **Coin behaviour is unchanged.**
- Mobile `tsc --noEmit` passes. ESLint reports nothing new; the 2 errors in `shop/cart.tsx` were already there.
- All new API routes bundle-check, and `next build` succeeds. Its only warning is the existing `getReferralLink` one.

**Not tested automatically:**
- real Google Play purchases and earnings reports;
- Paystack test payments through the new intent calls;
- Cloudinary uploads;
- device UI.

These need a preview deployment.

## 7. Financial reconciliation and remaining risks

- **Revenue is counted once, at purchase,** as Google's net, per lot. A gift creates a liability to the recipient and merchant against that lot. Unspent coins remain deferred revenue.
- **Coin balances and the coin ledger are never touched by earnings.**
- **What can be checked each month:**
  - imported report rows → lots reconciled;
  - the ledger, exported per party and source, always equals the outstanding (unreversed) shares (tested);
  - payouts equal reserved → paid moves.
- **Remaining risks:**
  - The provisional estimate differs from final values until the report arrives. Users see "estimate".
  - A refund after a payout creates a debt that is recovered from future earnings, but can't be recovered from someone who stops earning.
  - Payee identity checks are manual (admin verification) until a KYC provider is chosen.
  - Money transmission and tax obligations for paying users are unresolved. **This needs legal advice before payouts open.**

## 8. Configuration required

**Google Play:**
- Activate the 7 Dream Coin products (`scripts/create-dream-coin-products.mjs --activate`).
- Confirm whether One Dream is enrolled in the 15% service-fee programme.
- Confirm the Play payout currency is USD.
- Give the admin who imports reports access to Play Console > Download reports > Financial.

**Payout provider (not chosen):**
- bank or mobile-money transfers for Nigeria (and any other supported country);
- an identity verification process;
- then `PAYOUTS_PROVIDER_LIVE=true`.

**Environment (Vercel):**
- `AFFILIATE_TOKEN_SECRET`: recommended. It defaults to a value derived from the JWT secret.
- `PAYOUTS_PROVIDER_LIVE`: leave unset until payouts are approved.
- `CRON_SECRET`, `CLOUDINARY_URL` and `NEXT_PUBLIC_SITE_URL` already exist.

## 9. Production activation checklist

1. Owner approval to apply the migrations. Run the three files in order and check every verification row is `ok = true` (the SQL editor may apply only part of a paste).
2. Deploy (preview first), then check the new admin tab loads.
3. **Affiliate marketplace (no real money yet):**
   - partners enrol;
   - sellers open listings (seller-funded is tracked);
   - test a link → order → attribution on a preview with a Paystack test payment.
4. **Platform-funded campaigns:** set a monthly budget, then create a One Dream-funded promotion.
5. **P1 (seller-funded settlement):** approve and apply, then switch `seller_funded_settlement_enabled` on.
6. **Dream Coin sales:** the Google Play policy review (see the policy readiness document), products activated, `DREAM_COINS_ENABLED=true`.
7. **Gift earnings:**
   - Google Play policy re-assessment for creator earnings;
   - legal review;
   - Terms update;
   - then switch `gift_earnings_enabled` on. Gifts sent before then stay recognition only.
8. **Monthly:** import the earnings report → reconcile → when Google's payout arrives, mark it.
9. **Payouts:**
   - choose the provider;
   - settle the KYC process and minimum age;
   - set the minimum amount;
   - switch `payouts_enabled` on;
   - set `PAYOUTS_PROVIDER_LIVE=true`.
10. **P3** (reseller pricing), **P6** (unreturned payments), **P5** and **P4**: each as approved.

## 10. Files

**New:**
- `supabase/add_earnings_and_payouts.sql`, `supabase/add_gift_revenue_sharing.sql`, `supabase/add_affiliate_marketplace.sql`, `supabase/rollback_earnings_affiliate.sql`
- `lib/earnings.js`, `lib/earningsRules.js`
- `pages/api/affiliate/`: `partner.js`, `link-merchant.js`, `offers.js`, `memberships.js`, `links.js`, `collections.js`, `creatives.js`, `click.js`, `intent.js`, `engagements.js`, `seller/offers.js`, `seller/memberships.js`, `storefront/[handle].js`, `r/[code].js`
- `pages/api/earnings/`: `summary.js`, `payee.js`, `payouts.js`
- `pages/api/admin/earnings/`: `index.js`, `settings.js`, `settlement.js`, `payouts.js`, `affiliate.js`, `jobs.js`, `export.js`, `orphans.js`, `complete-unreturned.js`
- `scripts/test-earnings.mjs`, `scripts/test-dream-coins-full.mjs`, `scripts/lib/earnings-test-db.mjs`
- `mobile/src/api/earnings.ts`, `mobile/src/lib/affiliate-attribution.ts`, `mobile/src/components/earnings-view.tsx`
- `mobile/src/app/earnings.tsx`, `mobile/src/app/merchant/earnings.tsx`, `mobile/src/app/m/[handle].tsx`
- `mobile/src/app/partner/`: `index.tsx`, `discover.tsx`, `storefront.tsx`, `seller.tsx`, `engagements.tsx`
- `docs/protected-patches/`: P1, P3, P4, P5, P6 files and `README.md`; this report

**Changed:**
- `lib/dreamCoins.js`, `lib/dreamCoinsRules.js`: the billing region is recorded on coin lots.
- `scripts/test-dream-coins.mjs`: optional full-stack mode.
- `public/admin-portal.html`: new tab.
- `next.config.js`: rewrites.
- `vercel.json`: cron.
- `package.json`: `test:earnings`.
- App:
  - `mobile/src/app/_layout.tsx`, `(tabs)/profile.tsx`, `merchant/_layout.tsx`, `merchant/dashboard.tsx`: navigation;
  - `catalogue/item/[id].tsx`, `shop/cart.tsx`: attribution capture and intents only, payment calls unchanged;
  - `gifts/recognition/[username].tsx`: earnings link.
- Docs:
  - framework, revenue-sharing proposal and policy readiness: status updated.
