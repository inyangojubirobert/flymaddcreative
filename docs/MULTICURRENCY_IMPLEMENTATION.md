# Multi-currency listings

17 October 2026. Status: **migration and review fixes applied in production; P7 (checkout) and P9 (naira wallet) code applied and deployed; P8/P9 SQL to be run by the owner; switched off.** The database migration, listing UI and APIs are independent of the payment code. Checkout, settlement and withdrawals are the protected patches P7–P9 in `docs/protected-patches/`. None of them is applied.

## The rules

1. **The seller chooses the currency of each listing.** The price they type is stored exactly, in that currency's minor units (kobo, cents, pence). It is never converted or rounded.
2. **Naira listings:**
   - paid by Paystack in naira;
   - the exact listed amount is charged, with no conversion;
   - they settle in naira.
3. **Every other currency** (USD, GBP, EUR, GHS, and any added by an admin):
   - paid in USDT at the US-dollar value;
   - they settle in US dollars.
4. **The rate is fixed in a quote** before the buyer pays:
   - a naira quote is valid for 15 minutes, and a USDT quote for 60;
   - the order keeps a frozen snapshot with the rate, its source, its publish time, the charged amount, the commission and the seller's earnings;
   - later rate changes never alter an order.
5. **One checkout is in one currency.** A cart mixing naira listings with other currencies is refused, and the reply lists the groups so each can be checked out separately.
6. **The checkout currency is the payout currency.**
   - Naira sales go to a naira wallet and are withdrawn in naira.
   - Every other sale goes to the USD wallet.
   - Affiliate commission on a naira sale is owed and paid in naira.
7. **Google Play products don't change.** Digital products, Dream Coins and gifts are refused by the quote API.
8. **All money maths uses integers (BigInt):**
   - rates are scaled by 10¹²;
   - rounding is half-up, applied once per line;
   - commission + seller earnings = charged amount, exactly. A database check enforces this.

Owner's example: a £100 listing with 1 USD = 0.7692 GBP (£1 = $1.30) becomes:
- 130.00 USDT;
- 6.50 commission (5%);
- 123.50 to the seller, in USD.

This is a test in `scripts/test-multicurrency.mjs`.

## What is built (independent of payments)

| Part | Files |
|---|---|
| Migration | `supabase/add_multicurrency_listings.sql`. Rollback: `supabase/rollback_multicurrency_listings.sql` |
| Money maths (pure) | `lib/currencyRules.js`, `lib/quoteRules.js` |
| Rates, quotes, settings | `lib/marketplaceCurrency.js`. The checkout glue for P7 is `lib/quoteCheckout.js` (not imported by any live route) |
| Public APIs | `GET /api/marketplace/currencies`, `POST /api/marketplace/quote`, `PATCH /api/marketplace/listing-price`, `GET /api/marketplace/seller-earnings` |
| Admin | `/api/admin/currency` and the admin portal tab **💱 Currencies**: currencies, rates, refresh, settings, the switch, quotes and snapshots |
| Daily rates | `vercel.json` cron → `/api/admin/currency` at 03:05 UTC, authorised with `CRON_SECRET` |
| App | Currency picker in My Listings; "≈ $X (approximate)" and the payment route under a listing's price; non-USD listings route to the cart; per-currency balances in Earnings |
| Earnings ledger | `currency` on `partner_ledger`, `affiliate_attributions`, `referral_rewards`, `payout_requests`. Partner balances and payout requests are per currency |

### Database objects

**Tables:**
- `marketplace_currencies`: code, minor units, route and settlement. Each currency's route is enforced by a constraint: NGN ↔ Paystack/NGN, everything else ↔ USDT/USD.
- `currency_settings`: the switch, quote lifetimes, the maximum rate age and the maximum rate jump.
- `currency_rates`: history, with the provider's publish time.
- `checkout_quotes`.
- `order_financial_snapshots`: append-only.

**Columns:** `catalogue_items.listing_currency` (default USD) and `listing_price_minor`. A trigger keeps USD listings' minor price in step with `price_usd`, so existing listing edits keep working.

**Functions:**
- `order_money(order)`: an order's money in its settlement currency.
- `seller_earnings_by_currency(username)`: read-only.

