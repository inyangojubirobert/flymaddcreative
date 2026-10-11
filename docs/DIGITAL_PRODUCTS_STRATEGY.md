# Digital products: instant access, offline library, recurring revenue — analysis & strategy

_2026-10-11 · Status: **phases 1 and 2 built in staging (not deployed)**. Billing products: [GOOGLE_PLAY_PRODUCTS.md](GOOGLE_PLAY_PRODUCTS.md)._

> **What was built (phase 1)**, following the review:
> - **Google Play price tiers:** 17 tiers ($0.99–$49.99) with placeholder IDs. Each purchase is bound to the exact item and buyer through Google's own purchase record. The paid tier must be ≥ the item's price, a token can never be reused, and buyers can't buy their own or already-owned items.
> - **Isolated `digital_earnings` ledger:** gross − Google fee (15%) − commission (5%) = net, held 72 h, reversed on refunds. Admin records payouts after reconciling. **No change to escrow, wallet or withdrawals.**
> - **Secure delivery:**
>   - private Cloudinary uploads with server verification;
>   - PDF pages served as images watermarked with the buyer's username;
>   - expiring download links for audio and video;
>   - device limit 3, offline window 30 days;
>   - screenshot blocking;
>   - refunded copies wiped at the next online check.
> - **App:** digital product panel with preview and Google Play purchase, **My Library**, reader and players, offline downloads, "Sell as digital" seller setup, Wallet → Digital sales. **Admin:** review queue, tiers with Play status, grants, refund sync, payout recording.
> - **Existing checkout:** digital items are refused by the cart, single-item checkout and the website product page (before any charge).
>
> **Phase 2 (built, `supabase/add_digital_phase2.sql`)**, isolated from AI subscriptions, ads billing, wallet, escrow, marketplace checkout and seller withdrawals:
> - **Website purchases (Paystack):** a separate digital card checkout (own `dgp_` references and `digital_paystack_payments` table, NGN at the live USD rate). The checkout is bound to the buyer and the item (or creator) at the server's price. It unlocks the **same Library** as Google Play. Anything that can't be delivered is refunded automatically. No webhook is needed: the buyer's return plus a daily sync confirm payments. The website product page and the web app sell digital items this way; the Android app keeps Google Play only (Play policy).
> - **Creator subscriptions:** monthly plans ($1.99–$19.99) covering every published product the creator includes.
>   - **Android:** Google Play subscriptions (placeholder IDs, 3 "slots" per price), bound to subscriber and creator in Google's record, acknowledged only after recording.
>   - **Website:** card subscription renewed monthly by charging the saved card; a charge is never repeated if its result is unknown.
>   - **Both:** cancel any time and keep access to the end of the paid month. Failed renewals get 3 days, then access ends. Refunds end access and reverse that month.
>   - Each paid month is a creator earning in the same isolated ledger (`source = subscription`).
> - **EPUB:** DRM-free EPUBs stored as private raw files, checked on upload (real EPUB, not DRM-protected, readable sections). Previews are sanitised, text-only first sections. The in-app reader renders one sanitised section at a time with scripts off (a sandboxed iframe on the web) and a buyer watermark.
> - **Encrypted offline copies:** AES-256-GCM in 1 MB authenticated chunks. The key is derived by the server per licence (or subscription item) and device, and kept in the device keystore. Files can't be read without it, can't be moved to another item or device, and tampering is detected. Audio and video are decrypted to a temporary file only while playing. Revoked, refunded or expired copies lose both files and key at the next online check; subscription copies expire with the paid month.
>
> **Still not built:** templates and asset packs. Offline protection is deterrence, not DRM: a rooted device can still capture content while it plays.
---

## 1. Where we are

- **Categories already exist:** Digital Products, E-books, Books, Online Courses, Music & Audio Files, Templates & Design Assets, Photography & Stock Media, Software & Apps, Movies & Entertainment. Several are service categories too (Video Production, Graphic Design, Music & Audio Services).
- **The listing engine already supports a `digital_delivery` fulfilment method,** but no listing uses it yet, and only 2 listings are live.
- **Today every sale is escrowed:** buyer pays, seller delivers, buyer confirms, then funds become withdrawable. That suits physical goods and services, but it's needless friction for a PDF that can be delivered the moment payment clears.

So the foundation exists. What's missing is **instant delivery, an in-app library, offline access, and a payment rail that's allowed for digital content inside an Android app.**

---

## 2. Which products qualify

