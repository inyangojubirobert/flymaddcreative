# How payments work — One Dream / FlyMadd Creative

_Last updated 2026-10-11. Covers the website and the mobile app; both clients use the same API (`pages/api/**`) and the same Supabase database._

---

## 1. The short version

- **US dollars are the base currency.** Listing prices (`price_usd`), the **$2 vote**, AI plans and every marketplace charge are set and recorded in USD.
- **Other currencies are conversions at payment time.** Today that means:
  - **Paystack** charges **naira**. The server converts the USD amount to NGN at a live rate when it creates the charge.
  - **USDT** on BSC (BEP-20) or Tron (TRC-20) is paid in dollars, so there's no conversion.

  Adding another fiat rail later means adding a conversion. Prices and fee settings stay as they are.
- **The server always decides the amount.** Clients send ids and quantities, never prices. After payment, the server re-verifies with Paystack, or on-chain, before anything is credited or created.
- **Marketplace money is held in escrow per order.** The buyer confirms delivery, then the seller releases the funds.
- **Buyer service charge on cart purchases:** a percentage of the items with a USD cap (default 1%, capped at $1.00). It's set in the database and charged only when a purchase completes.

---

## 2. Currency conversion

`lib/currency.js` is the only place USD becomes NGN.

| Step | What happens |
|---|---|
| Rate source | Live USD to NGN from `open.er-api.com` |
| Cache | Kept in memory and in the `exchange_rates` table for 30 minutes, so cold starts don't hit the API |
| Fallbacks, in order | Last DB rate, then last memory rate, then a hardcoded last-resort rate |
| Helpers | `usdToNgn`, `usdToKobo` (Paystack wants kobo, i.e. ₦ × 100), `ngnKoboToUsd` |
| Rate lock | The rate used for a charge is recorded with the charge. Verification checks the paid amount against **that** rate, so a rate change between paying and verifying never fails a legitimate payment. |

The rate is also stored on each order and payment (`exchange_rate`, `amount_ngn`) for accounting.

---

## 3. Payment flows

### 3.1 Votes ($2 per vote)

Votes are credited in **one place only**: `lib/voteCredits.js`, called from `POST /api/onedream/vote` and the Paystack webhook. Votes come from **what was actually paid**. The `vote_count` and amount the client sends are ignored.

| Rail | Flow |
|---|---|
| **Paystack** | `create-payment-intent` converts the USD price to NGN at the live rate and **records the intent** in `payments` (participant, votes, exact kobo, rate, `status = 'initialized'`). After checkout, `vote.js` verifies the charge with Paystack against that record, then credits. |
| **USDT** | The buyer sends USDT to the platform wallet. `verify-usdt-payment` (app) or `finalize-payment` (website) confirms the transfer on-chain without crediting anything. Then `vote.js` re-verifies it (`lib/verifyCryptoTx.js`: correct token, our wallet, enough confirmations), claims it in the USDT registry, and credits `floor(amount ÷ $2)` votes. |
| **Webhook** | `paymentWebhook` (signed Paystack `charge.success` only) credits through the same path, as a backstop if the buyer closes the browser early. |

Guarantees:
- **Each payment is credited once.** `payments.payment_intent_id` is unique. A conditional status change (`initialized`/`verifying` → `crediting` → `succeeded`) lets exactly one request credit, so retries, the webhook and the browser can't double-credit.
- **Each payment credits the participant it was made for.**
- **A transaction that's still confirming** returns HTTP 425. The website keeps retrying for about 3 minutes.

### 3.2 Marketplace — one listing
| Step | Route |
|---|---|
| Website | Paystack inline popup, then `POST /api/catalogue/verify-order` |
| App | `POST /api/catalogue/create-payment-intent`, then Paystack hosted checkout, then `verify-order` |
| USDT | Buyer submits the tx hash to `verify-order` (verified on-chain and claimed in the USDT registry) |

This flow has **no service charge** yet (see §5.3).

### 3.3 Marketplace — cart checkout (mobile app)

**Buyer experience**
1. Each listing card in the shop, a category or a seller's shop has a round **add-to-cart checker**. Buyers can tick listings from any number of sellers (up to 20 listings, up to 99 of each).
2. A **lemon-green floating cart** sits against the right edge of the screen and shows the item count and running total. Tapping it opens **`/shop/cart`**.
3. The cart page groups items **by seller**, with seller profile links, quantity steppers and remove buttons. It then shows:

   ```
   Items (4)                        $40.00
   Service charge                    $0.40
     1% of items, capped at $1.00 (≈ ₦1,500)
   ───────────────────────────────────────
   Total                            $40.40
   Paystack charges ₦60,600 at today's rate of ₦1,500 per $1.
   ```
   The naira figures appear only when Paystack is selected.
