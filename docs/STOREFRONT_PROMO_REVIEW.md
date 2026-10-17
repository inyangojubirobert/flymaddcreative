# The $10/month storefront promotion: what exists and what to improve

18 October 2026.

## What I found

The offer appears in **three places, as marketing copy only**:

| Where | Text |
|---|---|
| Website `public/Onedream.html` (line ~1080), "How It Works", step 4 | "Build a 10-product catalogue with a promotional video and get a $10/month promotion package — your seller or store owner profile gets referred to customers on flymaddcreative.online as part of the One Dream Initiative." |
| Next.js page `pages/onedream/index.jsx` (line ~182) | Same promise ("unlock a $10/month promotion package") |
| App home `mobile/src/app/(tabs)/index.tsx` (line ~168), "4. Build your storefront" | Same promise |

**Nothing behind it is built.** There is no:
- eligibility check (10 listings + a video);
- way for a seller to apply or claim it;
- monthly grant of the package;
- "best video" selection or judging;
- workflow for promoting the chosen video on external social media (Instagram, TikTok, Facebook, X);
- terms page saying what the package is, how long it lasts, or who decides.

The "best video promoted on social media" idea from your note isn't written anywhere in the project. The current copy promises the $10/month package to **everyone** who reaches 10 listings with a video, not to one winner.

**What already exists and can deliver it:**
- Listings already have a promotional video (`catalogue_items.promo_video_url`; sellers can upload one in My Listings).
- The ads system already has a **$10 Starter Ads** package (3 days) and a **$10 Seller Boost** (7 days).
- Admins can already give a package free: Admin portal → Ads → **Grant a package** (`pages/api/admin/ads/grant.js`). It is recorded as unpaid (`provider = admin_grant`), so it never counts as revenue.

**Today in production:** 34 participants and 2 sellers, each with 1 listing and no video. **Nobody qualifies yet**, so the promise has cost nothing so far. It is a good moment to fix it before anyone does.

## Problems with the current promise

1. **It's open-ended.** "Get a $10/month promotion package" reads as forever, for everyone. With no end date or cap, it's an unbounded cost, and anyone not given it could say they were misled.
2. **"$10/month" doesn't match any product.** The $10 packages last 3 or 7 days, not a month. Either the package or the wording must change.
3. **"10-product catalogue" is easy to game.** Ten near-identical or placeholder listings would qualify. There's no quality bar.
4. **"Referred to customers" is vague.** It doesn't say where or how (home page, shop, search, social media).
5. **No judging rules for a "best video".** A selection without published criteria invites disputes.
6. **External social media rights.** Posting a seller's video on One Dream's social accounts needs the seller's permission, which the listing form doesn't currently ask for.

## Recommended programme

Two tiers. The first replaces the current promise with something deliverable; the second is your "best video" idea.

### Tier 1: Storefront Starter (automatic, everyone who qualifies)

- **Qualify:**
  - 10 **active** listings, each with at least one photo and a price;
  - at least one listing with a promotional video;
  - account at least 7 days old.
- **Reward:**
  - one free **Seller Boost** (7 days, $10 value), once per seller, granted through the existing admin grant;
  - optionally renewed once a month while the seller keeps 10 active listings **and** made at least one sale that month (keeps it tied to real activity).
- **Wording:** "Reach 10 active listings with a promo video and get a free 7-day Seller Boost ($10 value)."

### Tier 2: Video of the Month (one winner, promoted on social media)

- **Enter:** any seller who meets Tier 1 ticks "Enter my video in Video of the Month" on a listing. This also records consent to repost the video on One Dream's social media, with credit and a link to the listing.
- **Judging (published):**
  - product clarity (does the viewer understand what's sold?);
  - quality (light, sound, length 15–60 seconds);
  - originality;
  - engagement on the platform (views and clicks from the listing page), worth at most a third of the score so it can't be bought with votes.
  - Admin picks the winner. Votes aren't used, which keeps it clear of Google Play's paid-voting concerns.
- **Reward:**
  - the video is posted on One Dream's social accounts, with the seller's handle and listing link (an affiliate-style tracked `/r/` link, so sales are measurable);
  - a featured spot on the home page and shop for the month, plus the winner badge on their storefront;
  - Starter Ads package ($10) to run the video in-app.
- **Cap:** one winner a month (or one per region later). That's about $10 of in-app value plus your social reach per month: a fixed, known cost.

## What it takes to build

| Piece | Effort | Notes |
|---|---|---|
| Fix the copy in the 3 places | Small | Do now, before anyone qualifies. Suggested text above |
| Eligibility check + "Storefront Starter" progress in the app (e.g. "7 of 10 listings · video ✓") | Small–medium | One API reading `catalogue_items`; a card in My Listings |
| Admin list of qualifying sellers + one-click "Grant Seller Boost" | Small | Reuses `pages/api/admin/ads/grant.js` |
| Auto-grant once per seller (optional) | Small | A daily job; one grant per seller, recorded so it's never doubled |
| Video of the Month entry, consent, admin judging and winner page | Medium | New table `video_awards` (month, listing, seller, consent, scores, winner) |
| Social posting | Manual at first | Admin downloads the winning video and posts it. Automating posts to each network needs their APIs and business accounts, so do it later if the programme works |
| Terms | Small | A short programme rules page: eligibility, judging, one winner a month, the right to end the programme, consent to repost |

## Suggested next step

1. **Now:** replace the copy in the three places with the Tier 1 wording, so the site doesn't promise an open-ended monthly package.
2. **Then:** build the eligibility card, the admin qualifying-sellers list and the one-click grant (Tier 1).
3. **After the first sellers qualify:** add Video of the Month (Tier 2) with a rules page.

Say which of these to build, or change any of the numbers (10 listings, 7-day boost, one winner a month) and I'll implement it.
