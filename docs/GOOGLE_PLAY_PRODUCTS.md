# Google Play products — what's left to set up

_Checked against Play Console on 2026-10-15. **Still to add: 18 creator subscriptions.** The 17 digital price tiers were created and activated on 2026-10-15._

The product IDs below are already stored in the database and used by the app. Create them in Play Console **exactly as written**, or create your own and type yours into the admin portal. Either way, no code change, rebuild or redeploy is needed. Until a product exists in Play Console, the app shows it as "Awaiting Google Play configuration"; the others are unaffected.

| Group | Source of truth | Change it in |
|---|---|---|
| Digital-product price tiers | `digital_price_tiers.google_play_product_id` | Admin portal → **Digital** → Google Play price tiers |
| Creator subscription products | `digital_sub_products.google_play_product_id` | Admin portal → **Digital** → Creator subscriptions |

Use **Check Google Play** in each admin tab. It shows each product as *Purchasable*, *Not in Play Console*, *Inactive*, or *Check failed*, and warns if the USD price differs.

---

## 1. Digital-product price tiers — 17 one-time products ✅ live (2026-10-15)

Sellers' e-books, audio and video are sold through these **price tiers**: the seller picks a price, and the buyer buys that tier. Each purchase also records **which item** and **which buyer** inside Google's own record, so a tier can only unlock the exact item it was bought for, and never a more expensive one.

| Product ID | Name | US price |
|---|---|---|
| `onedream_digital_0099` | Digital item — $0.99 | **0.99** |
| `onedream_digital_0199` | Digital item — $1.99 | **1.99** |
| `onedream_digital_0299` | Digital item — $2.99 | **2.99** |
| `onedream_digital_0399` | Digital item — $3.99 | **3.99** |
| `onedream_digital_0499` | Digital item — $4.99 | **4.99** |
| `onedream_digital_0599` | Digital item — $5.99 | **5.99** |
| `onedream_digital_0699` | Digital item — $6.99 | **6.99** |
| `onedream_digital_0799` | Digital item — $7.99 | **7.99** |
| `onedream_digital_0899` | Digital item — $8.99 | **8.99** |
| `onedream_digital_0999` | Digital item — $9.99 | **9.99** |
| `onedream_digital_1299` | Digital item — $12.99 | **12.99** |
| `onedream_digital_1499` | Digital item — $14.99 | **14.99** |
| `onedream_digital_1999` | Digital item — $19.99 | **19.99** |
| `onedream_digital_2499` | Digital item — $24.99 | **24.99** |
| `onedream_digital_2999` | Digital item — $29.99 | **29.99** |
| `onedream_digital_3999` | Digital item — $39.99 | **39.99** |
| `onedream_digital_4999` | Digital item — $49.99 | **49.99** |

**Description** (same for every tier): `Unlocks one digital product (e-book, audio or video) in One Dream, sold by its creator at this price.`

Created with `node scripts/create-google-play-products.mjs`, which creates any missing tier, activates any tier left in draft, and skips active ones (`--dry-run` first). Re-run it if a tier is ever missing.

**To recreate one by hand:** Play Console → **com.flymaddcreative.onedream** → **Monetize with Play → Products → One-time products → Create one-time product**, then for each:
1. **Product ID** exactly as above. IDs can never be reused after creation, even if deleted.
2. **Name and description** as above.
3. **Purchase option:** buy (not rent). Set the **United States price exactly** as in the table; Play may round it, so check it. You may round other countries' prices.
4. **Multi-quantity: off.** The server refuses quantity > 1.
5. **Tax and compliance:** withdrawal right = digital content.
6. **Activate** the product and its purchase option.

You don't need to mark them consumable: the server consumes each purchase after granting it.

## 2. Creator subscriptions — 18 subscriptions ⬜ to add

Creators sell a monthly subscription that unlocks every digital product they include. A creator picks a **price**, and subscribers buy a product at that price. Google's own purchase record stores **which subscriber** and **which creator** it is for.

**Why three products per price ("slots"):** Google Play lets one user hold only **one live subscription per product**. With one product per price, a user couldn't subscribe to two creators at the same price. The app automatically uses the first slot the user doesn't already hold, so three slots means a user can follow up to 3 creators at each price. Add more slots in the admin portal ("+ slot") if needed.

