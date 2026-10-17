# Merchant Affiliate Marketplace: Framework and Build Plan

17 October 2026, revised twice the same day after owner review. Status: **built on the owner's instruction, nothing deployed.** See [EARNINGS_AND_AFFILIATE_IMPLEMENTATION.md](EARNINGS_AND_AFFILIATE_IMPLEMENTATION.md). The migrations and the protected changes are not applied: P1, P3, P4, P5 and P6 are prepared in [protected-patches/](protected-patches/README.md), and P2 turned out to be unnecessary. The business rules are in section 12. No code, schema or payment flow has changed. This document replaces the affiliate notes in section 10 of `MERCHANT_COMPENSATION_REVIEW.md`.

**Changes in this revision**
- Section 6: attribution is now tied to the payment reference **before** the buyer pays, instead of being sent after checkout.
- Section 5: platform-funded and seller-funded commission are separate products, with their own budget and authorization rules.
- Section 7: rules keep seller referrals and product commissions apart.
- New section 13: one merchant account, separate ledgers, and the Dream Coins question.

## 1. Summary

One engine supports all four ways a merchant can earn. Each model is a setting on an **offer** that a seller attaches to their own listing. The seller decides which models are allowed for that listing; nothing is opt-out.

| # | Model | What the merchant does | What they earn | Who fulfils | Phase |
|---|---|---|---|---|---|
| 1 | **Referral affiliate** | Shares a tracked link to a seller's listing | A commission on completed sales | Seller | 1 |
| 2 | **Storefront curator** | Builds a branded storefront (`/m/<handle>`) of other sellers' products, with their own photos, videos, copy and collections | The same commission, on sales that come through the storefront | Seller | 1 |
| 3 | **Authorized reseller** | Sells the listing at their own price, at or above the seller's floor | The margin above the floor | Seller first; later the reseller | 2 |
| 4 | **Creative partner** | Photography, illustration, video ads and campaigns for sellers | A fixed fee, plus an optional commission on sales | Not applicable | 1 (fee), 2 (performance) |

**Answer to "wait for commission, or set my own price?"** Both are possible, if the seller allows them. A merchant who only promotes waits for commission (models 1 and 2). A merchant the seller has approved as a reseller sets their own price above the floor and keeps the margin (model 3). The seller still fulfils at first, so the merchant never handles stock until the platform supports reseller fulfilment.

**Buyer disclosure (owner question):** I agree with your recommendation. A resold listing shows "**Sold by DreamStyle · Fulfilled by Gentleman Store**" and says who handles delivery, returns and disputes. The seller's floor price is never shown.

## 2. How it fits what already exists

| Existing piece | Role in the affiliate engine |
|---|---|
| `catalogue_items` | The only product record. Offers and storefront entries **point to** an item and never copy it, so stock, price, specs and availability stay with the seller |
| `catalogue_orders` / `catalogue_checkouts` | Orders stay exactly as they are. Affiliate credit is stored in **separate attribution rows** linked to `order_id` |
| Order lifecycle (`paid → buyer_confirmed → released`, `disputed`) | Drives the earnings lifecycle in section 6 |
| `lib/sellerEarnings.js` (5% platform commission fixed per order) | The precedent: a commission is fixed on the order when it is made and never recalculated |
| `participants` | Sellers are participants. **Affiliate partners are participants too**, so one login works on the website, the web app and the APK |
| `referral_merchants` + `lib/merchantAuth.js` | Existing merchant accounts are kept. A merchant links their account to a participant once, and does not register again |
| `merchant_referral_links`, `participants.referred_by_merchant_link_id` | Existing seller-referral attribution, reused for referral rewards (section 7) |
| Advertising and boosts (`advertising_campaigns`) | Phase 3: an affiliate storefront or affiliate link becomes a new destination for ads and boosts |
| `participant_withdrawals.source` (`votes` / `marketplace`) | The pattern for an `affiliate` payout source (needs approval, section 10) |
| Dream Coins | **Kept separate.** Affiliate earnings are money; Dream Coins are not, and the two never convert. The `merchant_referral` and `affiliate_performance` recognition programmes will read their numbers from this engine (closes blocker B3) |

