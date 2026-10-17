# One Dream Storefront Promotion

18 October 2026. Status: **live.** Database: `supabase/add_storefront_promotion.sql` applied; `supabase/fix_storefront_promotion_review.sql` to run (terms v2, immutable terms, budget reservation, append-only spend).

## Purpose

Instead of paying influencers for videos, One Dream uses videos that sellers already make about their own products to advertise **the marketplace externally**: TikTok, Instagram, Facebook, YouTube and X.
- **Sellers get:** exposure and customers sent to their storefront.
- **One Dream gets:** authentic promotional material.

It has nothing to do with Google Play products, in-app Seller Boosts or in-app advertising packages.

## The rules (terms version 2)

- **To take part:** at least **10 active listings**, and a promotional video on a listing.
- **Opt-in:** per video, and **off by default**.
  - Showing a video on the storefront never opts it in.
  - The seller ticks a separate consent box and submits each video they want considered.
  - Sellers can submit **as many videos as they like** (one per listing).
  - At most **3 videos per seller** are selected and funded in each round, so the budget reaches many different businesses.
- **Selection:** One Dream reviews submissions and selects videos for authenticity, originality, clarity, presentation, relevance and suitability for advertising. Selection isn't guaranteed.
- **Value:**
  - each selected video may receive **up to US$10 of external advertising**, paid by One Dream; being selected doesn't mean the full $10 will be spent;
  - the total **promotion cap is US$1,000** across all selected videos under these terms;
  - when the cap is used up, One Dream stops spending or opens a new round with new terms;
  - it isn't cash, a wallet balance, a Google Play purchase or an in-app credit.
- **Consent:** the seller confirms that:
  - they own the video or have permission for everything in it;
  - One Dream may edit, caption, brand, publish and advertise it on external platforms;
  - their business name, product details and storefront link may appear with it;
  - the permission is non-exclusive and royalty-free, and the seller keeps ownership.
- **Withdrawal:** any time, in the app or through support. It stops future use. Content already published isn't automatically removed.

The full text is stored in the database, versioned with a SHA-256 hash. It's shown in the app and on the public page `/storefront-promotion.html`.

## How it works in the system

| Part | Where |
|---|---|
| Tables: terms (versioned text, hash, $10 per video, $1,000 cap, 10 listings), submissions (consent record), campaign spend | `supabase/add_storefront_promotion.sql` |
| Rules enforced by the database | **Consent:** the facts can't be changed after recording (who, which video, which terms and hash, the consent sentence, time, IP, device), and a withdrawn consent can't be reactivated (the seller must submit again). **Terms:** a published version can't be edited, and an accepted one can't be deleted; new wording is a new version via `promo_publish_terms()`. **Selection:** at most 3 selected videos per seller per version, and selecting reserves $10, refused once the uncommitted budget can't cover it. **Spend:** only for a selected video, at most $10 per video and $1,000 in total per version; rows are append-only, corrections are negative rows with a note |
| Seller API | `GET/POST /api/promo/submissions`: eligibility, submit with `accept: true` for the current terms version, withdraw |
| Public terms | `GET /api/promo/terms`, `public/storefront-promotion.html` |
| Admin API | `GET/POST /api/admin/promo`: list by status, select / not select with a note, record spend (platform, amount, post URL, impressions, clicks) |
| Admin portal | Tab **📣 Video promotion**: watch each video, select, copy the tracked storefront link for the ad, record spend and results |
| App | My Listings → **Get featured in One Dream's social media ads** (`mobile/src/app/catalogue/promotion.tsx`): eligibility, terms, choose a video, consent checkbox, submission status, where it was promoted, withdraw |
| Website copy | The old "$10/month promotion package" promise is replaced in `public/Onedream.html`, `pages/onedream/index.jsx` and the app home screen |
| Tests | `scripts/test-storefront-promo.mjs`: consent immutability, several videos per seller, withdrawal, selected-only spend, $10 per video, $1,000 cap |

**Tracked link:** each selected video gets a storefront link with campaign tags, for example `https://www.flymaddcreative.online/app/catalogue/<seller>?utm_source=tiktok&utm_medium=paid_social&utm_campaign=storefront_promo_<id>`. Use it in the ad so visits can be traced back to the video.

## Admin workflow

1. Admin portal → **📣 Video promotion** → "Waiting for review". Watch each video.
2. **Select** suitable ones, or mark them **Not selected** (the note is shown to the seller).
3. Before using a video, check that its consent is live. Withdrawn videos move to "Withdrawn", and a warning shows if the seller has changed the video on the listing since submitting.
4. Post or advertise it on social media using the tracked storefront link.
5. **Record spend** for each campaign: platform, amount (at most $10 per video in total), post URL, and impressions and clicks when known. The seller sees where their video was promoted, but not the amount.
6. **Mistakes:** spend rows can't be edited or deleted. Record a negative amount with a note explaining the correction.
7. **Budget:** the summary shows committed (each selected video reserves $10), spent and uncommitted budget. Selection is refused once the uncommitted budget can't cover another $10.
8. **New round or new wording:** publish a new terms version (`select promo_publish_terms(3, ...)` in SQL). It becomes current at once; earlier consents stay tied to the version each seller accepted.

## Possible later improvements

- Automatic posting through each platform's API (needs business accounts and API access on each network).
- Pulling impressions and clicks automatically instead of entering them.
- Counting storefront visits and sales that came from each tracked link.
- A public "Featured sellers" gallery of selected videos.
