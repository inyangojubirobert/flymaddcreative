# House ads

18 October 2026. One Dream's own image and video ads, uploaded by admins, promoting One Dream's own apps, products and pages.

## What they are

- **No package or subscription:** they don't need an advertiser, an ad package, a Seller Boost or a Google Play purchase, and they never touch paid advertising billing.
- **Same slots as paid ads:** home, shop, search and category, in the app (every version, including 1.0.21 already installed) and the web app at `/app`. The server returns them in the same format as paid ads, so no app update is needed.
- **Links:** a website or app-store link (https only), one of your listings, or a storefront.
- **Two modes:**
  - **Fill** (default): shown only in a slot that no paid ad is using, so paying advertisers always come first.
  - **Rotate:** competes with paid ads for slots by weight (1–100; paid campaigns use their package priority).
- **Timing:** optional start and end dates. Pause, re-activate or archive at any time.
- **Counting:** impressions and clicks are counted once per viewer per hour, the same way as paid ads.

## Using it

Admin portal → **🏠 House ads**:
1. Choose an image (jpg, png, webp, up to 10 MB) or a video (mp4, mov, webm, up to 100 MB and 60 seconds).
2. Enter a title, optional text and button label, the link, the placements, the mode and the weight.
3. **Upload and publish.** The file goes straight to Cloudinary (folder `onedream_house_ads`), the server checks it against Cloudinary, and the ad is live.

The list shows each ad's preview, link, placements, dates, impressions, clicks and click rate.

## Parts

| Part | File |
|---|---|
| Database (house ads, events, counting function) | `supabase/add_house_ads.sql` |
| Upload signing, verification, serving shape | `lib/houseAds.js` |
| Admin API | `pages/api/admin/house-ads.js` |
| Serving (mixed into paid ads) | `pages/api/ads/serve.js` |
| Counting (same endpoint the app already calls) | `pages/api/ads/event.js` |
| Admin screen | `public/admin-portal.html`, tab **🏠 House ads** |
| Tests | `scripts/test-house-ads.mjs` |

## Later

- An app update could label house ads "From One Dream" instead of "Sponsored". Today they show with the normal sponsored label.
- House ads on the public website pages (not only the app and `/app`).