The existing `exchange_rates` table, used by the current Paystack conversion in `lib/currency.js`, is untouched.

### Rates

The provider is open.er-api.com (free, no key, published once a day).

**Each fetch:**
- stores the provider's own publish time;
- refuses a rate that moved more than 15% since the previous one. The admin sees why and can refresh again.

**Quotes refuse:**
- a rate older than 26 hours (`rate_stale`);
- a missing rate (`rate_unavailable`). There is never a hardcoded fallback.

**Naira needs no rate to be charged.** The NGN rate is used only to:
- convert the USD service-charge cap;
- record the USD equivalent for reports.

**Limitation:** the free source publishes once a day. For tighter rates, a paid source with intraday updates can replace `refreshRates()` without other changes.

## Review fixes (`supabase/fix_multicurrency_review.sql`)

Run after the migration. It is idempotent.

1. **Naira payout minimum:** converted at a fresh NGN rate (within `max_rate_age_seconds`) and rounded up. With no fresh rate the request is refused with `rate_unavailable`; the earlier fallback to a rate of 1 is removed. Only USD and NGN are accepted.
2. **Ledger moves:** the debit and the credit both post, or the transaction rolls back (`ledger_move_credit_not_posted`). A replay is accepted only if both halves exist. Negative amounts are refused; zero is still a no-op.
3. **Resale:** reseller commission is computed only for USD-settled orders. A resale order in another currency is recorded as awaiting, with no commission. Resale offers must be in USD.
4. **Snapshots and quotes:**
   - a snapshot needs a real order and a paid quote;
   - every figure must equal that quote's line for the order's listing, and the order's checkout must carry the quote's payment reference;
   - currencies must be consistent: route and settlement follow the listing currency, and a rate is present exactly when the price was converted;
   - one snapshot per order;
   - quotes can't be changed after creation, and a payment reference binds only once.

The replaced functions run against the full earnings, gifting and affiliate test suite (72 tests). In production all ledger, payout, attribution, quote and snapshot tables were empty and every money switch was off when this was written.

## While the switch is off (now)

- Sellers can only list in USD. Other currency chips are shown but disabled, and `listing-price` refuses non-USD with 403.
- Checkout, order creation and the seller wallet behave exactly as before. Quotes can be requested but nothing charges from them.
- With no quote, every order is USD. `order_money()` falls back to the existing USD columns.

## Protected patches awaiting approval

**P7: multi-currency checkout.**
- Files: `P7_multicurrency_checkout.diff` (server), `P7_client_cart_quote.diff` (app cart) and `P7_multicurrency_checkout.sql` (activation).
- `cart-payment-intent.js`:
  - with the switch on, requires an open, unexpired Paystack quote for exactly the cart being paid;
  - charges `quote.total_minor` kobo;
  - binds the Paystack reference to the quote, once;
  - puts `quote_id` in the metadata.
- `cart-checkout.js`, Paystack branch:
  - a quote payment must carry that quote's reference and the exact naira total;
  - an expired quote is honoured, because the buyer has already paid.
- `cart-checkout.js`, USDT branch:
  - the quote must be open when the transaction is first submitted;
  - the quote is then bound to the transaction, so retries while it confirms keep the same price;
  - the transfer must cover the quote total, with the same 1-cent tolerance as today.
- Order rows:
  - built by the existing code, then given the quote's figures;
  - USD-route lines are exact USD;
  - naira lines carry USD equivalents in the legacy columns, plus `amount_ngn` and `currency 'NGN'`.
- After the existing atomic write, each order gets its frozen snapshot. A retry completes a snapshot an earlier attempt missed.
- `create-payment-intent.js` and `verify-order.js` (single listing, and the website popup) refuse non-USD listings with "Add this listing to your cart".
- App cart:
  - fetches the quote and shows it in its currency, with each conversion rate and its publish date and the time the price is held;
  - pays with `quote_id`;
  - refreshes the quote before it expires, but never while a payment from it is being confirmed;
  - shows the mixed-currency message.
- Activation SQL: every non-naira listing becomes USDT-only and naira listings become Paystack-only. **The two existing production listings (USD, Paystack + USDT) become USDT-only.** Tell those sellers first.

