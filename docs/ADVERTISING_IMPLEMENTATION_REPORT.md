# Advertising & listing boosts — implementation report (Stage 1)

**Date:** 2026-10-11 · **Superseded in part by** [`ADVERTISING_MIGRATION_READINESS.md`](ADVERTISING_MIGRATION_READINESS.md) (safety review) **and** [`ADVERTISING_BILLING_ACTIVATION.md`](ADVERTISING_BILLING_ACTIVATION.md): billing is now **on**, per package, with placeholder product IDs; there's no `PROMOTIONAL_BILLING_ENABLED` flag any more. · **Status:** built and tested in staging. **Not deployed, no production SQL run, no Play Console products created.** Awaiting approval.

---

## 1. Summary

One Dream now has a complete advertising and listing boost system. Real purchasing is **off** until you create the Google Play products and switch it on.

| Capability | State |
|---|---|
| 7 launch packages (4 ads, 3 boosts) in an admin-managed table | ✅ |
| Package cards in the app, with "Popular" highlights | ✅ |
| Advertiser media library: images and videos uploaded to Cloudinary through server-signed uploads, kept private until approved | ✅ |
| Campaign creation: headline, text, button, destination (website / listing / shop), creatives | ✅ |
| Listing boosts linked to the seller's own live listing | ✅ |
| Admin review queue with media previews and link checks; approve / reject / suspend / reinstate; history log | ✅ |
| Sponsored placements on home, shop, search and category pages, labelled **Sponsored** | ✅ |
| Impression and click analytics, de-duplicated per viewer per hour; CTR shown to advertisers | ✅ |
| Google Play one-time purchase flow and server verification | ✅ built, **off by default** |
| Refunds and revocations end the campaign (admin "Sync Play refunds") | ✅ |
| Admin grants (unpaid) for testing or compensation | ✅ |

**Left untouched:**
- AI subscription products, verification and credentials. The only change is that `lib/aiPayments.js` now exports its existing token helper, so the new code can reuse it.
- Paystack and USDT.
- Marketplace checkout, the seller ledger, wallet, withdrawals and escrow.

---

## 2. Pricing (seeded, editable in the admin portal)

| Package | Type | Price | Duration | Creatives | Placements | Priority |
|---|---|---|---|---|---|---|
| Starter Ads | Ad | **$10** | 3 days | 1 | shop, category | 10 |
| Growth Ads · *Popular* | Ad | **$20** | 7 days | 2 | home, shop, category | 20 |
| Premium Ads | Ad | **$40** | 15 days | 3 | home, shop, search, category | 30 |
| Business Ads | Ad | **$75** | 30 days | 5 | home, shop, search, category | 40 |
| Quick Boost | Boost | **$3** | 24 hours | — | shop, category | 10 |
| Seller Boost · *Popular* | Boost | **$10** | 7 days | — | shop, search, category | 20 |
| Power Boost | Boost | **$25** | 30 days | — | shop, search, category | 30 |

- Every ad package allows images or videos and an external HTTPS link.
- Boosts promote one existing listing and are priced per listing.
- Each purchase stores a **snapshot of the package terms**, so editing a package later never changes what someone already bought.

**Delivery rules:**
- Placement is weighted by priority, with at most 1 ad banner and 4 boosted listings per page view.
- Each placement has a cap on live ads (home 6; shop, search and category 10 each). An ad can't be approved if every placement it uses is full.
- No sales, clicks or impression counts are guaranteed, and the app says so.

---

## 3. How it works

```
Purchase (Google Play) ─► server verifies with Google ─► entitlement (1 per purchase token)
                                                              │
Media: app ─signed upload─► Cloudinary (private, own folder) ─► server re-reads & checks ─► advertising_media
                                                              │
Campaign draft (uses 1 entitlement) ─► submit
      ├─ boost of own live listing ─► live immediately
      └─ ad ─► admin review ─► approve: media made public, campaign live, paid period starts
                                                              │
Serve (approved + live + public media only) ─► app shows "Sponsored" ─► impressions / clicks
Refund at Google ─► Sync refunds ─► entitlement refunded, campaign ended
```

**Lifecycle rules** (enforced in database functions, so every client follows them):
- **The paid period starts when the campaign first goes live,** not at purchase.
- **Editing a live ad sends it back to review.** It pauses until approved, and the paused time is given back on re-approval (full paid exposure, never more). A live boost can't be changed. *(Revised in the safety review: see `ADVERTISING_MIGRATION_READINESS.md`.)*
- **A draft can be deleted,** which returns its package for reuse.
- **An ad can only be approved when:**
  - its entitlement is valid,
  - every creative has been approved,
  - any external link has been checked,
  - a placement is available.

---

## 4. Security

