# One Dream: next steps

_Last updated 2026-10-18. Branch: `web-app-apk-parity-ad-tiers`, pushed. Latest commit `e793b82` (house ads), deployed to production. Android **1.0.21 (versionCode 23)**._

Everything below is built and deployed. Part 1 is the setup still to do. Part 2 is Google Play work. Part 3 is the full test checklist, one section per feature. If anything doesn't match, paste what you see.

## Where things stand

| Area | Status |
|---|---|
| Website, API, web app (`/app`) | **Live**, commit `e793b82` |
| Android app | **1.0.21 (versionCode 23)** installed on your phone by adb. AAB ready for Play internal testing |
| Google Play products | **58 live:** 2 AI subscriptions, 7 ad packages, 7 boosts, 17 digital price tiers, 18 creator subscriptions, 7 Dream Coin packs |
| Dream Coins | **On sale** (`DREAM_COINS_ENABLED=true`). No purchase made yet. Multi-quantity not switched on yet |
| Earnings, affiliate marketplace, gift sharing | Database applied. Every money switch **off** |
| Multi-currency listings | Code live; database applied (migration, review fixes, P8, P9); rates refresh daily. Switch **off** |
| Storefront video promotion | **Live**: terms v2, $10 per selected video, $1,000 cap, 3 funded videos per seller |
| Agriculture & Farming department | **Live**: 15 categories, about 95 search words |
| House ads (admin-uploaded One Dream ads) | **Live**: tables created; upload your first ad (test I) |
| Protected changes P3, P4, P5, P6 | Prepared, not applied (`docs/protected-patches/README.md`). P1 isn't needed: P8 includes it |

### SQL status (checked in production on 18 Oct 2026)

Every SQL file has been run, except these two:

| File | Status | Action |
|---|---|---|
| `supabase/fix_p8_p9_review.sql` | **Can't be confirmed from here** (it only replaces function bodies) | Run it once now. It's safe to run again: 6 rows, all `ok = true` |
| `docs/protected-patches/P7_multicurrency_checkout.sql` | Not run, **on purpose** | Run only when you switch multi-currency on (test G) |

Confirmed applied: the multi-currency migration and its review fixes, P8, P9, storefront promotion and its review fixes (terms v2 current), agriculture categories, house ads, and every earlier migration.

---

## Part 1: setup still to do (you)

1. **Supabase SQL editor:** run `supabase/fix_p8_p9_review.sql` (above).
2. **Dream Coins multi-quantity** (it was blocked from running here), from the repo folder:
   ```
   node scripts/enable-dream-coin-multi-quantity.mjs --dry-run
   node scripts/enable-dream-coin-multi-quantity.mjs
   ```
   - **Expect:** `UPDATED ... multi-quantity on` for each of the 7 packs.
   - **Undo:** `--disable`.
3. **Upload your first house ad:** admin portal → **🏠 House ads** (test I).
4. **Multi-currency go-live:** when you're ready, run test G in one sitting.
5. **Vercel env check:**
   - `CRON_SECRET` must be set, or the daily jobs (refund syncs, rate refresh, matching jobs) don't run.
   - `PAYOUTS_PROVIDER_LIVE` stays unset until you have a payout provider.

## Part 2: Google Play work (you, Play Console)

1. **Upload the AAB to internal testing:**
   - the file is `mobile/android/app/build/outputs/bundle/release/app-release.aab` (1.0.21, versionCode 23);
   - **Testing → Internal testing → Create new release** → upload → roll out.
2. **License testers:** **Setup → License testing**, add your Google account and every tester's. Their test purchases aren't charged.
3. **Install from Play:** on the phone, open the internal testing opt-in link and install from Play.
   - The copy installed by adb can't make Play purchases.
   - If the adb copy blocks the install, uninstall it first. Its data is on the server, so nothing is lost.
4. **Closed testing and production access** (new personal developer accounts): you need at least **12 testers opted in for 14 days in a row** on a closed test. After that, **apply for production access** in the Dashboard. Being a tester yourself doesn't publish the app; each new version reaches testers only when you upload its AAB to that track.
5. **Ad and boost prices:** all 14 were saved in Play at .99 below the database price (e.g. $9.99 vs $10). Either change each Play US price to the whole dollar, or set the database prices to .99 in Admin → Ads → Packages. Then **Check Google Play** shows no warnings.
6. **Service account permissions:** **Users and permissions** → the service account →
   - remove **Manage store presence** (only needed while creating products);
   - keep **Manage orders and subscriptions**, **View app information** and **View financial data**.
