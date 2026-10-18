# One Dream: next steps

_Last updated 2026-10-17. Branch: `web-app-apk-parity-ad-tiers`. Latest: multi-currency listings + release 1.0.19 (see `git log`). Not pushed._

Testing is deferred to the review round. Everything below is built and deployed; the checklist at the end is what to test during review.

## Where things stand

| Area                                         | Status                                                                                                                                                                                                                |
| -------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Google Play products                         | **All 58 live:** 2 AI subscriptions, 7 ad packages, 7 boosts, 17 digital price tiers, 18 creator subscriptions, and **7 Dream Coin packs** (activated 2026-10-17)                                                     |
| Dream Coins                                  | **On sale:** `DREAM_COINS_ENABLED=true` in Vercel production. No purchase has been made yet                                                                                                                           |
| Buying several coin packs at once            | **Ready to switch on.** Run `node scripts/enable-dream-coin-multi-quantity.mjs` yourself; it was blocked from running here (see step 1)                                                                               |
| Earnings and affiliate database              | **Applied in production** (all three migrations; tables and functions checked). Every money switch is **off**: gift earnings, payouts, seller-funded commission, reseller checkout                                    |
| Partner programme and Earnings screens       | **Live** on the website and web app (`/app`), and in Android 1.0.18                                                                                                                                                   |
| Multi-currency listings | **Code live** (commits `e16f520`, `1932d63`, `77398c2`, deployed); **switch OFF**. Database: migration, review fixes, P8 and P9 applied; rates stored. **Next: run `supabase/fix_p8_p9_review.sql`, then P7 SQL + switch on + test G** (step 0) |
| Android app                                  | **1.0.21 (versionCode 23)**: multi-currency cart quote, naira wallet, external video promotion (terms v2). APK installed by adb; AAB at `mobile/android/app/build/outputs/bundle/release/app-release.aab`                                                  |
| Protected payment changes P1, P3, P4, P5, P6 | **Prepared, not applied.** See `docs/protected-patches/README.md`. P8 replaces P1 (don't apply P1 separately)                                                                                                         |
| Premier ($1,500) and Ultimate ($4,000) Boost | Card-only by design: Google Play caps one-time products at $400                                                                                                                                                       |

## Next steps, in order

### 0. Multi-currency: finish the setup and go live (you)

**Already done in production** (18 Oct 2026):
- `supabase/add_multicurrency_listings.sql` and `supabase/fix_multicurrency_review.sql` (11/11 checks ok);
- `docs/protected-patches/P8_usd_seller_wallet.sql` and `P9_naira_seller_wallet.sql`;
- the code: commits `e16f520`, `1932d63`, `77398c2`, all deployed;
- exchange rates for NGN, GBP, EUR and GHS (provider publish time 17 Oct, 00:02 UTC).

**1. Run `supabase/fix_p8_p9_review.sql`** in the Supabase SQL editor. Paste it whole and run it once; all 6 check rows must say `ok = true`. It replaces three functions and changes no data:
- a naira withdrawal is refused when no recent NGN rate exists, instead of being recorded at a made-up $0.01;
- the seller-funded affiliate deduction in both wallets is a sum, so it can't fail on several rows or apply twice.

**2. Check the rates are current:** admin portal → **💱 Currencies**. The summary line shows each rate and its publish time. Quotes and naira withdrawals refuse rates older than 26 hours; the automatic refresh at 00:30 UTC every day keeps them under that. If a rate is old, press **Refresh rates now**.

**3. Run `docs/protected-patches/P7_multicurrency_checkout.sql`**, then switch on **💱 Currencies → Let sellers list in naira and other currencies** (type `P7_P8_APPLIED` when asked). The SQL makes every non-naira listing USDT-only, including the 2 existing USD listings, and naira listings Paystack-only.

**4. Run test G** (below). Keep it on if it passes. If one payment route fails, see "If something fails" in test G.

**Rounding policy for naira withdrawals:** the naira amount (`amount_ngn`) is what the seller is owed and what the admin pays; it's exact. The dollar figure next to it (`amount_usd`) is only for totals and admin alerts: the naira amount at the latest rate, rounded to the cent, never below $0.01 (so ₦5 shows as $0.01, not $0.00). It never affects any balance.

### 0b. Storefront video promotion (you, Supabase SQL editor)

Done: `supabase/add_storefront_promotion.sql` (18 Oct).

**Run now:** `supabase/fix_storefront_promotion_review.sql` once; every check row must say `ok = true`. It makes the terms immutable, publishes terms **version 2** (clearer wording, at most 3 funded videos per seller per round), reserves $10 of budget when a video is selected, and makes spend records append-only (mistakes are fixed with a negative correction that needs a note). Programme: `docs/STOREFRONT_PROMO_REVIEW.md`.

### 0c. Agriculture & Farming department (you, Supabase SQL editor)

Run `supabase/add_agriculture_categories.sql` once; every check row must say `ok = true`. It adds a new **Agriculture & Farming** department with 15 categories (crops and grains, tubers, farm fruits and vegetables, cash crops, livestock, poultry and eggs, fish farming, seeds, fertilisers and agrochemicals, animal feed, farm tools, tractor hire, veterinary services, agronomy consulting, agro-processing and storage), moves **Agricultural Equipment** into it, and adds about 95 search words (maize, cassava, goats, catfish, NPK, tractor hire…). Farm Produce and Meat & Seafood stay under Food & Grocery for shoppers. No listings or payments change.

**Check:** app → Shop → the new department appears; search "cassava" or "fingerlings" and the matching category comes up; My Listings → New listing → pick Livestock (product) or Veterinary Services (service).

### 0d. House ads: create the tables (you, Supabase SQL editor)

Run `supabase/add_house_ads.sql` once; every check row must say `ok = true`. Then admin portal → **🏠 House ads** → upload an image or video, add a link (for example your Play Store link) and publish. It appears in the app's ad slots (home, shop, search, category) with no package or subscription. See `docs/HOUSE_ADS.md`. Until the SQL runs, ads keep working exactly as before.

### 1. Switch on buying several coin packs at once (you)

This was blocked from running here, so run it yourself from the repo folder:

```
node scripts/enable-dream-coin-multi-quantity.mjs --dry-run
node scripts/enable-dream-coin-multi-quantity.mjs
```

Each product should print `UPDATED ... multi-quantity on`. To turn it off again: `node scripts/enable-dream-coin-multi-quantity.mjs --disable`. The backend already credits Google's verified quantity × coins per pack.

### 2. Upload the AAB to internal testing (you)

1. The file is `mobile/android/app/build/outputs/bundle/release/app-release.aab` (1.0.21, versionCode 23).
2. Play Console → **Testing → Internal testing → Create new release**. Upload it and roll out.
3. Play Console → **Setup → License testing**: add your test Google account.
4. On the phone, install the app from the internal testing link. Play purchases don't work in a copy installed by adb.

### 3. Tidy up Play Console permissions (you)

Play Console → **Users and permissions**: untick **Manage store presence** on the service account. It was only needed to create and change products.

### 4. Decide on the money switches (owner)

Turn these on only when you're ready. Each is a switch in the admin portal under **🤝 Partners & Payouts**:

| Switch                       | What it needs first                                                                      |
| ---------------------------- | ---------------------------------------------------------------------------------------- |
| Gift earnings (50 / 40 / 10) | A Google Play policy check for creator earnings, legal review, and updated Terms         |
| Payouts                      | A payout provider, an identity-check process, and `PAYOUTS_PROVIDER_LIVE=true` in Vercel |
| Seller-funded commission     | Approve and apply P1                                                                     |
| Reseller checkout            | Approve and apply P3                                                                     |

The "Buy Votes" flow in the app is still the main Google Play policy risk (`docs/DREAM_COINS_POLICY_READINESS.md`).

---

## Review testing checklist

Run these during review, on the app installed from internal testing (step 2) with a license-tester account. Test purchases aren't charged. If anything doesn't match, paste what you see.

### A. Dream Coins

1. **One pack:** Profile → **Dream Coins & gifts**, buy the 100-coin pack.
   - **Expect:** the balance goes up by 100.
   - **Check:** admin portal → **🎁 Gifts & Rewards** shows the purchase, quantity 1, 100 coins, consumption "consumed".
2. **Several packs** (after step 1): buy 3 × the 600-coin pack in one purchase, choosing 3 in Google's sheet.
   - **Expect:** exactly 1,800 coins added, not 600 and not 5,400.
   - **Check:** the admin shows quantity 3.
3. **Send a gift:** open another user's profile → **Appreciation & gifts → Send a gift**.
   - **Expect:** the balance goes down by the gift's cost, and the gift appears on the recipient's appreciation page.
4. **Thank-you after an order:** buy a cheap listing, tap **Received**, then **Send a thank-you gift**.
   - **Expect:** the gift shows as "verified purchase".
5. **Refund:** refund purchase A1 in Play Console (Order management), then admin → Gifts & Rewards → **Sync Play refunds**.
   - **Expect:** 100 coins are taken back. If they were already spent, the balance goes negative and gifting is blocked until it recovers.
6. **Retry safety:** close the app during a purchase, then reopen Dream Coins.
   - **Expect:** the purchase is credited once, not twice.

### B. Gift earnings (only once the switch is on)

1. Admin → **🤝 Partners & Payouts**: turn on **Gift earnings**.
2. Send a gift to a user who registered through a merchant's referral link.
   - **Expect:** the recipient's **Earnings** shows an estimated 50% share, and the merchant's earnings (Merchant → **💰 Earnings**) show 10%.
3. Send a gift to a user with no referring merchant.
   - **Expect:** no merchant share.
4. **Monthly report:** Play Console → Download reports → Financial → **Earnings** (USD CSV). Import it in the admin portal under **Google Play settlement**.
   - **Expect:** the lots show their settled value, and the estimates change to confirmed amounts.
5. Click **Google payout received** on that month.
   - **Expect:** those gift earnings move to **Withdrawable**.

### C. Affiliate marketplace

1. **Seller:** Profile → **Partner programme → Sell through partners**. Open one listing to partners at 10%. Read the "You receive" line, tick the agreement and save.
2. **Partner** (a second account): Profile → **Partner programme**. Join, then **Find listings to promote** → **Promote with links**. In **My storefront**, create a link, add a photo or description, and add the listing to a collection.
3. **Admin:** **🤝 Partners & Payouts → Creatives awaiting review** → Approve.
4. **Buyer** (a third device or browser): open the partner's `/r/<code>` link and buy the listing by card (Paystack test mode).
5. Admin → **Run matching jobs**.
   - **Expect:** an attribution for that order. Seller-funded offers show "awaiting seller settlement" until P1 is applied. One Dream-funded promotions show "pending".
6. Confirm delivery as the buyer and run the matching jobs again.
   - **Expect:** a One Dream-funded commission becomes **Withdrawable** in the partner's Earnings.
7. **Storefront:** open `https://www.flymaddcreative.online/m/<handle>`.
   - **Expect:** approved creatives, "Sold by" / "Ships from", and never the seller's minimum resale price.
8. **Self-purchase:** the partner buys through their own link.
   - **Expect:** the attribution is "Not eligible" (partner is buyer).
9. **Creative engagement:** **Partner programme → Creative engagements**. The seller hires the partner, the partner marks the work delivered, and the seller completes it.

### D. Payouts (only once the payout switch is on)

1. **Earnings → Payout details**: save them.
   - **Expect:** status "submitted".
2. Admin verifies the payee.
3. Request a withdrawal of at least the minimum.
   - **Expect:** the amount moves to **In withdrawal**.
4. Admin: **Approve**, then **Mark paid** with a transfer reference.
   - **Expect:** the amount shows as **Paid**.
5. Repeat, but **Failed**.
   - **Expect:** the money returns to **Withdrawable**.

### E. Earlier items still to test

1. **Advertising analytics:**
   - Admin → Ads → **Grant a package** (Starter Ads), and create a campaign in **Promote**.
   - Approve it, then view the ad from another device.
   - **Expect:** **View analytics** shows impressions, clicks, placements and days left.
2. **A real Google Play purchase of an existing product:** a $0.99 digital item or the $3 Quick Boost.
   - **Expect:** it's granted.
   - Refund it, then **Sync Play refunds**: it's removed.

### F. Unreturned payments

Admin → **🤝 Partners & Payouts → Check unreturned payments**.

**Expect:** "every one has its order". Any listed payment is a buyer who paid and never got an order. Contact them, or approve P6 so carts complete automatically.

### H. Storefront video promotion (after step 0b)

1. Open `https://www.flymaddcreative.online/storefront-promotion.html`. **Expect:** the full terms, **version 2**, starting "…for a chance to be featured…", and "up to US$10 … per selected video · US$1,000 programme budget".
2. App → **My Listings → Get featured in One Dream's social media ads** with fewer than 10 active listings. **Expect:** "N of 10 active listings", and no submit form.
3. With 10 active listings and videos on 2 of them: choose one video, leave the consent box unticked. **Expect:** the submit button stays disabled. Tick it and submit. **Expect:** "Submitted · under review". Submit the second video too. **Expect:** both listed.
4. Admin → **📣 Video promotion**. **Expect:** both videos, with seller, consent date and terms version. **Select** one; mark the other **Not selected** with a note. **Expect:** the app shows each status and the note.
5. Record spend on the selected video: TikTok, $6, a post URL. Then $5 more. **Expect:** "That would exceed the US$10 limit for this video". Then $4. **Expect:** accepted (total $10). The app shows "Promoted on tiktok" with the date, and no amount.
6. Try recording spend on the not-selected video. **Expect:** "Only selected videos can have advertising spend recorded".
   - Record **-2** on the selected video with no note. **Expect:** "A correction needs a note explaining it". With a note, it's accepted and shown with the note; the video's total is now $8.
   - Select a 4th video from the same seller (after 3 are selected). **Expect:** "This seller already has the maximum number of funded videos this round".
   - The summary line shows the budget: committed (each selected video reserves $10), spent and uncommitted.
7. In the app, **Withdraw consent** on the selected video. **Expect:** "Consent withdrawn" in both the app and the admin, and no **Record spend** box any more. Submitting the same video again creates a new, fresh consent record.

### I. House ads (after step 0d)

1. Admin → **🏠 House ads**: upload an image, title "Get the One Dream app", link `https://play.google.com/store/apps/details?id=com.flymaddcreative.onedream`, all placements, **Fill**. **Expect:** "Published", and it appears in the list with a preview.
2. Open the app's home screen (pull to refresh, or wait a minute). **Expect:** the ad shows where sponsored ads appear; tapping it asks to open the link. If a paid ad is live in that slot, the paid one shows instead (that's **Fill** working).
3. Upload a short video the same way. **Expect:** it plays in the ad card.
4. Back in the admin list after viewing and tapping. **Expect:** impressions and clicks go up (once per device per hour).
5. **Pause** one. **Expect:** it stops showing in the app within a minute. Try a link starting `http://`. **Expect:** "Links must start with https://".