| Risk | Control |
|---|---|
| Malicious or oversized uploads | Uploads go **only to Cloudinary**, never Supabase. The server signs each upload: owner's folder, a random server-chosen file name, allowed formats (JPG/PNG/WebP; MP4/MOV/WebM), private (`authenticated`) delivery. The server then **re-reads the asset from Cloudinary's Admin API** and checks owner folder, delivery type, media type, format, size (10 MB images / 100 MB video) and duration (60 s). Failures are deleted. No raw, SVG, HTML or executable uploads are possible. |
| Unapproved media seen by the public | Pending media is reachable only through signed URLs minted by the server, and only for the owner and admins. These signatures are unguessable but **do not expire**. A database constraint makes "public delivery" impossible unless the media is approved. Approval switches the asset to public delivery in Cloudinary. |
| Client-supplied media URLs | Never accepted. Only Cloudinary public IDs that the server verified are stored. |
| Malicious external links | Links are stored in Supabase as text (not in Cloudinary): HTTPS only, no credentials, no IP addresses, no custom ports, no internal hostnames. Every redirect hop (up to 5) is re-checked, and each hostname must resolve to public addresses only (SSRF protection). The admin sees the submitted URL, the final URL after redirects, and when it was checked. The app asks before opening external links. Changing the link sends the ad back to review. |
| Fake or duplicate purchases | Nothing is granted on the client's word. The server re-reads the purchase from Google, which must be purchased (not pending or cancelled) and bound to this account (`obfuscatedExternalAccountId`). The purchase token is **unique**, so retries and restores return the same entitlement. The purchase is then consumed (which also acknowledges it). |
| Purchasing before setup | Off unless `PROMOTIONAL_BILLING_ENABLED=true` **and** the package has a Play product ID. An empty ID never grants anything; the app shows "Coming soon". |
| Price mismatch | Google Play charges the Play Console price. The app shows Play's price before purchase. If the Play product is priced in USD and differs from the package price, checkout is blocked. |
| Data access | All 8 tables have RLS on with no client privileges, and the functions are server-only. Advertisers can only see or change their own media and campaigns. Only admins can review. |
| Analytics inflation | Impressions and clicks are de-duplicated per campaign, viewer and hour in the database. The viewer key is a hashed random install ID (or a hash of IP + browser) and isn't linked to the account. Events count only for live campaigns. |
| Admin XSS | All advertiser text in the admin portal is HTML-escaped. |

**Not included** (recommended before high volume):
- Cloudinary's paid malware-scanning and AI moderation add-ons.
- Automated URL reputation checks (e.g. Google Safe Browsing).
- Today, manual admin review is the moderation layer.

---

## 5. Google Play billing policy

- **Ads and boosts shown inside the Android app are digital services used in the app,** so in the Play Store build they must be sold through **Google Play Billing**. That applies even when the ad links to an external website, because the ad itself is displayed in the app.
- **Marketplace purchases of physical goods and services** (Paystack and USDT checkout) are outside Play Billing's scope and are unchanged.
- **The website and web app (`/app`)** aren't distributed through Google Play. A web payment rail (e.g. Paystack) could be added there later. This build does not sell ads on the web; it tells web users to buy in the Android app. If you add web sales, follow Google's rules about not steering Android users to cheaper outside payments, and check whether your account is eligible for Play's alternative or user-choice billing programs in Play Console.
- **Google's service fee** is commonly 15% on the first $1M of yearly revenue if you're enrolled in the 15% tier. Confirm your rate in Play Console. Revenue projections should allow for it.
- Re-check Google's current Payments policy before launch. Policies change and vary by country.

---

## 6. Configuration

| Variable | Status | Purpose |
|---|---|---|
| `PROMOTIONAL_BILLING_ENABLED` | **New**, defaults to off | Must be `true` to sell packages |
| `GOOGLE_PLAY_PACKAGE_NAME`, `GOOGLE_PROJECT_ID` / `GOOGLE_CLIENT_EMAIL` / `GOOGLE_PRIVATE_KEY` (or `GOOGLE_PLAY_SERVICE_ACCOUNT_JSON`) | Existing (AI subscription) | Reused, read-only |
| `CLOUDINARY_URL` | Existing | Server-side signing and verification of uploads |
| `CRON_SECRET` | Optional | Lets a scheduled job call `/api/admin/ads/sync-voided` |

**Play product IDs live in the database** (`advertising_packages.google_play_product_id`, editable in Admin → Ads), not in env vars. That way, adding or retiring packages never needs a redeploy. They're all empty now.

---

## 7. Google Play Console setup (Stage 2)

1. **Monetize → Products → In-app products → Create product**, once per package.
   - Suggested IDs (choose your own; they can never be reused once created): `onedream_ad_starter`, `onedream_ad_growth`, `onedream_ad_premium`, `onedream_ad_business`, `onedream_boost_quick`, `onedream_boost_seller`, `onedream_boost_power`.
   - Set the default price in **USD equal to the package price**, review the local prices Play generates (NGN etc.), add a name and description, then **Activate**.
   - Consumption is handled by our server, so no special type is needed.
