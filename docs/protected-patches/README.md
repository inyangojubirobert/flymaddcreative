# Protected changes awaiting authorisation (P1-P6)

17 October 2026. **None of these is applied.** Each one touches protected payment code or data: Paystack, checkout, seller settlement or advertising. Apply them one at a time, and only with explicit owner approval.

The diffs are generated against the current files. `git apply --check` passes for every one of them, and applied together in the order below they apply with `patch -p1` and bundle cleanly.

| # | What it does | Needed for | Protected code touched | Files |
|---|---|---|---|---|
| P1 | Takes seller-funded affiliate commission off the seller's wallet total | Seller-funded commission (the default funding model) | `seller_earnings_summary()`: the seller wallet and withdrawals | `P1_seller_funded_commission.sql` |
| P2 | **Not needed.** Partner and creator payouts use a new, separate payout queue (`payout_requests`) instead of `participant_withdrawals` | n/a | none | n/a |
| P3 | Checkout charges an authorised reseller's price and splits the floor from the margin | Reselling (model 3) at the reseller's own price | Cart pricing, payment intent metadata, order creation and the order table | `P3_reseller_checkout.sql`, `P3_reseller_checkout.diff` |
| P4 | Lets partners boost a listing they hold an approved partnership for | Boosts of affiliate listings. **Ads pointing to a storefront or `/r/` link already work with no change** | `ads_assert_publishable()`, campaign validation | `P4_partner_boosts.sql`, `P4_partner_boosts.diff` |
| P5 | The payment-intent routes record affiliate attribution themselves, using the reference they create | Attribution that doesn't depend on the buyer's device at all (optional) | `cart-payment-intent.js`, `create-payment-intent.js` | `P5_attribution_at_payment_intent.diff`, `P5_P6_client_cart_api.diff` |
| P6 | Stores the buyer's checkout details on the server when the payment reference is created, so a paid cart whose buyer never returns can be completed | Fixes a gap that already exists: paid cart, no order | `cart-payment-intent.js`, a new table | `P6_pending_checkouts.sql`, `P6_store_buyer_details_at_payment_intent.diff`, `P5_P6_client_cart_api.diff`, plus the built job `pages/api/admin/earnings/complete-unreturned.js` (inert until P6) |

## How to apply one

1. Confirm the target is unchanged:
   - `git apply --check docs/protected-patches/<file>.diff`;
   - for SQL, compare the live definition with `pg_get_functiondef(...)`.
2. Run the `.sql` part in Supabase. Each file says what to verify.
3. `git apply docs/protected-patches/<file>.diff`. Then deploy a preview, run `npm run test:earnings`, and test with one real order.
4. Turn on the matching switch in the admin portal (Partners & Payouts):
   - P1 → `seller_funded_settlement_enabled`;
   - P3 → `resale_checkout_enabled`.
   - P5 and P6 have no switch. They take effect on deploy.

Order when applying several: **P5 → P6 → P3**. They all touch `cart-payment-intent.js` in different places.

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

## Tests

`npm run test:earnings` covers:
- P1, by applying `P1_seller_funded_commission.sql` to the in-memory database;
- the P3 accounting, by simulating P3's order columns;
- `resaleSplit`, including cent-exact splits.

The P3, P5 and P6 code changes were applied to a copy and compile. They have no automated HTTP test, so a preview deployment with a real Paystack test payment is required before production.