### G. Multi-currency listings (after step 0)

Full detail: `docs/MULTICURRENCY_IMPLEMENTATION.md`. Steps 1-2 work now; steps 3-4 need the switch on (step 0.3). Keep it on if they pass.

1. Admin → **💱 Currencies → Refresh rates now**. **Expect:** NGN, GBP, EUR and GHS rates with today's publish date. The switch shows "off (USD only)".
2. App → My Listings → new listing. **Expect:** the USD chip is selectable, the other currencies are greyed out with "opens soon", and saving a USD listing works as before.
3. Run `docs/protected-patches/P7_multicurrency_checkout.sql`, then switch listing currencies on:
   - list an item at ₦18,000, then buy it with Paystack. **Expect:** exactly ₦18,000 plus the service charge, and a snapshot in the Currencies tab.
   - list an item at £100, then pay in USDT. **Expect:** the cart shows the USD amount, the GBP rate and its date, and "price held until …".
   - put one naira and one GBP listing in the cart. **Expect:** "paid separately", with no payment button.
   - open a non-USD listing's page. **Expect:** "Add to cart and check out" instead of the direct payment form.
   - leave the cart open past the quote's time. **Expect:** a new price quote appears before you pay; an expired quote is never charged.
   - pay a USDT cart and submit the hash while it's still confirming, then again a minute later. **Expect:** the same price both times and one order.