7. **Real-time notifications:** **Monetisation setup → Real-time developer notifications** must point to the existing AI subscription Pub/Sub topic. It already does; just check it.
8. **Policy before production:**
   - **Paid voting ("Buy Votes")** is the main Google Play policy risk. Decide whether to remove it from the Android app before applying for production (`docs/DREAM_COINS_POLICY_READINESS.md`).
   - **Data safety form:** declare payment info (Paystack and USDT are handled outside Play), contact details (phone, WhatsApp, address for delivery), and photos and videos (listings and promotion videos).
   - **Content rating** questionnaire, **target audience** (18+ for selling and withdrawals), and a privacy policy URL.
   - **Gift earnings:** before switching it on, check Google Play's rules on paying users from in-app purchases (step 3 of Part 3B).

---

## Part 3: test checklist

Run these on the app installed from internal testing, with a license-tester account, unless a test says otherwise.

### A. Google Play purchases (every product type)

1. **Dream Coins, one pack:** Profile → **Dream Coins & gifts** → buy 100 coins.
   - **Expect:** +100.
   - **Admin → 🎁 Gifts & Rewards:** quantity 1, 100 coins, "consumed".
2. **Dream Coins, several packs** (after Part 1 step 2): buy 3 × 600 in one purchase. **Expect:** exactly 1,800 coins, and quantity 3 in the admin.
3. **Retry safety:** close the app mid-purchase and reopen Dream Coins. **Expect:** credited once.
4. **Advertising package:** Promote → buy **Starter Ads** with Google Play.
   - **Expect:** the package appears as available.
   - Create a campaign. **Expect:** it goes to review.
5. **Listing boost:** a listing → **Boost** → **Quick Boost** with Google Play. **Expect:** the listing shows in boosted slots for the boost's duration.
6. **Digital product:** as a seller, list an e-book at $0.99; as a buyer, buy it. **Expect:** it opens in **Library**, and the seller's earnings show the sale.
7. **Creator subscription:** subscribe to a creator at $1.99. **Expect:** all their included digital products unlock. Subscribe to a second creator at $1.99. **Expect:** it uses another slot (s2) and works.
8. **AI subscription:** Bascardo AI → subscribe to Pro ($9). **Expect:** Pro features unlock.
9. **Refunds:**
   - Play Console → Order management → refund the coin pack, the boost and the e-book.
   - Admin → **Sync Play refunds** in Gifts & Rewards, Ads and Digital (or wait for the daily job).
   - **Expect:** coins taken back (a negative balance blocks gifting), the boost ends, the e-book licence is revoked, and the seller's earning is reversed.
10. **Admin → Check Google Play** in the Ads and Digital tabs. **Expect:** every product shows *Purchasable*, with no price warnings after Part 2 step 5.

### B. Dream Coins gifts and earnings

1. **Send a gift:** another user's profile → **Appreciation & gifts → Send a gift**. **Expect:** the balance goes down and the gift shows on their page.
2. **Thank-you after an order:** buy a cheap listing, tap **Received**, then **Send a thank-you gift**. **Expect:** "verified purchase".
3. **Gift earnings** (only once switched on in **🤝 Partners & Payouts**):
   - **Gift to a user registered through a merchant link:** the recipient's Earnings shows about 50%, and the merchant's 💰 Earnings about 10%.
   - **Gift to a user with no merchant:** no merchant share.
   - **Monthly report:** import the Play **Earnings** CSV under **Google Play settlement**. **Expect:** estimates become settled amounts.
   - **Google payout received:** mark it. **Expect:** gift earnings become **Withdrawable**.

### C. Marketplace core (card and USDT)

1. **New listing:** My Listings → New listing, with photos, a price and a video. **Expect:** it appears in Shop and search, and on your storefront `/app/catalogue/<username>`.
2. **Single purchase by card (Paystack test mode):** buy a USD listing. **Expect:**
   - the charge is the listing's naira equivalent;
   - an order with status "Paid – awaiting delivery";
   - the seller sees it in My Orders.
3. **Cart:** add listings from two sellers and pay once. **Expect:** one payment, one order per seller, and the service charge shown separately.
4. **USDT:** pay a cart with USDT (BSC or Tron), submit the hash, and submit it again while it confirms. **Expect:** one order, never two.
5. **Escrow:** as the buyer, tap **Received**. **Expect:** the seller's Wallet → Marketplace moves the sale from "awaiting confirmation" to withdrawable, less 5% commission.
6. **Dispute:** raise one on another order. **Expect:** the amount shows "on hold"; admin → Orders can resolve it.
7. **Seller withdrawal:** request a USD withdrawal. **Expect:** it's reserved at once, appears in Admin → Withdrawals, and is marked paid by admin.
8. **Order chat:** Message the Seller from an order. **Expect:** both sides see the messages.
9. **Unreturned payments:** Admin → 🤝 Partners & Payouts → **Check unreturned payments**. **Expect:** "every one has its order".