## 3. Roles

- **Seller**: owns the listing, publishes offers, approves partners, fulfils orders.
- **Partner**: a participant enrolled in the affiliate programme, optionally linked to a `referral_merchants` account. Partners have a public handle, a storefront and a status (`pending`, `active`, `suspended`).
- **Buyer**: unchanged. Buyers can still check out as guests.
- **Admin**: approves partners if required, sets global limits, reviews flags, handles disputes and approves payouts.

A partner cannot earn on their own listings, and cannot earn on purchases made with their own email or account.

## 4. The offer: one record, four models

A seller creates an offer per listing:

| Setting | Meaning |
|---|---|
| `allow_referral`, `allow_storefront` | Models 1 and 2 |
| `commission_percent` | For example 10%. The platform sets a maximum (for example 30%) |
| `funding` | `seller` (paid out of the seller's net) or `platform` (paid out of One Dream's commission). See section 5 |
| `allow_resale`, `resale_floor_usd`, `resale_ceiling_usd` | Model 3. The floor is the least the seller accepts; the ceiling is optional |
| `fulfilment` | `seller` for now; `reseller` comes later |
| `approval` | `auto` (anyone can join) or `manual` (the seller approves each partner) |
| `creative_rules` | Which presentation changes are allowed: own photos and video, own description, or bundles. Specs, warranty, delivery terms and availability are always locked to the seller's listing |
| `min_partner_rating`, `regions`, `starts_at`, `ends_at` | Optional limits |
| `terms_version` | Fixed on every membership, so a change to the terms never changes a deal already agreed |

Categories with extra rules (professional services, property, travel, regulated goods) can turn resale off or require admin approval. This is set per category, so no category is hard-coded.

A partner **joins** an offer, which creates a membership: requested, approved, rejected or revoked. A reseller membership also stores the partner's chosen price, checked against the floor and ceiling.

## 5. The money in each model

Worked examples with the live 5% platform commission, a $40 listing and a 10% offer. The buyer service fee (1%, $1 cap) is charged to the buyer as it is today and is left out of these numbers.

**Model 1 or 2, seller-funded:**

| | Amount |
|---|---|
| Buyer pays | $40.00 |
| Platform commission (5%) | $2.00 |
| Partner commission (10%) | $4.00 |
| Seller receives | $34.00 |

**Model 1 or 2, platform-funded.** The partner gets a share of One Dream's own commission instead, for example 40% of $2.00, which is $0.80. The seller receives $38.00 as normal. This changes no seller payouts, so it can launch first. It is small, which makes it suited to launch promotions.

**These two are not the same product, and each has its own rules:**

| | Platform-funded | Seller-funded |
|---|---|---|
| Who pays | One Dream, from its 5% | The seller, from their net |
| Who sets the rate | Admin, as a share of the platform commission (at most 50% of it) | The seller, per offer (up to the platform maximum) |
| Budget | **Required.** A fixed monthly budget in `affiliate_settings`. When it runs out, new platform-funded attributions are recorded but earn nothing, and partners are told so in advance | Not needed: the seller is paying |
| Authorization | Admin turns it on per campaign or category | **The seller accepts the commission explicitly**: a checkbox showing the rate and an example ("on a $40 sale you receive $34"). The terms version and acceptance time are stored on the offer |
| Protected change | None | P1: seller earnings must deduct the commission |
| Shown to partner as | "Promotion bonus: One Dream pays" | "Seller commission: X%" |

An offer is one or the other, never both, so a sale can't be paid twice from two sources.

**Model 3, resale at $55 with a $40 floor:**

| | Amount |
|---|---|
| Buyer pays | $55.00 |
| Seller receives: floor less 5% | $38.00 |
| Reseller receives: $15 margin less 5% | $14.25 |
| Platform receives: 5% of $55 | $2.75 |