**P8: the USD seller wallet leaves out naira sales.** File: `P8_usd_seller_wallet.sql`.
- `seller_earnings_summary()` excludes orders whose snapshot settles in NGN, and counts only USD withdrawals.
- It adds `participant_withdrawals.currency` (default USD).
- It **includes P1** (the seller-funded affiliate deduction). That is safe whether or not P1's switch is ever turned on, because nothing accrues seller-funded while it is off. If P8 is approved, P1 is not applied separately.
- **P7 and P8 must ship together.** Without P8, naira sales' USD equivalents would be withdrawable as dollars. The admin switch refuses to turn on unless P8's column exists and the admin types `P7_P8_APPLIED`.

**P9: the naira seller wallet.** Files: `P9_naira_seller_wallet.sql` and `.diff`.
- `seller_earnings_summary_ngn()` and `request_seller_withdrawal_ngn()`. The latter uses the same row lock and immediate reservation as the USD one.
- Naira withdrawals use the **existing manual withdrawal workflow**: method and bank details, admin approves and marks paid. There is no new payout rail.
- The row stores `currency 'NGN'` and `amount_ngn` (authoritative), plus a USD equivalent for totals and alerts.
- The diff touches four places:
  - the wallet API returns a `naira` block and takes `currency: 'NGN'`;
  - the admin withdrawals API selects the new columns;
  - the admin portal shows "PAY ₦…" for naira withdrawals;
  - the app wallet shows naira earnings, sales in naira and a naira withdrawal form.
- P9 can follow P7/P8 later. Until it ships, naira earnings are counted (`GET /api/marketplace/seller-earnings` returns them per currency) but can't be withdrawn, and the app wallet doesn't show them yet.

**Order:** P8 → P7 (diff + client) → P7 SQL → switch on → P9. With P5, P6 and P3, apply P5 → P6 → P3 first. All patches were applied stacked to a copy in that order and bundle cleanly. Each also applies on its own (`git apply --check`).

**Not combined:** P3 reseller prices and quotes. A quote prices a listing at the seller's price. Reseller checkout stays on USD listings, and P3's switch should stay off while listing currencies are on until P3 is extended to quotes.

## Tests

`npm run test:earnings` runs 72 tests, including `scripts/test-multicurrency.mjs` (17). They cover:
- exact minor units;
- the £100 example;
- naira charged exactly, with the fee cap;
- combined USD, GBP and GHS lines;
- zero-decimal currencies;
- mixed carts refused;
- stale, invalid, jumping and missing rates;
- display equivalents;
- the migration applying on top of the existing tables;
- the USD price sync trigger;
- the snapshot append-only and sum constraints;
- earnings per currency;
- naira affiliate commission and naira payouts (not withdrawable as dollars);
- the P7 helpers (order fields, checkout record totals, Paystack exactness, the USDT tolerance, line matching, buyers never seeing seller earnings);
- P8 + P9 applied to the in-memory database (naira sales out of the USD wallet, a naira withdrawal reserved in naira, the USD wallet untouched);
- the rollback (refuses while naira money exists; on a clean database it restores the previous functions and can be re-applied).

The P7 route changes compile and bundle, and the app compiles with them (`tsc`). They have no automated HTTP test. Before production, a preview deployment needs:
- one real Paystack test payment for a naira listing;
- one USDT test transfer for a GBP listing.

## Activation checklist

1. Owner approval for P7, P8 and P9, each separately.
2. Apply `add_multicurrency_listings.sql`. Check its verification rows. Refresh rates in the admin portal and confirm NGN, GBP, EUR and GHS are present.
3. Apply P8. Deploy P7 (server + app). Run the P7 SQL. Tell the two existing sellers that their USD listings are now paid in USDT.
4. Preview test: naira listing → Paystack, exact naira; GBP listing → USDT at the quoted amount; mixed cart refused; snapshots in the admin tab.
5. Switch listing currencies on (admin portal → Currencies).
6. P9 when ready: naira withdrawals.

Rollback: switch off first. `rollback_multicurrency_listings.sql` refuses once any naira money or snapshot exists.