2. **Service account permissions:** in Play Console → Users and permissions, the existing AI service account needs **View financial data** (for refunds) and **Manage orders**.
3. **License testers:** Setup → License testing → add tester Gmail accounts.
4. **Testing:** upload an Android build to the **internal testing** track and install it from there. Billing only works for Play-installed builds.
5. **Admin → Ads → Packages:** enter each product ID exactly as created.
6. **Vercel:** set `PROMOTIONAL_BILLING_ENABLED=true` on a **preview** first and test end to end with a license tester:
   - buy a package (it appears under "Your packages");
   - create an ad, upload media, submit it, approve it in admin, and see it live with "Sponsored";
   - check impressions and clicks;
   - buy a boost (it goes live immediately);
   - refund an order in Play Console, run **Sync Play refunds**, and confirm the campaign ends;
   - re-open the app mid-purchase to confirm it recovers automatically.
7. Then enable it in production.

---

## 8. Test results (staging)

**78 / 78 passed.** Everything runs against the real migration (local Postgres, PGlite) and the real server libraries.

| Area | Checks |
|---|---|
| Migration verification | 26 checks: tables, RLS, privileges, seeds, constraints, functions |
| Seeded prices and durations match the plan | 1 |
| Entitlements | The same purchase token can't grant twice |
| Media | Unapproved media can't be public; another advertiser's media is refused |
| Ad rules | Creative required; creative limit enforced; unchecked link refused; can't submit someone else's campaign; goes to review, not live; approval blocked until media is approved; period starts at approval (72 h); re-approval doesn't extend it |
| Events | Recorded when live; duplicates ignored; click counted separately; bad viewer key refused; nothing recorded while suspended |
| Moderation | Suspend and reinstate; a revoked campaign can't be reinstated; history recorded |
| Boosts | Another seller's listing refused; paused listing refused; own live listing goes live immediately (168 h); a boost must point to a listing |
| Capacity | Approval refused when placements are full, allowed once space frees up |
| Refunds | A refund ends the campaign and refunds the entitlement, exactly once |
| Link safety | 10 URL rules; 11 private-address cases; redirects followed; redirect to http refused; redirect to a private IP refused; more than 5 redirects refused; error page refused |
| Cloudinary | Signature matches Cloudinary's documented example; uploads signed to the owner's folder, private, format-limited; tampering breaks the signature; raw/SVG not signable; folder, delivery type, duration and size checks; signed URLs for pending media, public URLs for approved |
| Billing | Off by default; empty product ID never purchasable; retired package not purchasable; enabled + product ID = purchasable |
| Purchase evaluation | Purchased = grant; pending, cancelled, another account's or unbound purchase = no grant |

The app typecheck (`tsc`) is clean and all 15 new server files parse.

**Not yet tested:**
- Live Google Play purchases and refunds (needs Stage 2 products and license testers).
- Real Cloudinary uploads against your account.
- The deployed routes against the live database (needs the migration and a deploy).

---

## 9. Files

**New: database** — `supabase/add_advertising.sql`

**New: server**
- `lib/ads.js`, `lib/cloudinaryAds.js`, `lib/adDestinations.js`, `lib/adsGooglePlay.js`
- `pages/api/ads/`: `packages`, `media-sign`, `media`, `campaigns`, `campaign-submit`, `purchase-google-play`, `serve`, `event`
- `pages/api/admin/ads/`: `index`, `review`, `packages`, `grant`, `sync-voided`

**New: app**
- `mobile/src/api/ads.ts`, `mobile/src/lib/ad-viewer.ts`
- `mobile/src/components/sponsored.tsx`, `mobile/src/components/promo-billing.tsx`
- `mobile/src/app/promote/index.tsx` (Packages / Campaigns / Media), `mobile/src/app/promote/campaign.tsx` (editor)

**Modified**

| File | Change |
|---|---|
| `lib/aiPayments.js` | `export` added to the existing Google token helper; nothing else |
| `mobile/src/app/_layout.tsx` | Promote routes |
| `mobile/src/app/(tabs)/profile.tsx` | "Promote & advertise" entry |
| `mobile/src/app/catalogue/manage.tsx` | "Boost a listing" button |
| `mobile/src/app/(tabs)/index.tsx` | Home sponsored banner |
| `mobile/src/app/shop/index.tsx`, `shop/category/[id].tsx` | Sponsored banner and boosted listings |
| `mobile/src/components/listing-card.tsx` | Sponsored label and tracking |
| `public/admin-portal.html` | New **Ads** tab: review queue, packages, grants, refund sync |

---

## 10. Remaining activation steps

1. **Approve** this stage. I then run nothing on production until you say so.
2. Run `supabase/add_advertising.sql` in Supabase. Every verification row must be `ok = true`.
3. Deploy the website and API (purchasing stays off). Rebuild the web app at `/app` and the APK.
4. Admins can then use **Grant a package** to test the full flow for free, with no real money involved.
5. Stage 2: create the Play products (§7), enter their IDs, test with license testers on a preview, then set `PROMOTIONAL_BILLING_ENABLED=true` in production.
6. Optional: schedule refund sync daily (Vercel cron calling `/api/admin/ads/sync-voided` with `CRON_SECRET`), and consider Cloudinary's moderation and malware add-ons.