**Model 4:** a creative partner lists their service (for example "10 product photos, $25") as an ordinary marketplace service listing. The seller buys it through the **existing checkout**, so the existing escrow and seller earnings apply unchanged. An optional performance bonus is then a normal model 1 offer that the seller attaches to the products the partner promoted.

Rules for every model:
- Amounts are in USD cents and fixed on the attribution row when the order is made. Later changes to the offer or the price never change them.
- The commission is never more than the seller's net. A seller-funded offer is refused if the commission plus the platform commission would exceed the price.

## 6. Attribution and the earnings lifecycle

**Why the first draft was weak.** It sent attribution after checkout. If the buyer closed the browser or lost connection after paying, the commission was lost. I checked how checkout works today:
- **Paystack:** `cart-payment-intent.js` creates the Paystack reference on the server **before** the buyer pays. `cart-checkout.js` creates the orders when the buyer returns from Paystack.
- **USDT:** the transaction hash is known only after the buyer sends it, and it is posted to `cart-checkout.js`.

So there is a moment, before any money moves, when the payment reference already exists. Attribution is now tied to it.

**Attribution (Phase 1 still needs no checkout change):**
1. A partner link (`/r/<code>`) or storefront item opens the listing. The server records the click (link, item, a hashed visitor id, the time) and returns a signed attribution token. The app or website keeps it with the cart line.
2. **Before payment:** as soon as `cart-payment-intent` returns the Paystack reference, the client sends `POST /api/affiliate/intent { payment_ref, tokens }`. The server stores a pending intent. For USDT, the client sends the tx hash in the same call, just before it calls `cart-checkout`. **Closing the browser after paying no longer loses the commission.**
3. The buyer pays and checks out through the existing checkout. Nothing in it changes.
4. **On the server, without the browser:** a matching job runs every few minutes and daily. It joins pending intents to `catalogue_checkouts.payment_ref`, then to that checkout's orders. It creates an attribution only when all of these hold:
   - the token is genuine and within the attribution window (for example 7 days);
   - the item is one of that order's lines;
   - the click happened before the checkout;
   - the partner's membership is active;
   - the partner is neither the seller nor the buyer (email and account checks);
   - the order has no attribution yet. **One order earns one attribution: last click wins, and nothing stacks.**
5. If a check fails, there is no commission. The sale goes through normally either way.

**How the job proves the reference belongs to a real, paid order:**
- **Payment happened.** A `catalogue_checkouts` row is only written by `cart-checkout.js` **after** it has verified the charge with Paystack, or verified and claimed the USDT transaction on-chain. Matching an intent to that row means the payment is proven. An intent with no checkout row never earns anything and expires after the attribution window.
- **The right order.** The match is on `payment_ref`, which is unique on `catalogue_checkouts`. Commission is only created for orders with that `checkout_id`, and only for lines whose item is in the token.
- **The right amount.** Commission is worked out from the order's own `amount_usd`, which checkout took from what the buyer actually paid. It is never taken from the intent.
- **The buyer, not someone watching.**
  - A Paystack reference is created on the server and given only to the buyer's device, so a partner can't learn it.
  - A USDT transaction hash is public on-chain, so for USDT the intent must also carry the buyer's checkout email, and it must match `catalogue_checkouts.buyer_email`.
  - In both cases, the intent must come from the same visitor id as the click token.

  Otherwise a partner who saw a transaction on-chain could claim someone else's purchase.
- **One intent per reference.** A second intent for the same reference is refused, so a later claim can't replace the buyer's own.

**What can still be missed, and how we'll know:**
- If the intent call itself fails before payment, it is retried once, then the token stays on the cart line and is sent again with the next request.
- The partner dashboard and the admin page show **clicks → intents → attributed orders**. A gap between intents and attributed orders shows any losses.
- If losses turn out to matter, P5 (putting the token into the Paystack metadata that `cart-payment-intent` already writes on the server) makes attribution fully server-side. It is a small change to protected code and stays optional.

