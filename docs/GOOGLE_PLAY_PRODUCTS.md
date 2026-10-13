# Google Play products — setup reference

_The single list of every product to create in Play Console. Last updated 2026-10-11 (creator subscriptions added)._

The **product IDs below are placeholders**: they're already stored in the database and used by the app. Either create them in Play Console **exactly as written**, or create your own and type yours into the admin portal. In both cases, **no code change, rebuild or redeploy is needed.**

Where each ID lives:

| Group | Source of truth | Change it in |
|---|---|---|
| Advertising and boost packages | `advertising_packages.google_play_product_id` | Admin portal → **Ads** → Packages |
| Digital-product price tiers | `digital_price_tiers.google_play_product_id` | Admin portal → **Digital** → Google Play price tiers |
| Creator subscription products | `digital_sub_products.google_play_product_id` | Admin portal → **Digital** → Creator subscriptions |
| AI subscriptions (already live) | `GOOGLE_PLAY_AI_PRO_PRODUCT_ID` / `GOOGLE_PLAY_AI_BUSINESS_PRODUCT_ID` (Vercel env), else the defaults below | Vercel env (don't change: live) |

Use **Check Google Play** in each admin tab. It shows each product as *Purchasable*, *Not in Play Console*, *Inactive*, or *Check failed*, and warns if the USD price differs.

---

## 1. AI subscriptions — Bascardo AI (already set up, for reference only)

| Plan | Product ID | Type | Price | Billing |
|---|---|---|---|---|
| Pro (200 credits) | `bascardo_ai_pro_monthly` | Subscription | $9.00 / month | One monthly base plan |
| Business (750 credits) | `bascardo_ai_business_monthly` | Subscription | $20.00 / month | One monthly base plan |

Do not modify these.

---

## 2. Advertising packages — one-time products (consumable)

| Package | Product ID (placeholder) | Price (USD) | What the buyer gets |
|---|---|---|---|
| Starter Ads | `onedream_ad_starters` ✅ created | **$10.00** | 3 days, 1 creative, shop and category placements |
| Growth Ads | `onedream_ads_growth` ✅ created | **$20.00** | 7 days, 2 creatives, home, shop and category |
| Premium Ads | `onedream_ad_premium` ✅ created | **$40.00** | 15 days, 3 creatives, all placements |
| Business Ads | `onedream_ad_business` ✅ created | **$75.00** | 30 days, 5 creatives, all placements |
| Bronze Ads | `onedream_ad_bronze` | **$100.00** | 30 days, 6 creatives, all placements, priority 50 |
| Silver Ads | `onedream_ad_silver` | **$200.00** | 30 days, 7 creatives, all placements, priority 65 |
| Gold Ads | `onedream_ad_gold` | **$500.00** | 30 days, 8 creatives, all placements, priority 80 |
| Platinum Ads | `onedream_ad_platinum` | **$999.99** | 30 days, 10 creatives, all placements, priority 100 (max) |

Ads are picked at random, weighted by priority, so priority 100 is shown about 2.5x as often as Business (40) and 10x as often as Starter (10) when competing for the same slot.

Starter and Growth were created in Play Console as `onedream_ad_starters` / `onedream_ads_growth` (Play IDs can't be renamed). `supabase/add_ad_tier_packages.sql` points the packages at those IDs and adds Bronze to Platinum.

## 3. Listing boost packages — one-time products (consumable)

| Package | Product ID (placeholder) | Price (USD) | What the buyer gets |
|---|---|---|---|
| Quick Boost | `onedream_boost_quick` | **$3.00** | 24 hours of extra visibility for one listing |
| Seller Boost | `onedream_boost_seller` | **$10.00** | 7 days for one listing |
| Power Boost | `onedream_boost_power` | **$25.00** | 30 days for one listing |

## 4. Digital-product price tiers — one-time products (consumable)

Sellers' e-books, audio and video are sold through these **price tiers**: the seller picks a price, and the buyer buys that tier. Each purchase also records **which item** and **which buyer** inside Google's own record, so a tier can only unlock the exact item it was bought for, and never a more expensive one.

| Tier | Product ID (placeholder) | Price (USD) |
|---|---|---|
| tier_0099 | `onedream_digital_0099` | **$0.99** |
| tier_0199 | `onedream_digital_0199` | **$1.99** |
| tier_0299 | `onedream_digital_0299` | **$2.99** |
| tier_0399 | `onedream_digital_0399` | **$3.99** |
| tier_0499 | `onedream_digital_0499` | **$4.99** |
| tier_0599 | `onedream_digital_0599` | **$5.99** |
| tier_0699 | `onedream_digital_0699` | **$6.99** |
| tier_0799 | `onedream_digital_0799` | **$7.99** |
| tier_0899 | `onedream_digital_0899` | **$8.99** |
| tier_0999 | `onedream_digital_0999` | **$9.99** |
| tier_1299 | `onedream_digital_1299` | **$12.99** |
| tier_1499 | `onedream_digital_1499` | **$14.99** |
| tier_1999 | `onedream_digital_1999` | **$19.99** |
| tier_2499 | `onedream_digital_2499` | **$24.99** |
| tier_2999 | `onedream_digital_2999` | **$29.99** |
| tier_3999 | `onedream_digital_3999` | **$39.99** |
| tier_4999 | `onedream_digital_4999` | **$49.99** |

Suggested Play Console name: "Digital item — $4.99". Description: "Unlocks one digital product in One Dream at this price."

## 4b. Creator subscriptions — subscriptions (auto-renewing, monthly)

Creators sell a monthly subscription that unlocks every digital product they include. Like the price tiers, a creator picks a **price**, and subscribers buy a product at that price. Google's own purchase record stores **which subscriber** and **which creator** it is for.

**Why three products per price ("slots"):** Google Play lets one user hold only **one live subscription per product**. With one product per price, a user couldn't subscribe to two creators at the same price. The app automatically uses the first slot the user doesn't already hold. Three slots means a user can follow up to 3 creators at each price; add more slots in the admin portal ("+ slot") if needed.

| Price / month | Slot 1 (placeholder) | Slot 2 (placeholder) | Slot 3 (placeholder) |
|---|---|---|---|
| **$1.99** | `onedream_creator_0199_s1` | `onedream_creator_0199_s2` | `onedream_creator_0199_s3` |
| **$2.99** | `onedream_creator_0299_s1` | `onedream_creator_0299_s2` | `onedream_creator_0299_s3` |
| **$4.99** | `onedream_creator_0499_s1` | `onedream_creator_0499_s2` | `onedream_creator_0499_s3` |
| **$7.99** | `onedream_creator_0799_s1` | `onedream_creator_0799_s2` | `onedream_creator_0799_s3` |
| **$9.99** | `onedream_creator_0999_s1` | `onedream_creator_0999_s2` | `onedream_creator_0999_s3` |
| **$19.99** | `onedream_creator_1999_s1` | `onedream_creator_1999_s2` | `onedream_creator_1999_s3` |

Suggested Play Console name: "Creator subscription — $4.99/month". Description: "Monthly access to one creator's digital products in One Dream."

**Each subscription needs exactly one base plan:**
- auto-renewing, billing period **1 month**;
- default price in **USD equal to the table**;
- **no free trial or introductory offer.** The app refuses to sell a subscription with zero or several monthly base plans, or with an intro price;
- grace period and account hold: Google's defaults are fine.

**Total to create: 11 promotional products + 17 digital tiers = 28 one-time products, plus 18 creator subscriptions** (and the 2 existing AI subscriptions).

**Website:** advertising and boost packages (`supabase/add_ads_paystack.sql`), creator subscriptions and digital items can all be bought by card (Paystack, charged in NGN at the live rate) on the website and in the web app. That needs no Play Console setup, only `PAYSTACK_SECRET_KEY` (already set). Website subscriptions renew by charging the saved card once a month, from the daily billing job.

---

## 5. Creating each one-time product in Play Console

*(Creator subscriptions: **Monetize with Play → Products → Subscriptions → Create subscription**, then add the monthly base plan as in section 4b and activate it.)*

1. Play Console → your app (**com.flymaddcreative.onedream**) → **Monetize with Play → Products → One-time products → Create one-time product**.
2. **Product ID:** exactly as above. IDs can never be reused after creation, even if deleted.
3. **Name and description:** buyer-facing (e.g. "Growth Ads — 7 days").
4. **Purchase option / price:** set the **default price in USD to the amount in the table**. Review the local prices Play generates (NGN etc.); you may round them, but keep USD exact.
5. **Multi-quantity: off.** The server refuses quantity > 1.
6. **Activate** the product and its purchase option.
7. You don't need to mark it consumable. One Dream's server consumes each purchase after granting it, which also acknowledges it, so the product can be bought again.

**Service account** (the one the AI subscription uses), in Play Console → Users and permissions:
- **View financial data, orders and cancellation survey responses**, for refund sync;
- **Manage orders and subscriptions**, which it already has; needed to verify, consume and acknowledge;
- **View app information**, for the admin **Check Google Play** buttons.

**Testing:** add **license testers** (Setup → License testing) and install the app from an **internal testing** track; Play billing doesn't work on sideloaded builds. Test purchases aren't charged.

---

## 6. Safety rules built in (so placeholders are harmless)

- **A placeholder ID with no Play product can't be bought.** Google has nothing to sell, and the server only grants after Google confirms a real, paid purchase.
- **Each package and tier is independent.** One not yet created shows "Awaiting Google Play configuration" without affecting the others.
- **Refunds and chargebacks** are pulled daily from Google (and from Paystack for website payments): the ad campaign ends, the digital licence is revoked, or the subscription ends, and the seller's earning is reversed.
- **A subscription Google can't attach to a creator plan is never acknowledged,** so Google refunds it automatically within 3 days (same as one-time digital purchases).
- **Real-time notifications:** Google sends subscription notifications to the AI subscription's existing endpoint, which ignores products that aren't AI plans. Creator subscriptions don't depend on them: they're refreshed when the subscriber opens the Library and by the daily job.
- **Emergency stops** (Vercel env, off by default): `PROMOTIONAL_BILLING_PAUSED=true` for ads and boosts, `DIGITAL_SALES_PAUSED=true` for digital products.
- **Daily jobs** (`vercel.json`) need **`CRON_SECRET`** set in Vercel:
  - 03:15 UTC: ad refunds;
  - 03:30 UTC: digital refunds;
  - 03:40 UTC: digital billing: website payments, refunds, website subscription renewals, Google subscription refresh;
  - 03:45 UTC: ad link re-check.