| Product | Typical format | Access in app | Offline | Natural recurring model | Notes |
|---|---|---|---|---|---|
| E-books, guides, PDFs | PDF, EPUB | Built-in reader | ✅ Download | Series / creator subscription | Highest volume, smallest files |
| Audiobooks, podcasts (premium) | MP3/AAC | Audio player, background play | ✅ | Creator subscription | |
| Music: singles, albums | MP3/AAC | Music player | ✅ | Artist subscription | Rights verification essential |
| **Beats / instrumentals** | WAV/MP3 + licence PDF | Player + licence document | ✅ | Producer subscription ("beat club") | Strong local market; licence tiers (lease vs exclusive) |
| Video courses, tutorials | MP4 / HLS | Video player | ✅ Download (large) | Course or creator subscription | Biggest storage and bandwidth cost |
| Films, short films, comedy skits | MP4 / HLS | Video player | ⚠️ Optional (size) | Creator subscription | |
| Stock photos, design assets, templates, presets | JPG/PNG, ZIP | Preview in app; used in **other** apps | ❌ Must leave the app to be useful | Packs | Doesn't fit "never leaves the platform"; treat separately |
| Software, game keys, gift cards | Codes | — | — | — | **Exclude**: fraud-prone, high policy risk |

**Core scope (phase 1):** e-books/PDFs, audio (music, beats, audiobooks) and video courses. These can be consumed entirely inside the app, which matches your goal of no delivery, no confirmation, offline access and staying in-platform.

**Templates, stock assets and presets** are only useful once exported, so they can't stay inside the platform. Offer them later as "download to device" items, with clearer licence terms.

---

## 3. The decisive constraint: how digital content is paid for in the Android app

This shapes everything else.

- **Physical goods and real-world services** (current marketplace) may use Paystack/USDT in the Android app. That's why today's checkout is fine.
- **Digital content consumed inside the app** (e-books, music, video, courses, subscriptions to them) falls under Google Play's **Payments policy**. In the Play-distributed app, it must generally be sold through **Google Play Billing**. Google takes a service fee, commonly 15% for developers in the 15% tier; confirm yours in Play Console.
- The app must also not **steer** Android users to a cheaper outside payment for that content, except under Google programmes (alternative/user-choice billing, external offers) where available in your region. Check eligibility in Play Console.
- **Content bought on the website** (not in the Android app) can be paid with Paystack/USDT. The Android app may then let the owner **access** what they bought, the same model streaming services use, as long as the app doesn't push them to buy outside.

_Policies change and vary by country. Re-read Google's current Payments policy before launch._

### Options for selling seller-priced digital items through Play Billing

Google Play products are pre-defined product IDs, but marketplace items are created by sellers at any price. Three workable patterns:

| Option | How it works | Pros | Cons |
|---|---|---|---|
| **A. Price-tier products** (recommended for Android) | ~20 consumable Play products: `onedream_digital_t099`, `_t199`, `_t299` … `_t4999`. Each item's price snaps to a tier. Each purchase carries the item ID (`obfuscatedProfileIdAndroid`), so the server knows exactly what was bought and grants that item. | Proven pattern; one product per price point, not per item; reuses the Google Play verification just built for ads | Prices must sit on tiers; ~15% Play fee |
| **B. One Dream Credits** | Buy credit packs through Play, spend credits on items | One purchase covers many small items; good for 50¢ songs | Virtual-currency rules, unspent-balance liability, refunds and accounting more complex |
| **C. Web purchase + in-app library** | Buy on the website (Paystack/USDT, ~1.5%); the Android app only shows the owner's library | Lowest fees; checkout already exists | Android shoppers can't buy in-app; anti-steering limits how the app may mention it |

**Recommendation: A + C behind one shared library.**
- On **Android**: buy through **Play price tiers**.
- On the **website and web app**: buy with **Paystack/USDT**, using the existing cart.
- Both create the same **licence**, so the item appears in the buyer's library everywhere, offline included.

**Economics:** Play's ~15% plus our 5% commission doesn't work at the same price. Choose one:
- a higher commission for Play digital sales (seller nets after the Play fee);
- an Android price uplift (Play tier one step up);
- or simply accept a thinner margin.

Seller earnings must be computed **net of the Play fee** on Android sales.

---

## 4. Delivery, refunds and escrow for digital goods

**No delivery and no buyer confirmation:**
1. Payment is verified (Google or Paystack/USDT, same as today).
2. A **licence** is created instantly and the item appears in the buyer's **Library**.
3. Seller earnings enter the existing ledger as **pending for a short hold** (proposed: 72 hours), then become **withdrawable automatically**, with no buyer action needed.

**Refunds:**
- **Not yet opened or downloaded:** refund on request within the hold window, and the licence is revoked.
- **Already opened:** refund only for defective or misdescribed content, decided by an admin dispute. The licence is revoked.
- **Google Play refunds or chargebacks** are detected by the refund sync built for ads, and revoke the licence.
- **After withdrawal:** reuse the ledger's "owed" handling.

This keeps buyer protection without the confirm-delivery step. Physical goods keep today's escrow unchanged.

---

## 5. Recurring revenue models