4. The buyer pays **once**, by Paystack or a single USDT transaction, for the whole cart.
5. The success screen shows one order per listing, each with *Received / Issue / Copy link / Message seller* buttons.

**Under the hood**

| Route | Purpose |
|---|---|
| `POST /api/catalogue/cart-quote` | Prices the cart from live listings: USD subtotal, service charge and total, the NGN conversion, accepted payment methods, and any unavailable lines |
| `POST /api/catalogue/cart-payment-intent` | Re-prices the cart and creates **one** Paystack charge. The priced lines go into the Paystack metadata, which only the server can set. |
| `POST /api/catalogue/cart-checkout` | Verifies the payment, then calls `create_cart_checkout()`, which writes the checkout and every order **in one database transaction** |

Design points:
- **Escrow is unchanged.** Each listing becomes its own `catalogue_orders` row with its own `buyer_token`, so confirm, dispute and release (`order-action.js`) work per seller.
- **Sellers never hold the service charge.** Each order's `amount_usd` covers only that listing. The service charge lives on `catalogue_checkouts.service_fee_usd`.
- **The fee policy is recorded with each payment** (`fee_percent`, `fee_cap_usd`), so editing the settings never changes past orders.
- **All or nothing.** Either the buyer gets all their orders or nothing is written, and the same reference can be retried safely.
- **No double charge on failure.** If confirmation fails after paying, the app offers *Retry confirming payment* with the same reference instead of a new charge.
- **Idempotent.** A retry returns the same orders, but only to the same buyer email.
- **One USDT transfer pays for one thing.** `usdt_payments.consumed_for / consumed_ref` is a shared registry, claimed atomically via `claim_usdt_payment()`. Votes, single-listing orders and carts all claim through it.
- **Price changes.** If a listing changes while in the cart, the quote flags it and payment is blocked until the buyer reviews the cart.

### 3.4 AI subscriptions
Paystack subscriptions (priced in USD and converted via `lib/currency.js`) or Google Play billing (`lib/aiPayments.js`). They have their own webhook and aren't affected by marketplace fees.

### 3.5 Withdrawals
Participant and merchant withdrawals are balance-checked server-side with atomic SQL functions. A participant's withdrawable balance today comes from **votes** only. Releasing marketplace escrow (`status = 'released'`) **doesn't credit any balance**; seller payouts for sales are handled manually. See §5.

---

## 4. Configuration

### Fees — in the database
Edit **`marketplace_fee_settings`** (one row, `id = 1`) in Supabase. The API picks up changes within a minute, and no redeploy is needed.

| Column | Default | Meaning |
|---|---|---|
| `buyer_fee_percent` | `1` | Buyer service charge, % of the item subtotal. `0` turns it off. Max 20. |
| `buyer_fee_cap_usd` | `1.00` | Maximum service charge in USD. `null` = no cap. |
| `seller_commission_percent` | `5` | Planned seller commission. **Not deducted yet** (needs the seller earnings ledger, §5.3). |

The quote, the charge and the verification all read the same policy (`lib/marketplaceFees.js`), so what a buyer sees is what they pay. If the table can't be read, the defaults above apply.

### Server environment (Vercel)
| Variable | Purpose |
|---|---|
| `PAYSTACK_SECRET_KEY` | All Paystack calls and webhook signature checks |
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | Server-side DB access (never shipped to clients, which use the anon key) |
| `CRYPTO_WALLET_ADDRESS_BSC`, `CRYPTO_WALLET_ADDRESS_TRON` | Wallets USDT payments must be sent to |

### Migrations
Run these in the Supabase SQL editor. Check that each one's final verification query returns `ok = true` on every row, because the editor doesn't always apply a pasted script atomically.
1. `supabase/add_cart_checkout.sql`: cart checkout, the USDT registry, and the atomic checkout function. **Applied 2026-10-11.**
2. `supabase/add_marketplace_fee_settings.sql`: the fee settings table, plus `fee_cap_usd` on checkouts.

---

## 5. Pricing plan & recommendations

### 5.1 Approach
Charge early, but charge for **completed value**, keep it **visible**, and **measure** the effect:
- **A capped percentage beats a flat fee.** It scales fairly across basket sizes, and the cap protects big baskets.
- **The fee is charged only on a completed purchase**, never for browsing or adding to cart.
- **The fee appears as its own line before payment.**