**A gap that already exists (not caused by this design):** the Paystack webhook ignores cart payments, and nothing reconciles a paid cart whose buyer never returns. In that case **no order is created at all**, so neither the seller nor the partner is credited. The production audit on 17 October found no such orphaned payments, but nothing prevents them.

**Proposed fix (P6, needs approval because it touches checkout):**
1. A job runs every 15 minutes and daily. It lists recent Paystack transactions whose metadata marks them as a cart payment, using the references `cart-payment-intent` created.
2. For each **successful** transaction with no `catalogue_checkouts` row, it runs the same server-side completion `cart-checkout.js` uses: the existing verification and the existing atomic `create_cart_checkout`, with the lines taken from the Paystack metadata. The orders it creates are identical to a normal checkout, idempotent by reference.
3. The buyer is emailed their order links (each order's `buyer_token`). Sellers see the order as normal.
4. The affiliate matching job then finds the checkout and credits any intent recorded before payment.

USDT carts are different. The cart lines live only on the buyer's device until they submit the transaction hash, so a transfer that is never submitted can't be turned into orders automatically. It needs manual support follow-up and is outside this proposal.

**Earnings states:** each attribution row moves through these states.

| Order event | Earnings state |
|---|---|
| Order `paid` | `pending` |
| `buyer_confirmed` | `held` for the hold period (for example 14 days; 30 days for card payments) |
| Hold ends, no dispute | `available` |
| Withdrawn | `paid` |
| `disputed` | `on_hold` |
| Refunded, or dispute lost | `reversed`. If the commission was already paid, the partner's balance goes negative and is recovered from future earnings |

A daily job moves rows between states from the order statuses. Every change is also written to an append-only `affiliate_ledger`, the same way the Dream Coins ledger works.

**Resale (Phase 2):** the reseller price has to be what the buyer pays, so checkout must charge the membership price instead of the listing price. This touches the protected checkout and quote code, and needs approval (section 10).

## 7. Referral rewards

| Event | Reward | Why |
|---|---|---|
| A partner refers a **new seller** | A one-off reward once that seller completes their first genuine delivered sale, or a share of One Dream's commission on that seller's sales for a limited time (for example 6 months) | Sign-ups alone are easy to fake |
| A partner refers a **new buyer** | A reward on that buyer's first completed purchase | The same reason |
| A partner promotes a **product** | Commission or resale margin on attributed sales only | It pays only for real sales |

**Referral and product commission are different contributions, so they are kept apart:**

| | Seller referral | Product commission |
|---|---|---|
| What the partner did | Brought a new seller onto One Dream | Brought a buyer to a specific product |
| Paid from | One Dream's commission only, never the seller | The offer's funding (seller or platform) |
| Lasts | A limited time after the seller joins (for example 6 months), or a one-off | Each attributed sale |
| Ledger source | `referral` | `affiliate` |

Rules that prevent paying twice:
1. **A partner never earns twice on the same order.** If the same partner both referred the seller and brought the buyer, they get the product commission only.
2. **Two different partners can each earn on one order**: A for recruiting the seller, B for selling the product. The referral share comes out of One Dream's commission, so the seller's payout doesn't change. The total paid out is capped by the **per-order platform budget**: the most One Dream pays from its own commission on one order, for example 50% of it.
3. A buyer referral pays once, on the buyer's first completed purchase, and is never added on top of a product commission on that order.
4. There is a monthly cap per partner and a global monthly budget for everything platform-funded.

The existing 50-tokens-per-vote merchant promise is retired for new activity.

## 8. Protections

1. **One inventory.** Partners reference `catalogue_items` and never copy them.
2. **Price rules.** The resale price must stay between the floor and the ceiling. Price changes are logged, and limited (for example one change a day).
3. **No commission without a completed sale.** Commission moves pending, then held, then available, then paid, and can be reversed. It is never paid on a click or a sign-up.
4. **Attribution is recorded on the server.** The server keeps the link, click, offer, item and order, so editing a URL parameter cannot earn anything.
5. **Accurate listings.** A partner's media and copy go through the existing moderation queue. Specs, warranty and delivery terms always show the seller's version.
6. **Fraud signals for admin review**:
   - the partner's and buyer's email, device or IP match;
   - unusually high conversion rates;
   - repeated refunds on attributed orders;
   - partners linked to the seller's own account.
7. **No change to payment code without approval.** Every point where the engine would touch a protected system is listed in section 10.

## 9. Proposed data model (additive migration, `supabase/add_affiliate_marketplace.sql`)

| Table | Purpose |
|---|---|
| `affiliate_partners` | `participant_id` (unique), optional `merchant_id` link to `referral_merchants`, handle, display name, bio, status, rating |
| `affiliate_settings` | Global limits: maximum commission %, hold days, attribution window, per-order budget, monthly caps |
| `affiliate_offers` | Per item: the models allowed, `commission_percent`, `funding`, resale floor and ceiling, fulfilment, approval mode, creative rules, terms version, status |
| `affiliate_memberships` | Partner × offer: status, `resale_price_usd`, terms version, approval time and who approved |
| `affiliate_creatives` | A partner's media and copy for a membership, using the existing Cloudinary and moderation pipeline |
| `affiliate_collections`, `affiliate_collection_items` | Storefront collections |
| `affiliate_links` | Short `code`, target (offer, collection or storefront), click count |
| `affiliate_clicks` | Link, item, hashed visitor, time |
| `affiliate_intents` | Payment reference, tokens, time. The matching job turns these into attributions |
| `affiliate_attributions` | `order_id` **unique**, partner, offer, model, gross, commission or margin, funding, status, `available_at` |
| `affiliate_ledger` | Append-only earnings events, with idempotency keys |
| `affiliate_referral_rewards` | Seller and buyer referral rewards: referred account, trigger order, amount, status |
| `creative_engagements` | Model 4: brief, seller, partner, the listing the service was bought through, deliverables, status |

The business rules live in SQL functions, as for Dream Coins: `affiliate_join_offer`, `affiliate_record_click`, `affiliate_attribute_order`, `affiliate_advance_earnings`, `affiliate_reverse_attribution`.

**API:**
- Partner and seller: `/api/affiliate/{offers, join, links, storefront, attribute, earnings}`.
- Seller only: `/api/affiliate/seller/{offers, memberships}`.
- Admin: `/api/admin/affiliate/*`.
- Public storefront: `/m/<handle>` in the web app.

## 10. Changes that touch protected systems (each needs your approval)

| # | Change | Needed for | What it touches |
|---|---|---|---|
| P1 | Take seller-funded commission off the seller's net in `seller_earnings_summary` | Seller-funded models 1 and 2 | Seller settlement |
| P2 | Add `affiliate` as a `participant_withdrawals.source`, with a payout queue | Paying partners | Withdrawals |
| P3 | Price checkout from the reseller membership, and split floor and margin | Model 3 | Checkout, quote, order creation |
| P4 | Add an affiliate destination for ads and boosts | Phase 3 | Advertising campaigns |
| P5 | Put the attribution token in the Paystack metadata that `cart-payment-intent` writes | Fully server-side attribution (optional, see section 6) | Payment intent |
| P6 | Reconcile paid carts whose buyer never returned | An existing gap, needed for both sellers and partners | Cart checkout |

Without any of these, Phase 1 can still launch with **platform-funded** commission, storefronts, links and attribution. Earnings would show as pending or available but not be withdrawable until P2 is approved.

## 11. Rollout

**Phase 1: Affiliate marketplace** (no protected changes; P1 and P2 by approval):
- Partner enrolment, including linking existing merchant accounts.
- Seller offers, a discovery page, joining offers, links, `/m/<handle>` storefronts and the creative upload flow.
- Click tracking, attribution after checkout, the earnings ledger and lifecycle.
- Partner and seller dashboards, and admin review.
- Model 4 creative services as ordinary service listings.
- Done when: 20 test orders are attributed correctly, every refund or dispute reverses its earnings, and no seller payout has changed (unless P1 is approved).

**Phase 2: Authorized reselling** (needs P3):
- Reseller price and approval, "Sold by / Fulfilled by" on listing and order pages, and split settlement.
- Agreements between seller and reseller covering returns and disputes.
- Later, reseller fulfilment.

**Phase 3: Growth** (needs P4):
- Boosts and ads for storefronts and affiliate links.
- Conversion analytics per partner and offer.
- Creative performance bonuses and partner tiers.

## 12. Provisional business rules and open decisions

**Provisional rules from the owner review. These are design inputs, not approval to implement:**

| Setting | Provisional decision |
|---|---|
| Default commission funding | **Seller-funded**, explicitly authorized per listing. This needs P1 before seller-funded commission can affect payouts |
| Platform-funded campaigns | Optional promotional campaigns, capped by One Dream, switched on by admin |
| Maximum seller commission | 30%, **configurable by admin** in `affiliate_settings` |
| Attribution window | 7 days initially |
| Earnings hold | 14 days after confirmed delivery. Longer where the payment risk calls for it (card chargebacks: 30 days) |
| Partner accounts | Existing registered merchants enrol and link their account. No new registration |
| Partner approval | Sellers approve partnerships where they require it: automatic or manual, per offer |
| New-seller referral reward | **A time-limited share of the platform commission**, not permanent lifetime earnings (closes the earlier open question) |
| Affiliate withdrawals (P2) | Built **only after a read-only audit** of the existing settlement and withdrawal system |
| Reseller pricing | Phase 2, authorized by the seller (P3) |
| Existing payment code | Strictly untouched until each change P1-P6 is separately authorized |

What this means for the order of work: seller-funded commission is the default, so **Phase 1 can record and show seller-funded earnings, but they only come out of seller payouts once P1 is approved.** Until then a seller-funded offer can be published and tracked in a "preview" state, and only platform-funded campaigns accrue.

**Still open:**
1. Approve P1 (seller-funded deduction), and when.
2. The length of the new-seller referral share (6 months suggested), and its rate.
3. The per-order platform budget and monthly caps for platform-funded campaigns.
4. The settlement and withdrawal audit, before P2.
5. Approve P6 (reconciling unreturned paid payments). It is an existing gap, worth fixing on its own. See Appendix A.

**Next step: approve or revise these rules.** No coding or payment changes start until then. The Phase 1 migration would then be written in the same isolated, tested way as Dream Coins, and still needs your approval before it runs.

## Appendix A. Attribution reliability audit (read only, 17 October 2026)

**Question:** does the existing order lifecycle give a secure, server-side point to record attribution, without changing protected payment code?

**Where orders are created today.** Only two server paths create orders, and both are protected:

| Purchase flow | Payment reference created | Order created by | Reference on the order |
|---|---|---|---|
| Cart, app/web app, Paystack | **Server**, before payment (`cart-payment-intent.js`, `CART_…`) | `cart-checkout.js` → `create_cart_checkout()`, when the buyer's client returns | `catalogue_checkouts.payment_ref` (unique) → orders via `checkout_id` |
| Cart, USDT | The buyer's wallet: the tx hash, known after sending | `cart-checkout.js`, when the client submits the hash | The same |
| Single listing, app/web app, Paystack | **Server**, before payment (`catalogue/create-payment-intent.js`, `ITEM_…`) | `verify-order.js`, when the buyer's client returns | `catalogue_orders.payment_ref` (unique index) |
| Single listing, website, Paystack | **The browser's Paystack popup**, known only in the popup's callback | `verify-order.js`, called by that callback | The same |
| Single listing, USDT | The tx hash | `verify-order.js` | The same, and `tx_hash` |

**Findings:**
1. **There is no existing server-side hook that carries attribution.** Orders don't store any referral field, and the Paystack metadata is fixed by the server: it includes the item and cart lines, but nothing from the client.
2. **A database trigger on `catalogue_orders` was considered and rejected.** It would run on the server, but it changes a protected table. A failure inside it would also roll back the buyer's order.
3. **The safe server-side point is a read-only matching job.** It joins affiliate intents to checkouts and orders by payment reference. It only **reads** orders, and every reference it matches already proves a verified payment.
4. **Where the reference exists before payment** (both app/web-app Paystack flows), the intent is recorded first. **Closing the app after paying doesn't lose attribution**, as long as the order is created.
5. **Where it doesn't** (the website's Paystack popup, and USDT), the intent goes in the same step as the order request. It can only be lost if that order request is lost too. Then there is no order to attribute, which is the gap in finding 6.
6. **The real reliability gap is orders that are never created, not missed attribution.** Every Paystack flow depends on the buyer's client coming back. The Paystack webhook acknowledges catalogue and cart payments but ignores them. So a buyer who pays and closes the app before returning leaves **a successful charge with no order**, and nothing reconciles it.
   - For **carts**, the lines are in the Paystack metadata, so the orders can be rebuilt automatically (P6).
   - For **single listings**, the metadata has the item but **not the buyer's name, email, phone or delivery address**. These orders can only be flagged for support to contact the buyer, unless the intent step also records those details.