| Price / month | Slot 1 | Slot 2 | Slot 3 |
|---|---|---|---|
| **$1.99** | `onedream_creator_0199_s1` | `onedream_creator_0199_s2` | `onedream_creator_0199_s3` |
| **$2.99** | `onedream_creator_0299_s1` | `onedream_creator_0299_s2` | `onedream_creator_0299_s3` |
| **$4.99** | `onedream_creator_0499_s1` | `onedream_creator_0499_s2` | `onedream_creator_0499_s3` |
| **$7.99** | `onedream_creator_0799_s1` | `onedream_creator_0799_s2` | `onedream_creator_0799_s3` |
| **$9.99** | `onedream_creator_0999_s1` | `onedream_creator_0999_s2` | `onedream_creator_0999_s3` |
| **$19.99** | `onedream_creator_1999_s1` | `onedream_creator_1999_s2` | `onedream_creator_1999_s3` |

**Name:** `Creator subscription — $4.99/month` (the row's price). **Description:** `Monthly access to one creator's digital products in One Dream.`

Play Console → **Monetize with Play → Products → Subscriptions → Create subscription**. Each one needs **exactly one base plan**:
- auto-renewing, billing period **1 month**;
- United States price **exactly as in the table**;
- **no free trial or introductory offer.** The app refuses to sell a subscription with zero or several monthly base plans, or with an intro price;
- grace period and account hold: Google's defaults are fine.

Then **activate** the base plan.

---

## 3. Service account permissions

The service account `flymaddcreative-google-play@project-473bc27d-3cf6-4b56-a17.iam.gserviceaccount.com` (the one the AI subscriptions use) needs, in **Play Console → Users and permissions** (not Google Cloud):
- **Manage orders and subscriptions** (already has it): verify, consume and acknowledge purchases;
- **View app information**: the admin **Check Google Play** buttons;
- **View financial data, orders and cancellation survey responses**: daily refund sync;
- **Manage store presence**: only needed while running `scripts/create-google-play-products.mjs`. Granted on 2026-10-15; you can remove it now.

**Testing:** add **license testers** (Setup → License testing) and install the app from an **internal testing** track; Play billing doesn't work on sideloaded builds. Test purchases aren't charged.

---

## 4. Already live in Play Console (nothing to do)

- **AI subscriptions:** `bascardo_ai_pro_monthly` ($9/month), `bascardo_ai_business_monthly` ($20/month). Don't modify.
- **Advertising packages (7):** `onedream_ad_starters`, `onedream_ads_growth`, `onedream_ad_premium`, `onedream_ad_business`, `onedream_ad_bronze`, `onedream_ad_silver`, `onedream_ad_gold`. All active.
- **Listing boosts (7):** `onedream_boost_quick`, `onedream_boost_seller`, `onedream_boost_power`, `onedream_boost_pro`, `onedream_boost_prime`, `onedream_boost_star`, `onedream_boost_elite`. All active.
- **Card only, no Play product:** Premier Boost ($1,500) and Ultimate Boost ($4,000). Google Play won't accept a one-time product above $400. Don't point users from the app to the website to buy them: Play policy forbids steering users away from Play Billing for in-app digital goods.

**Price check:** every ad and boost was saved in Play Console at **.99 below** the database price (e.g. $9.99 vs $10, $399.99 vs $400). Purchases still work, since the server doesn't grant by price, but **Check Google Play** will warn. Either edit each Play US price to the whole dollar, or change the database prices to .99 in Admin portal → Ads → Packages (that also changes the website card price).

---

## 5. Safety rules built in

- **A product ID with no Play product can't be bought.** Google has nothing to sell, and the server only grants after Google confirms a real, paid purchase.
- **Refunds and chargebacks** are pulled daily from Google (and from Paystack for website payments): the ad campaign ends, the digital licence is revoked, or the subscription ends, and the seller's earning is reversed.
- **A subscription Google can't attach to a creator plan is never acknowledged,** so Google refunds it automatically within 3 days (same as one-time digital purchases).
- **Real-time notifications:** Google sends subscription notifications to the AI subscription's existing endpoint, which ignores products that aren't AI plans. Creator subscriptions don't depend on them: they're refreshed when the subscriber opens the Library and by the daily job.
- **Website:** ads, boosts, digital items and creator subscriptions can all be bought by card (Paystack, charged in NGN at the live rate) on the website and web app, with no Play Console setup. Website subscriptions renew by charging the saved card monthly, from the daily billing job.
- **Emergency stops** (Vercel env, off by default): `PROMOTIONAL_BILLING_PAUSED=true` for ads and boosts, `DIGITAL_SALES_PAUSED=true` for digital products.
- **Daily jobs** (`vercel.json`) need **`CRON_SECRET`** set in Vercel: 03:15 UTC ad refunds; 03:30 UTC digital refunds; 03:40 UTC digital billing (website payments, refunds, website subscription renewals, Google subscription refresh); 03:45 UTC ad link re-check.