### 5.2 What the numbers look like

Illustrative, at **₦1,500 = $1**. Charges are in USD, and naira is shown because Paystack settles in naira.

| Purchase | Items | Buyer fee (1%, cap $1) | Paystack fee* | Platform net **without** commission | **With** 5% seller commission |
|---|---|---|---|---|---|
| Small | $2.00 (₦3,000) | $0.02 (₦30) | ₦145 | **−₦115** | +₦35 |
| Typical | $10.00 (₦15,000) | $0.10 (₦150) | ₦327 | **−₦177** | +₦573 |
| Large | $100 (₦150,000) | $1.00 capped (₦1,500) | ₦2,000 (capped) | **−₦500** | +₦7,000 |

\*Paystack local cards: roughly 1.5% + ₦100 (₦100 waived under ₦2,500), capped at ₦2,000. Check current Paystack pricing. USDT has no processor fee for us; the buyer pays network gas.

**Key point:** the platform absorbs Paystack's fee. A 1% buyer fee alone doesn't cover it, so the **seller commission** is what makes each sale profitable. The buyer fee mainly tests willingness to pay.

### 5.3 Roll-out

| # | Step | Status |
|---|---|---|
| 1 | Buyer service charge on cart checkouts, set in the database | ✅ Built |
| 2 | Same charge on **single-listing checkout**, so buying one item isn't a way around it. This changes the live website checkout too (or the website's Buy button goes through the cart). | Next |
| 3 | **Seller commission (5%)**, taken at escrow release | Needs the seller earnings ledger (below) |
| 4 | **High-value and professional services:** a checkout ceiling (e.g. $2,000), and a quote → milestone-escrow flow above it | Design needed |
| 5 | **Measure** cart-to-paid conversion, average basket and abandonment at the summary step | Add analytics events |

**Seller commission — prerequisites**
1. A `seller_earnings` ledger. On release, credit `amount_usd × (1 − commission)` and record the commission separately. Refunds write reversing entries, and the ledger is reconciled against the funds actually held (Paystack balance and the USDT wallet).
2. Record the commission % **on each order at purchase time**.
3. Make the seller's withdrawable balance include released sales.
4. Tell sellers before it applies: show "You'll receive $X" on the listing form and in the order view, and apply it only to orders placed after the announced date.

### 5.4 Decisions

| Decision | Recommendation |
|---|---|
| Seller payouts: automatic or manual? | **Manual approval for now**; automate once the ledger and reconciliation exist |
| Exchange-rate fallback | Refuse to charge if no rate is newer than about 24 h, instead of using the hardcoded last-resort rate |
| Service charge on partial refunds | Record each order's share of the fee when the order is created, and refund that share when *that* order is refunded because of the seller |
| When fees count as revenue | **Pending** until the order is released, realised only then. Refunds reverse the pending amount. |

**Other notes**
- **Consider a minimum basket for USDT** (around $5): gas can exceed the value of tiny orders.
- **Featured listings and listing fees** don't exist in the codebase yet. They'd need designing if wanted as revenue lines.

---

## 6. File map

| Area | Files |
|---|---|
| Conversion | `lib/currency.js`, `pages/api/exchange-rate.js` |
| Fee policy | `lib/marketplaceFees.js` (+ `marketplace_fee_settings` table) |
| Vote crediting | `lib/voteCredits.js`, `pages/api/onedream/vote.js`, `create-payment-intent.js`, `verify-usdt-payment.js`, `finalize-payment.js`, `paymentWebhook.js` |
| Cart pricing | `lib/catalogueCart.js` |
| Cart routes | `pages/api/catalogue/cart-quote.js`, `cart-payment-intent.js`, `cart-checkout.js` |
| Single-listing routes | `pages/api/catalogue/create-payment-intent.js`, `verify-order.js` |
| Escrow actions | `pages/api/catalogue/order-action.js` |
| USDT verification | `lib/verifyCryptoTx.js` |
| Callback allow-list | `lib/paystackCallbackUrl.js` |
| Migrations | `supabase/add_cart_checkout.sql`, `supabase/add_marketplace_fee_settings.sql` |
| App — cart | `mobile/src/contexts/CartContext.tsx`, `mobile/src/api/cart.ts`, `mobile/src/components/floating-cart.tsx`, `listing-card.tsx`, `mobile/src/app/shop/cart.tsx` |