7. **A guessed reference can't be used.** References combine a millisecond timestamp with 10-13 random base-36 characters. They are only returned to the buyer's device, and a second intent for the same reference is refused. Even so, the intent must also come from the visitor id on the click token.

**Conclusion:** Phase 1 attribution can be built **without changing protected code**, using pre-payment intents plus a server-side matching job. The remaining risk is the order-creation gap (finding 6). It affects sellers as much as partners, and P6 is the fix. Only P5, putting the token in the server-written Paystack metadata, would make attribution independent of the client. It stays optional.

## 13. One merchant account, separate ledgers, and Dream Coins

**Recommendation: one account, separate ledgers.** A merchant has one partner profile and one login, and can earn in several ways. Each way has its own ledger source, so each can be reported, held, capped and paused on its own:

| Source | Earned from | Status |
|---|---|---|
| `affiliate` | Product commission and resale margin | This framework |
| `referral` | Recruiting sellers and buyers | This framework |
| `creative` | Creative services | Already paid through ordinary marketplace orders |
| `gift_referral` | 10% of gifts received by recipients the merchant referred | **Proposed extension**, see below |

**Dream Coin gift revenue sharing is a separate, proposed extension, not a rejected idea.** The owner's model is 50% to the gift recipient, 40% to One Dream and 10% to the merchant who referred the **recipient**. The live system doesn't implement it yet: gifts currently give recognition points only. Whether and when to add it is the owner's decision.

The full proposal is in [DREAM_COINS_GIFT_REVENUE_SHARING.md](DREAM_COINS_GIFT_REVENUE_SHARING.md). It covers:
- an audit of the existing purchase, gift and referral records;
- a fixed earnings value per coin;
- coin lots, so refunds reverse the right gifts;
- holds;
- the merchant entitlement period;
- the payee and policy requirements.

**How it relates to this framework:**
- **The same merchant account.** `gift_referral` is one more ledger source next to `affiliate` and `referral`.
- **Kept apart from marketplace commission.** Gift referral is paid from gift revenue. Affiliate and referral commission are paid from marketplace sales. A merchant can earn both, but never from the same transaction.
- **The recipient's referrer** is read from `participants.referred_by_merchant_link_id`, which is set once at registration. This is the existing referral record, so nothing new is needed to know who referred whom.
- **Shared prerequisites:** P2 (payouts) and a fixed merchant withdrawal path are needed by both streams.
