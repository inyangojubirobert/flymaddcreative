# One Dream: next steps

_Last updated 2026-10-19. Branch: `web-app-apk-parity-ad-tiers`. Android **1.0.24 (versionCode 26)**. Code below is committed; **you deploy it** (step 1)._

Everything below is built. Part 1 is what only you can do (deploy, SQL, switches). Part 2 is Google Play work. Part 3 is the full test checklist, one section per feature. If anything doesn't match, paste what you see.

## Where things stand

| Area | Status |
|---|---|
| Website, API, web app (`/app`) | Built and committed (19 Oct 2026); **waiting for your `vercel deploy --prod`**. Web app re-exported |
| Android app | **1.0.24 (versionCode 26)**: reseller add-to-cart, P5/P6 checkout data, "From One Dream" house-ad label, private partner creatives, ad frequency cap. AAB + APK built from `mobile/android` (Gradle cache now on `D:\Gradle` only) |
| Google Play products | **58 live:** 2 AI subscriptions, 7 ad packages, 7 boosts, 17 digital price tiers, 18 creator subscriptions, 7 Dream Coin packs. Ad and boost Play prices **match** the database (checked 19 Oct 2026) |
| Dream Coins | **On sale** (`DREAM_COINS_ENABLED=true`). Multi-quantity **on** for all 7 packs. No purchase made yet |
| Earnings, affiliate marketplace, gift sharing | Database applied. Switches **off** until Part 1 step 4 |
| Multi-currency listings | Code live; P8, P9 applied. P7 activation SQL in the bundle (step 2). Switch **off** until step 3 |
| Protected changes P3, P4, P5, P6 | **Rewritten on top of P7 and applied in code** (19 Oct 2026). Their SQL is in the bundle (step 2) |
| Storefront video promotion, Agriculture, Security & Rentals, House ads | **Live** |
| New (19 Oct 2026) | Bronze/Silver/Gold take the featured (first) ad slot; per-viewer frequency cap (6 hours a day per paid banner); ads on `Onedream.html`, `search.html`, `catalogue-product.html`, `blogs.html`; house ads labelled "From One Dream"; partner creatives private until approved; daily job completes paid carts whose buyer never returned |

### SQL status

Run **one file**: `supabase/activate_all_2026_10_19.sql` (step 2). It contains, in the required order, `fix_p8_p9_review.sql`, P6, P3, P4, P7 and an ads index, in one transaction, and ends with 16 checks that must all say `ok = true`. It is safe to run again. Tested on the in-memory database (`npm run test:earnings`, 81 tests).

Later, only after step 6 below: `supabase/add_creator_sub_slots_4_6.sql`.

---

## Part 1: what you do (owner, 19 Oct 2026)

Do these in order.

1. **Vercel**, from the repo folder:
   1. `vercel env add PAYOUTS_PROVIDER_LIVE production` → enter `true` (payouts are paid by hand from Admin → Partners & Payouts; this only opens requests);
   2. `vercel deploy --prod`.
   - `CRON_SECRET` is already set (checked 19 Oct 2026), so the daily jobs run, including the new **complete unreturned carts** job (03:50 UTC).
2. **Supabase SQL editor:** paste and run `supabase/activate_all_2026_10_19.sql`. Every row must say `ok = true`.
3. **Admin portal → 💱 Currencies:** switch on "Let sellers list in naira and other currencies", type `P7_P8_APPLIED`. Then run test G.
4. **Admin portal → 🤝 Partners & Payouts:** switch on **Gift earnings**, **Payouts**, **Seller-funded commission** and **Reseller checkout**. The last two now refuse with a message if their SQL is missing.
5. **Optional:** set a **platform monthly budget** in Partners & Payouts if One Dream should fund affiliate offers (it is $0).
6. **Optional, more creator subscription slots (3 → 6 per price):**
   1. give the Play service account **Manage store presence** for a moment;
   2. `node scripts/create-google-play-subscriptions.mjs` (creates the 18 new `_s4`–`_s6` subscriptions; existing ones are skipped);
   3. remove the permission again;
   4. run `supabase/add_creator_sub_slots_4_6.sql`. The app offers the new slots on its own; no app update needed.