| Model | What the buyer gets | Billing | When |
|---|---|---|---|
| **Repeat purchases** | Each item bought once and kept forever | Play tier products (consumable) / Paystack | Phase 1 |
| **Creator subscription** ("Join @username") | Everything the creator publishes while subscribed; series and courses | Play subscriptions with tiered base plans (reusing the AI subscription billing pattern) / Paystack subscriptions on web | Phase 2 |
| **Series / course passes** | Episodes as they release | One-time Play tier product | Phase 2 |
| **One Dream Plus** (all-access library) | Platform-wide catalogue | Play subscription | Later; needs a revenue-share pool based on listening/reading time, plus enough content |

Creator subscriptions are the strongest recurring lever: predictable income for creators, and recurring commission for One Dream.

---

## 6. Offline access that stays inside the platform

| Concern | Approach |
|---|---|
| Storage and delivery | Seller uploads go through **server-signed private uploads** (the same pattern as ad media). Files are never public, and downloads use **short-lived signed URLs** issued only to licence holders. Large video may be cheaper on R2/Bunny than Cloudinary; compare before launch. |
| Offline storage | Downloaded into the app's **private sandbox** (not the phone's gallery or file manager), **encrypted** with a per-licence key held in the device keystore |
| Licence checks | Each download carries an **offline validity window** (e.g. 30 days). The app re-checks online when it can. Revoked or refunded licences are wiped at the next check. A device limit (e.g. 3 devices) applies. |
| Readers and players | PDF reader; EPUB reader; audio player with background play and lock-screen controls; video player with streaming (HLS) and download |
| Copy deterrence | Screenshot and screen-recording blocking on Android (`FLAG_SECURE`) in readers and players; **buyer watermark** (name/email) stamped into PDFs; no export or share buttons |
| Honest limit | Determined users can always capture content (e.g. with a second camera). These measures deter casual sharing; they don't make piracy impossible. |

**Before buying:** a free preview (first pages, 30-second clip, first lesson) generated at upload time.

---

## 7. Seller side and safety

- **Upload rules:** allowed formats only (PDF, EPUB, MP3/AAC/WAV, MP4). Size limits by type. PDFs checked for embedded scripts. No executables or archives in phase 1.
- **Rights:** sellers declare they own the rights; there's a copyright takedown process (report → hide → review → strike) and repeat-infringer bans. **Music and film are the highest-risk categories.**
- **Content policy:** align with Google Play's content rules (no adult content, hate or piracy). The existing admin review applies to new digital listings.
- **Taxes:** VAT on digital services can apply to platform sales; Google handles tax on Play purchases in many countries. Get local tax advice for the website rail.

---

## 8. What gets built (outline)

| Component | Reuses |
|---|---|
| Digital file upload (seller) with private storage + preview | Ads media pipeline (signed uploads, server verification) |
| `digital_assets` (files per listing), `digital_licenses` (who owns what, source purchase, devices, offline window), `digital_price_tiers` | Ledger, catalogue listings |
| Instant fulfilment + 72 h hold → auto-withdrawable | Seller earnings ledger (new order path for digital items) |
| Android purchase via Play price tiers | Ads Google Play verification, consumption and refund sync |
| Web purchase via Paystack/USDT | Existing cart and checkout |
| **Library** tab (owned items, downloads, storage used) | — |
| Readers and players, encrypted offline cache, licence checks | New native modules (needs app rebuild) |
| Creator subscriptions (phase 2) | AI subscription billing pattern |

**Rough effort:**
- Phase 1 (e-books, audio, video courses; one-time purchases; library; offline): **3–5 weeks** of focused work.
- Phase 2 (creator subscriptions, series): **2–3 weeks**.

---

## 9. Risks

| Risk | Level | Mitigation |
|---|---|---|
| Play policy (digital content in app) | **High** if ignored | Play Billing on Android; web rail only off-app; no steering |
| Copyright and piracy | High (music, film) | Rights declaration, takedowns, watermarking, `FLAG_SECURE`, licence checks |
| Margin (Play fee + commission) | Medium | Commission or price policy for Play sales (§3) |
| Storage and bandwidth cost (video) | Medium | Size limits, streaming-first video, cheaper storage for large files |
| Refund abuse ("download then refund") | Medium | Refund only if unopened; admin review otherwise; Play refunds revoke access |
| Low-storage phones | Low | Streaming first; downloads optional, with storage shown in Library |

---

## 10. Decisions needed

1. **Scope of phase 1:** e-books/PDF + audio + video courses? (Recommended: yes; templates and assets later.)
2. **Android payment:** Play **price tiers** (recommended), credits, or website-only?
3. **Commission on Play digital sales:** keep 5% and absorb Play's fee, raise it, or price Android one tier up?
4. **Hold before seller payout:** 72 hours?
5. **Offline window and device limit:** 30 days / 3 devices?
6. **Creator subscriptions in phase 2?**
7. **Large-video storage:** stay on Cloudinary, or add a cheaper store for big files?