4. **Naira earnings (needs P9 SQL):** as the naira seller, confirm delivery of the ₦18,000 order as the buyer, then open **Wallet → Marketplace**.
   - **Expect:** "Naira earnings" with ₦17,100 withdrawable (₦18,000 less 5%), and the dollar balance unchanged.
   - Request a ₦10,000 withdrawal. **Expect:** ₦7,100 left. Admin → Withdrawals shows "PAY ₦10,000.00 (≈ $…)". Mark it paid as usual.
   - Try ₦20,000. **Expect:** "Amount exceeds your withdrawable marketplace earnings".
5. **If something fails**, turn off only what's broken:
   - **USDT route (GBP, EUR, GHS):** admin → 💱 Currencies → **Disable** each of those currencies. New quotes for them are refused; naira keeps working.
   - **Naira route (Paystack):** NGN can't be disabled on its own. Switch listing currencies off (below) and move the naira listings back to USD until it's fixed.
   - Paste what you saw; nothing already paid is lost, because every paid order keeps its frozen snapshot.
6. **Rollback drill (optional):** switch listing currencies off. **Expect:** sellers can only pick USD again. A listing already priced in another currency is never charged at its approximate dollar price: the server still requires a quote, and the app cart (which only fetches quotes while the switch is on) refuses to pay it. Move such listings back to USD, or switch on again.