7. **Upload your first house ad:** Admin → **🏠 House ads** (test I).

Changes on 19 Oct 2026:
- **P3 reseller checkout** works alongside multi-currency: reseller offers are US-dollar lines, so a cart mixing one with a naira/GBP/EUR/GHS listing shows "check out separately" and takes no payment. Buyers add a reseller's offer from the partner storefront (`/m/<handle>` → **Add to cart**).
- **P5:** the payment-intent routes record partner attribution themselves (the app sends its tokens).
- **P6:** buyer details are stored when the cart payment reference is created; the daily job (or **Complete unreturned carts** in Partners & Payouts) finishes paid carts whose buyer never came back.
- **P4:** partners can boost a listing they are an approved partner for.
- **Fixed:** `pages/api/register-participant.js` called a function that doesn't exist (`getReferralLink`) after creating the account, so that route returned an error; the old Jest test now runs under `node --test`.
- **Not doable from here:** automatic social posting of promotion videos needs TikTok/Meta business API credentials; send them when you want it built.

## Part 2: Google Play work (you, Play Console)

1. **Upload the AAB to internal testing:**
   - the file is `mobile/android/app/build/outputs/bundle/release/app-release.aab` (1.0.24, versionCode 26);
   - **Testing → Internal testing → Create new release** → upload → roll out.
2. **License testers:** **Setup → License testing**, add your Google account and every tester's. Their test purchases aren't charged.
3. **Install from Play:** on the phone, open the internal testing opt-in link and install from Play.
   - The copy installed by adb can't make Play purchases.
   - If the adb copy blocks the install, uninstall it first. Its data is on the server, so nothing is lost.
4. **Closed testing and production access** (new personal developer accounts): you need at least **12 testers opted in for 14 days in a row** on a closed test. After that, **apply for production access** in the Dashboard. Being a tester yourself doesn't publish the app; each new version reaches testers only when you upload its AAB to that track.
5. ~~Ad and boost prices~~ **Checked 19 Oct 2026:** all 14 Play US prices equal the database prices. Nothing to do.
6. **Service account permissions:** **Users and permissions** → the service account →
   - remove **Manage store presence** (only needed while creating products);
   - keep **Manage orders and subscriptions**, **View app information** and **View financial data**.
7. **Real-time notifications:** **Monetisation setup → Real-time developer notifications** must point to the existing AI subscription Pub/Sub topic. It already does; just check it.
8. **Policy before production:**
   - **Paid voting is retired** (19 October 2026): removed from Android 1.0.22, the web app and the website; vote APIs return 410.
   - **Data safety form:** declare payment info (Paystack and USDT are handled outside Play), contact details (phone, WhatsApp, address for delivery), and photos and videos (listings and promotion videos).
   - **Content rating** questionnaire, **target audience** (18+ for selling and withdrawals), and a privacy policy URL.
   - **Gift earnings:** coins are bought only through Play Billing and recipients are paid from One Dream's own revenue share, the same model Play allows for creator tipping apps. Keep it described that way in the store listing and Data safety form.

---

## Part 3: test checklist

Run these on the app installed from internal testing, with a license-tester account, unless a test says otherwise.

### A. Google Play purchases (every product type)

1. **Dream Coins, one pack:** Profile → **Dream Coins & gifts** → buy 100 coins.
   - **Expect:** +100.
   - **Admin → 🎁 Gifts & Rewards:** quantity 1, 100 coins, "consumed".
2. **Dream Coins, several packs:** buy 3 × 600 in one purchase. **Expect:** exactly 1,800 coins, and quantity 3 in the admin.
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
10. **Buyer never returns:** pay a cart by card, then close the app before it returns. Wait 30 minutes, then **Complete unreturned carts**. **Expect:** "completed 1", and the orders appear for buyer and seller.

### D. Agriculture & Farming

