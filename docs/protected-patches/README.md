# Protected changes (P1-P9)

**19 October 2026: every patch is applied in code** (owner: "execute all proposals"). P3, P5 and P6 no longer matched the checkout after P7, so they were rebased onto it by hand; P4 applied as written. All their SQL, with `fix_p8_p9_review.sql` and P7's activation, is bundled in `supabase/activate_all_2026_10_19.sql` (one transaction, 16 checks, tested in `scripts/test-multicurrency.mjs`). P1 is superseded by P8. P3 now works with multi-currency on: a reseller line is US-dollar only and refuses to share a cart with a listing in another currency. The `.diff` files below are kept as a record of the original proposals and no longer apply.

The diffs are generated against the current files. `git apply --check` passes for every one of them, and applied together in the order below they apply with `patch -p1` and bundle cleanly.

| # | What it does | Needed for | Protected code touched | Files |
|---|---|---|---|---|
| P1 | Takes seller-funded affiliate commission off the seller's wallet total | Seller-funded commission (the default funding model) | `seller_earnings_summary()`: the seller wallet and withdrawals | `P1_seller_funded_commission.sql` |
| P2 | **Not needed.** Partner and creator payouts use a new, separate payout queue (`payout_requests`) instead of `participant_withdrawals` | n/a | none | n/a |
| P3 | Checkout charges an authorised reseller's price and splits the floor from the margin | Reselling (model 3) at the reseller's own price | Cart pricing, payment intent metadata, order creation and the order table | `P3_reseller_checkout.sql`, `P3_reseller_checkout.diff` |
| P4 | Lets partners boost a listing they hold an approved partnership for | Boosts of affiliate listings. **Ads pointing to a storefront or `/r/` link already work with no change** | `ads_assert_publishable()`, campaign validation | `P4_partner_boosts.sql`, `P4_partner_boosts.diff` |
| P5 | The payment-intent routes record affiliate attribution themselves, using the reference they create | Attribution that doesn't depend on the buyer's device at all (optional) | `cart-payment-intent.js`, `create-payment-intent.js` | `P5_attribution_at_payment_intent.diff`, `P5_P6_client_cart_api.diff` |
| P6 | Stores the buyer's checkout details on the server when the payment reference is created, so a paid cart whose buyer never returns can be completed | Fixes a gap that already exists: paid cart, no order | `cart-payment-intent.js`, a new table | `P6_pending_checkouts.sql`, `P6_store_buyer_details_at_payment_intent.diff`, `P5_P6_client_cart_api.diff`, plus the built job `pages/api/admin/earnings/complete-unreturned.js` (inert until P6) |
| P7 | Multi-currency checkout: the buyer pays a stored quote (naira exactly by Paystack, other currencies in USDT at the quoted USD amount) and each order gets a frozen financial snapshot | Multi-currency listings (`docs/MULTICURRENCY_IMPLEMENTATION.md`) | `cart-payment-intent.js`, `cart-checkout.js`, `create-payment-intent.js`, `verify-order.js`, app cart; listings' `payment_methods` | `P7_multicurrency_checkout.diff`, `P7_client_cart_quote.diff`, `P7_multicurrency_checkout.sql` |
| P8 | The USD seller wallet leaves out naira-settled sales and naira withdrawals. **Includes and supersedes P1** | Must ship with P7 | `seller_earnings_summary()`, `participant_withdrawals` (new `currency` column) | `P8_usd_seller_wallet.sql` |
| P9 | Naira seller wallet and naira withdrawals through the existing manual withdrawal workflow | Paying out naira sales | New wallet functions; wallet API, admin withdrawals API and portal, app wallet | `P9_naira_seller_wallet.sql`, `P9_naira_seller_wallet.diff` |

## How to apply one

1. Confirm the target is unchanged:
   - `git apply --check docs/protected-patches/<file>.diff`;
   - for SQL, compare the live definition with `pg_get_functiondef(...)`.
2. Run the `.sql` part in Supabase. Each file says what to verify.
3. `git apply docs/protected-patches/<file>.diff`. Then deploy a preview, run `npm run test:earnings`, and test with one real order.
4. Turn on the matching switch in the admin portal (Partners & Payouts):
   - P1 → `seller_funded_settlement_enabled`;
   - P3 → `resale_checkout_enabled`;
   - P7 + P8 → **Currencies** tab, `listing_currencies_enabled` (refuses without P8, and asks the admin to type `P7_P8_APPLIED`).
   - P5, P6 and P9 have no switch. They take effect on deploy.