### D. Agriculture & Farming

1. App → Shop. **Expect:** an **Agriculture & Farming** department with 16 categories, including Agricultural Equipment.
2. Search "cassava", "fingerlings", "NPK" and "tractor hire". **Expect:** the matching agricultural category comes up for each.
3. New listing in **Livestock**. **Expect:** product only. New listing in **Veterinary Services**. **Expect:** service only.
4. Search "tomatoes". **Expect:** both Farm Fruits & Vegetables (farmers) and Farm Produce (Food & Grocery) can be found.

### E. Affiliate marketplace

1. **Seller:** Profile → **Partner programme → Sell through partners**. Open a listing at 10%, read "You receive", tick and save.
2. **Partner** (second account): join, then **Find listings to promote → Promote with links**. Create a link, add a creative and add the listing to a collection.
3. **Admin:** **Creatives awaiting review** → Approve.
4. **Buyer** (third device): open the `/r/<code>` link and buy by card.
5. **Admin → Run matching jobs.** **Expect:** an attribution for the order. One Dream-funded offers show "pending"; seller-funded ones show "awaiting seller settlement".
6. **Confirm delivery** as the buyer and run the jobs again. **Expect:** a One Dream-funded commission becomes Withdrawable.
7. **Storefront:** open `/m/<handle>`. **Expect:** approved creatives, and never the seller's minimum resale price.
8. **Self-purchase:** the partner buys through their own link. **Expect:** "Not eligible".
9. **Creative engagement:** the seller hires, the partner delivers, and the seller completes it.

### F. Partner payouts (only once the payout switch is on)

1. Earnings → **Payout details** → save. **Expect:** "submitted".
2. Admin verifies the payee.
3. Request at least the minimum. **Expect:** **In withdrawal**.
4. Admin **Approve** → **Mark paid** with a reference. **Expect:** **Paid**.
5. Repeat with **Failed**. **Expect:** the money returns to Withdrawable.

### G. Multi-currency listings (go-live, one sitting)

Details: `docs/MULTICURRENCY_IMPLEMENTATION.md`.

1. **Before switching on:**
   - Admin → **💱 Currencies**. **Expect:** NGN, GBP, EUR and GHS rates under 26 hours old (press **Refresh rates now** if not), and the switch "off (USD only)".
   - App → New listing. **Expect:** only the USD chip can be chosen.
2. **Switch on:** run `docs/protected-patches/P7_multicurrency_checkout.sql`, then **💱 Currencies → Let sellers list in naira and other currencies** (type `P7_P8_APPLIED`).
3. **Test the checkout:**
   - **Naira listing:** list at ₦18,000 and buy it with Paystack. **Expect:** exactly ₦18,000 plus the service charge, and a frozen snapshot in the Currencies tab.
   - **Pound listing:** list at £100 and pay in USDT. **Expect:** the USD amount, the GBP rate and its date, and "price held until…".
   - **Mixed cart:** one naira and one GBP listing. **Expect:** "paid separately", and no payment button.
   - **Listing page:** a non-USD listing's page. **Expect:** "Add to cart and check out".
   - **Expired quote:** leave the cart past the quote's time. **Expect:** a new quote before paying; an expired one is never charged.
   - **Repeat submission:** submit a USDT hash twice while it confirms. **Expect:** same price, one order.
4. **Naira earnings:** confirm delivery of the ₦18,000 order, then open Wallet → Marketplace.
   - **Expect:** "Naira earnings" with ₦17,100 withdrawable, and the dollar balance unchanged.
   - **Withdraw ₦10,000.** **Expect:** ₦7,100 left, and Admin → Withdrawals shows "PAY ₦10,000.00 (≈ $…)".
   - **Try ₦20,000.** **Expect:** "Amount exceeds your withdrawable marketplace earnings".
5. **If something fails:**
   - **USDT route:** Disable GBP, EUR and GHS in 💱 Currencies; naira keeps working.
   - **Naira route:** switch off, and move naira listings back to USD.
   - Nothing already paid is lost.

**Rounding:** the naira amount of a withdrawal is exact and is what's paid. The dollar figure beside it is for reports only, rounded to the cent with a $0.01 floor.

### H. Storefront video promotion