1. App → Shop. **Expect:** an **Agriculture & Farming** department with 16 categories, including Agricultural Equipment.
2. Search "cassava", "fingerlings", "NPK" and "tractor hire". **Expect:** the matching agricultural category comes up for each.
3. New listing in **Livestock**. **Expect:** product only. New listing in **Veterinary Services**. **Expect:** service only.
4. Search "tomatoes". **Expect:** both Farm Fruits & Vegetables (farmers) and Farm Produce (Food & Grocery) can be found.

### D2. Security & Tracking, Rentals & Hire

1. App → Shop. **Expect:** a **Security & Tracking** department (7 categories: guards, bodyguards, event security, training, equipment and alarms, vehicle and fleet tracking, phone and number tracking) and a **Rentals & Hire** department (9 categories: event and party, generator, sound and stage, camera and studio, furniture and appliances, wedding decor, costumes and outfits, tools, electronics).
2. Search "number tracking", "phone tracker", "bouncer", "canopy" and "generator hire". **Expect:** the matching new category comes first.
3. New listing in **Security Guards**. **Expect:** service only.
4. Phone & Number Tracking is for the seller's own or customers' own devices, consented family locators, stolen-phone recovery and business call tracking. Remove any listing that offers to locate someone else's phone or number.

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
10. **Private creatives:** before approval, the creative's image opens for the partner and in the admin list, but its plain `res.cloudinary.com/.../upload/...` link doesn't. After **Approve**, the storefront shows it.
11. **Reseller checkout** (Reseller checkout switch on): the seller allows resale with a floor; the partner sets a price above it and is approved. On `/m/<handle>`, **Add to cart** → the cart shows the partner's price and "Sold through <partner>"; pay by card. **Expect:** the order's seller net is the floor less commission and the partner is credited the margin less commission (Admin → Run matching jobs). Add a naira listing to the same cart. **Expect:** "Reseller offers are paid in US dollars…", and no payment.
12. **Partner boost:** the partner buys **Quick Boost** and boosts the listing they partner on. **Expect:** it's accepted and goes live.

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
6. **Label:** on 1.0.24 the badge reads **From One Dream** (paid ads still say Sponsored).
7. **Website:** open `Onedream.html` and `search.html`. **Expect:** the same ad card near the bottom.

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

Done 19 Oct 2026: premium (featured) ad slot for Bronze/Silver/Gold, ads on public website pages, "From One Dream" house-ad label, P3–P6, per-viewer ad frequency cap, creator slots 4–6 (script + SQL ready, Part 1 step 6), private partner creatives until approval.

- **Automatic social posting** of promotion videos: needs your TikTok / Meta business API credentials.

## Known issues

- **The branch is pushed but not merged:** open a PR to `main` when you're ready.

## Reference

- Google Play products: `docs/GOOGLE_PLAY_PRODUCTS.md`. Scripts: `scripts/create-google-play-products.mjs`, `scripts/create-dream-coin-products.mjs`, `scripts/enable-dream-coin-multi-quantity.mjs`
- Dream Coins: `docs/DREAM_COINS_IMPLEMENTATION_REPORT.md`, `docs/DREAM_COINS_POLICY_READINESS.md`
- Earnings and affiliate: `docs/EARNINGS_AND_AFFILIATE_IMPLEMENTATION.md`, `docs/MERCHANT_AFFILIATE_FRAMEWORK.md`, `docs/DREAM_COINS_GIFT_REVENUE_SHARING.md`
- Multi-currency: `docs/MULTICURRENCY_IMPLEMENTATION.md`
- Storefront video promotion: `docs/STOREFRONT_PROMO_REVIEW.md`
- House ads: `docs/HOUSE_ADS.md`
- Security & Tracking, Rentals & Hire departments: `supabase/add_security_rentals_categories.sql`
- Protected changes: `docs/protected-patches/README.md`
- Tests: `npm run test:earnings` (81 tests), `node --test __tests__/lib/*.test.mjs` (53 tests)