---

## Planned development

- **Premium advertising positions:** featured slots for Bronze, Silver and Gold, still controlled by admin.
- **Ads on public website pages:** needs a decision on which pages and positions.
- **Protected changes P1, P3 to P6:** apply each one as you approve it (`docs/protected-patches/README.md`).
- **Later / optional:**
  - per-viewer ad frequency cap;
  - separating rotation weight from priority;
  - package value exceptions (`supabase/add_ad_package_value_exceptions.sql`);
  - more creator subscription slots;
  - authenticated delivery for partner creatives.

## Known issues

- **`__tests__/lib/onedreamHelpers.test.js` doesn't run.** It was written for Jest, which this project doesn't use. Rewrite it for `node --test`.
- **A `getReferralLink` import warning** in `pages/api/register-participant.js` shows on every build. It's harmless, but the import should be fixed.
- **The branch isn't pushed.** Push and open a PR to `main` when you're ready.

## Reference

- Dream Coins: `docs/DREAM_COINS_IMPLEMENTATION_REPORT.md`, `docs/DREAM_COINS_POLICY_READINESS.md`
- Affiliate marketplace and gift earnings: `docs/EARNINGS_AND_AFFILIATE_IMPLEMENTATION.md`, `docs/MERCHANT_AFFILIATE_FRAMEWORK.md`, `docs/DREAM_COINS_GIFT_REVENUE_SHARING.md`
- Protected changes: `docs/protected-patches/README.md`
- Multi-currency: `docs/MULTICURRENCY_IMPLEMENTATION.md`
- Google Play products: `docs/GOOGLE_PLAY_PRODUCTS.md`; scripts `scripts/create-google-play-products.mjs`, `scripts/create-dream-coin-products.mjs`, `scripts/enable-dream-coin-multi-quantity.mjs`
- Tests: `npm run test:earnings` (80 tests, including multi-currency, video promotion and house ads), `node --test __tests__/lib/*.test.mjs`
- Storefront video promotion (external social media ads, $10 per selected video, $1,000 cap): `docs/STOREFRONT_PROMO_REVIEW.md`
- Agriculture & Farming department: `supabase/add_agriculture_categories.sql`
- House ads (admin-uploaded One Dream ads): `docs/HOUSE_ADS.md`