1. Open `https://www.flymaddcreative.online/storefront-promotion.html`. **Expect:** terms **version 2**, "…for a chance to be featured…", $10 per selected video, $1,000 budget.
2. App → My Listings → **Get featured in One Dream's social media ads** with fewer than 10 active listings. **Expect:** "N of 10 active listings", and no submit form.
3. **With 10 active listings and 2 videos:**
   - with the consent box unticked, the button is disabled;
   - tick it and submit. **Expect:** "Submitted · under review";
   - submit the second video. **Expect:** both listed.
4. Admin → **📣 Video promotion**: **Select** one, mark the other **Not selected** with a note. **Expect:** the app shows each status and the note.
5. **Spend on the selected video:**
   - $6 TikTok, then $5. **Expect:** "exceed the US$10 limit". Then $4. **Expect:** accepted. The app shows "Promoted on tiktok", without the amount.
   - Spend on the not-selected video. **Expect:** "Only selected videos…".
   - −2 with no note. **Expect:** "A correction needs a note". With a note, it's accepted.
6. **Limits:** select a 4th video from one seller. **Expect:** "…maximum number of funded videos this round". The summary shows committed, spent and uncommitted budget.
7. **Withdraw consent** in the app. **Expect:** "Consent withdrawn" in both the app and admin, and no Record spend box.

### I. House ads

1. Admin → **🏠 House ads**:
   - upload an image;
   - title "Get the One Dream app";
   - link `https://play.google.com/store/apps/details?id=com.flymaddcreative.onedream`;
   - all placements, **Fill**.
   **Expect:** "Published", with a preview.
2. App home (pull to refresh). **Expect:** the ad shows in the sponsored slot, and tapping it asks to open the link. A live paid ad takes the slot first (that's Fill).
3. Upload a short video. **Expect:** it plays in the ad card.
4. **Counts:** after viewing and tapping, the admin counts go up (once per device per hour).
5. **Pause:** pause one. **Expect:** it disappears within a minute. An `http://` link is refused.

### J. Advertising (paid campaigns)

1. Admin → Ads → **Grant a package** (Starter Ads) to a test user.
2. As that user, **Promote** → create a campaign with an image and a link. **Expect:** "pending review".
3. **Admin approves** it. **Expect:** it shows on another device in its placement.
4. **View analytics:** impressions, clicks, placements and days left.
5. **Bad link:** a broken link is flagged by the daily link check (or **Recheck links**).

### K. Website and merchants

1. **Website pages:** `Onedream.html`, the catalogue pages, `storefront-promotion.html` and `/app` all load.
2. **"How It Works", step 4:** shows the new promotion wording, with no "$10/month package".
3. **Merchant:** register a merchant, share the referral link, register a user through it. **Expect:** the merchant sees the referral, and later the gift share (when on).
4. **Votes on the website** (card or USDT): a vote purchase completes and the participant's balance updates.

---

## Planned development

- **Premium advertising positions:** featured slots for Bronze, Silver and Gold.
- **Ads on public website pages:** decide which pages and positions; house ads can use them too.
- **House ads label:** an app update could show "From One Dream" instead of "Sponsored".
- **Protected changes P3 to P6:** apply each one as you approve it.
- **Later / optional:**
  - per-viewer ad frequency cap;
  - more creator subscription slots;
  - automatic social posting for promotion videos;
  - authenticated delivery for partner creatives.

## Known issues

- **`__tests__/lib/onedreamHelpers.test.js` doesn't run.** It's written for Jest; rewrite it for `node --test`.
- **A `getReferralLink` import warning** in `pages/api/register-participant.js` shows on every build. It's harmless.
- **The branch is pushed but not merged:** open a PR to `main` when you're ready.

## Reference

- Google Play products: `docs/GOOGLE_PLAY_PRODUCTS.md`. Scripts: `scripts/create-google-play-products.mjs`, `scripts/create-dream-coin-products.mjs`, `scripts/enable-dream-coin-multi-quantity.mjs`
- Dream Coins: `docs/DREAM_COINS_IMPLEMENTATION_REPORT.md`, `docs/DREAM_COINS_POLICY_READINESS.md`
- Earnings and affiliate: `docs/EARNINGS_AND_AFFILIATE_IMPLEMENTATION.md`, `docs/MERCHANT_AFFILIATE_FRAMEWORK.md`, `docs/DREAM_COINS_GIFT_REVENUE_SHARING.md`
- Multi-currency: `docs/MULTICURRENCY_IMPLEMENTATION.md`
- Storefront video promotion: `docs/STOREFRONT_PROMO_REVIEW.md`
- House ads: `docs/HOUSE_ADS.md`
- Protected changes: `docs/protected-patches/README.md`
- Tests: `npm run test:earnings` (80 tests)