Order when applying several: **P5 → P6 → P3 → P8 → P7 → P9**. P3, P5, P6 and P7 all touch `cart-payment-intent.js` in different places. If P8 is applied, don't apply P1 separately.

## Impact and rollback

**P1**
- **Effect:** for each order with an accrued seller-funded attribution, the seller's wallet total is reduced by that commission.
- **Never deducted:** attributions recorded before P1 (`awaiting_seller_settlement`). Those sellers were paid in full.
- **Edge case:** if a seller withdrew everything before a late match, their available total can go negative. The existing withdrawal function then refuses further requests until it recovers.
- **Rollback:** re-run section 4 of `supabase/add_seller_earnings.sql`, then reverse any accrued seller-funded attributions.

**P3**
- **New order columns:** `resale_membership_id`, `resale_price_usd`, `resale_floor_usd`, `resale_platform_fee_usd`.
- **Settlement:** the seller's `seller_net_usd` becomes the floor less commission. The reseller's margin less commission is credited automatically (`affiliate_attribute_resale_orders`).
- **Visibility:** the floor is read on the server and never sent to buyers.
- **Rollback:** switch `resale_checkout_enabled` off. Cart lines with a reseller then show "This reseller offer is no longer available". Revert the diff and restore `create_cart_checkout` from `add_seller_earnings.sql`.

**P4**
- **Effect:** the partner pays for their own boost. The seller isn't charged, and the listing content doesn't change.
- **Rollback:** re-run `ads_assert_publishable` from `supabase/add_advertising.sql` and revert the diff.

**P5**
- **Effect:** best effort, and it never blocks payment. If it fails, the client-side intent (already built) still works.
- **Rollback:** revert the diff.

**P6**
- **Effect:** stores personal data (name, phone, address) on our server for up to 60 days.
- **The job:** `complete-unreturned` runs the existing `cart-checkout` handler, so payment verification and order writing are unchanged and idempotent.
- **Single listings:** not recoverable automatically. Their Paystack metadata has no buyer contact, so `GET /api/admin/earnings/orphans` lists them for support instead.
- **Rollback:** revert the diff and drop `catalogue_pending_checkouts`.

**P7**
- **Effect:** with the switch on, a cart holding a non-USD listing pays from a quote. Naira listings become Paystack-only and GBP, EUR and GHS listings USDT-only (activation SQL). **USD listings are untouched (19 Oct 2026): USD-only carts keep card and USDT without a quote.** Single-listing purchase of a non-USD listing is refused with "add it to your cart".
- **Payments already made:** a Paystack payment without `quote_id` (made before the switch) still completes the old way; an expired quote that was paid is honoured.
- **Not combined with P3:** keep `resale_checkout_enabled` off while listing currencies are on.
- **Rollback:** switch listing currencies off, revert both diffs, restore `payment_methods` (see the SQL file). Orders already frozen keep their snapshots.

**P8**
- **Effect:** naira sales stop counting in the USD wallet; only USD withdrawals count against it. Every existing withdrawal is USD, so today's balances don't change.
- **Rollback:** re-run section 4 of `supabase/add_seller_earnings.sql` (or P1). Only while no naira-settled order exists.

**P9**
- **Effect:** sellers can withdraw naira earnings in naira. The admin pays them by hand, exactly as today, and the portal shows the naira amount to pay.
- **Rollback:** revert the diff and drop the two functions. Pay or reject pending naira withdrawals first.

## Tests

`npm run test:earnings` covers:
- P1, by applying `P1_seller_funded_commission.sql` to the in-memory database;
- the P3 accounting, by simulating P3's order columns;
- `resaleSplit`, including cent-exact splits.

The P3, P5 and P6 code changes were applied to a copy and compile. They have no automated HTTP test, so a preview deployment with a real Paystack test payment is required before production.

`npm run test:earnings` also applies P8 and P9 to the in-memory database and tests the P7 helpers (`lib/quoteRules.js`). The P7 and P9 code was applied to a copy (stacked after P5, P6, P3 and P4) and bundles; the app compiles with both client diffs.
