# Dream Coins, Virtual Gifts & Marketplace Recognition: Implementation Report

17 October 2026. Branch `web-app-apk-parity-ad-tiers`. Companion: [DREAM_COINS_POLICY_READINESS.md](DREAM_COINS_POLICY_READINESS.md).

**State (17 October 2026):** migration applied and verified in production; API and web app deployed; the seven Play products are created but **inactive**, with multi-quantity off. Coin sales stay off until `DREAM_COINS_ENABLED=true`. The Android APK with the new screens is not built yet.

## 1. Repository audit (Phase 1)

| Area | Finding | Reused? |
|---|---|---|
| Billing library | `react-native-iap` 14.7.0 (Nitro) on openiap-google 1.3.21, which uses **Play Billing Library 8.3.0** | Yes, through the same `useIAP` / `getAvailablePurchases` pattern as `promo-billing.tsx` |
| One-time purchase verification | `lib/adsGooglePlay.js` provides `getProductPurchase`, `consumeProductPurchase` and `getPlayProductStatus` | **Imported, not modified.** Its `evaluateProductPurchase` refuses quantity ≠ 1, so coins use their own evaluator |
| Credentials | `lib/aiPayments.js` provides `getGooglePlayAccessToken` and `GOOGLE_PLAY_PACKAGE_NAME` | Imported, not modified |
| RTDN | `pages/api/onedream/ai-subscription/google-play-notification.js` handles **subscription notifications only** and ignores one-time products | Not used. See blocker B1 |
| Refund reconciliation | Daily voided-purchase crons for ads and digital products | The same pattern is used for a new coins cron. Ads/digital crons are unchanged and ignore coin tokens |
| Orders and delivery | `catalogue_orders.status`: `paid → buyer_confirmed → released`, or `disputed`. Buyers are guests, proven by `buyer_token` | Read only, for the "verified buyer" thank-you |
| Seller profiles | `participants` (username), `participant_profiles` | Read only |
| Merchant referrals | `participants.referred_by_merchant_link_id`, `merchant_referral_*` tables. Merchants are a separate account system | Not wired yet. The programme shows "coming soon" (`not_tracked`) instead of guessing |
| Affiliate tracking | **None exists** | Programme seeded inactive |
| Admin | `public/admin-portal.html` with `lib/adminAuth.js` `requireActiveAdmin` | New "Gifts & Rewards" tab. Same auth, no parallel identity system |
| Participant auth | `lib/participantAuth.js` `requireParticipant` | Yes |
| Wallets / ledgers | Vote and marketplace wallets (participants, withdrawals, seller earnings) | **Not touched.** Dream Coins have their own isolated ledger |

### Multi-quantity report

1. **Does the installed library support multi-quantity?** Yes. Play Billing 8.3.0 supports it (4.0+), and `react-native-iap` returns `purchase.quantity` on Android.
2. **Can the app request a specific quantity programmatically?** No. Google's Billing Library has no such parameter on Android, and `RequestPurchaseAndroidProps` has none (`quantity` exists for iOS only). When multi-quantity is enabled in Play Console, the buyer chooses the quantity in Google's purchase sheet. No API parameter was invented, and the app never launches several transactions to simulate quantity.
3. **Does Google provide the authoritative quantity?** Yes. `purchases.products.get` returns `quantity` (absent means 1) and `refundableQuantity`. Voided purchases with `includeQuantityBasedPartialRefund=true` return `refundType` and `voidedQuantity`.
4. **Can existing verification be reused unchanged?** Partly. The Google calls are imported as they are. The quantity-1 rule and the voided-purchase listing (which lacks the partial-refund flag) could not be reused, so coins have their own versions in new files.
5. **New files and tables:** see sections 2 and 9.
6. **Is a native build needed?** No new native module is needed. `react-native-iap` is already in the APK, and the coin store needs only JS changes. The new screens ship with the next APK and web export.
7. **Limitations:** quantity cannot be pre-selected. The maximum quantity per purchase is set in Play Console (the server accepts 1-1000). One-time-product RTDN is not handled (B1). The 15% Play service fee applies.

## 2. Database (`supabase/add_dream_coins_gifting.sql`)

The migration is additive and server-only (RLS on, no policies, no client-role grants). It touches no existing table.

| Table | Purpose |
|---|---|
| `dream_coin_packages` | The 7 packages: product id, `coins_per_unit`, reference price (planning only), active flag |
| `dream_coin_purchases` | One row per purchase token (unique): verified quantity, coins_per_unit snapshot, `total_coins = quantity × coins_per_unit` (check constraint), consumption state, reversed quantity |
| `dream_coin_balances` | Integer balance, lifetime totals, gifting suspension |
| `dream_coin_ledger` | **Append-only** (trigger). Every credit, debit, reversal and correction, with a unique idempotency key and `balance_after` |
| `virtual_gift_catalogue` | Admin-managed gifts: name, emoji or image, coin cost, free-text category, priority, active |
| `virtual_gift_transactions` | Gifts sent. Snapshot, cost, recognition points, order context, `verified_buyer`, anonymity, unique `(sender, client_request_id)`, no self-gifts (check) |
| `virtual_gift_refunds`, `dream_gifting_admin_audit` | Append-only |
| `reward_programs`, `reward_awards` | Configurable recognition programmes. `reward_programs_non_cash` constraint blocks monetary programmes |

All money-safe logic runs in SQL functions, one transaction each: `dream_coins_credit_purchase`, `dream_coins_record_consumption`, `dream_coins_reverse_purchase`, `virtual_gift_send` (row lock, idempotency, hourly and daily limits, balance check), `virtual_gift_reverse`, `dream_coins_admin_adjust`, `dream_coins_set_suspension`.

## 3. API

| Endpoint | Auth | Notes |
|---|---|---|
| `GET /api/onedream/gifts/catalogue` | public | Active gifts |
| `GET /api/onedream/gifts/packages` | public | Product ids and coins per unit. No prices: the app shows Google's localized price |
| `POST /api/onedream/gifts/verify-purchase` | participant | `processCoinPurchase` (lib/dreamCoinsRules.js) |
| `POST /api/onedream/gifts/send` | participant | Optional `order_id` + `buyer_token` → verified buyer (delivered orders only, read only) |
| `GET /api/onedream/gifts/history` | participant | Balance, purchases, ledger, gifts sent |
| `GET /api/onedream/gifts/received?username=` | public | Recognition, badges, monthly stats, supporters (anonymous senders hidden) |
| `GET /api/onedream/rewards/programs` | public | |
| `GET /api/onedream/rewards/progress` | participant | Metrics from delivered orders and appreciation |
| `GET /api/onedream/rewards/leaderboards?board=` | public | `most_appreciated` and `reliable_merchants`, kept separate |
| `/api/admin/gifts` (`index`, `catalogue`, `packages`, `actions`, `rewards`, `billing-status`, `sync-voided`, `export`) | active admin, or CRON_SECRET for the sync | Every mutation is audited |

Environment variables: `DREAM_COINS_ENABLED` (default off), `VIRTUAL_GIFT_MAX_PER_HOUR` (30), `VIRTUAL_GIFT_MAX_COINS_PER_DAY` (50000).

## 4. Google Play configuration

`scripts/create-dream-coin-products.mjs` (`--dry-run`, `--activate`, `--multi-quantity`) creates the seven consumables: `dream_coins_100` $0.99, `_250` $1.99, `_600` $4.99, `_1300` $9.99, `_2800` $19.99, `_7500` $49.99, `_16000` $99.99. By default they are created **inactive and single-quantity**, with Google's regional price conversion and the US price kept exact. It was run on 17 October 2026: all seven exist in Play Console, inactive.

## 5. Mobile and web

- `/gifts`: balance, coin store (Android with sales on), gift catalogue, gifts sent and coin activity.
- `/gifts/send`: gift picker, quantity, note, anonymity, cost.
- `/gifts/recognition/[username]`: seller recognition.
- `/rewards`: programmes, awards and the two leaderboards.
- Entry points: Profile tab ("Dream Coins & gifts", "Rewards & recognition"), public profile ("Appreciation & gifts"), and an optional thank-you prompt on delivered orders in the cart's order list and the listing screen. The prompt is shown only to signed-in buyers, and only after `buyer_confirmed` or `released`.
- Web app (/app): the same screens. The store reads "buy in the Android app". There is no web checkout for coins.

## 6. Paid voting: inventory and retirement plan

**Resolved 19 October 2026: paid voting is retired.** The owner decided to remove it and keep Dream Coins and gifts. Production had no real vote sales (0 `votes` rows, 0 `payments`, 0 withdrawals; the 179 `total_votes` on 20 accounts are seed data from 4 January 2026). Every vote purchase, crediting and vote-withdrawal route now returns 410 (`lib/paidVoting.js`). Buy Votes, the vote screen, the vote leaderboard, cash prizes and the 1,000,000-vote bar are gone from Android 1.0.22, the web app and the website. Old vote links redirect to the creator's profile. Vote records are kept as history.

The inventory and plan below are kept for reference.

**Inventory:**
- Vote sales: `pages/api/onedream/{vote, create-payment-intent, init-crypto-payment, finalize-payment, verify-usdt-payment, paymentWebhook}.js`, `lib/voteCredits.js`.
- Participant share: `withdraw.js` ($1 per vote).
- Merchant per-vote reward: `lib/merchantRewards.js`.
- Rankings: `leaderboard.js`, `vote-stats.js`, milestones.
- Prize copy: `public/Onedream.html`, `vote.html`, `leadershipBoard.html`.
- App: `app/vote/[username].tsx`, the "Buy Votes" button on profiles, the leaderboard tab.
- No code holds a prize pool, enforces a vote threshold or selects winners. The only threshold is the 1,000,000-vote progress bar on the website (`public/Onedream.html`, `leadershipBoard.html`), which triggers nothing.

**Proposed plan (needs owner approval):**
1. Remove "Buy Votes" from the Android app first. This is the Play-policy exposure.
2. Stop new vote sales on the website, or convert them to free engagement.
3. Settle existing participants' withdrawable $1-per-vote balances and any advertised prize commitments.
4. Freeze vote tables as read-only history.
5. Replace prize copy with the recognition programmes.

Historical records stay intact throughout.

## 7. Tests

`npm run test:dream-coins` (`scripts/test-dream-coins.mjs`) runs the real migration in an in-memory Postgres. **14/14 pass.** Coverage:
- 3 units of `dream_coins_600` credits exactly 1,800 coins, once.
- Duplicate submissions do not re-credit or call Google again. Another account using the token gets 409.
- Single-unit purchases without a quantity field credit one unit.
- Pending, cancelled, unbound and foreign purchases, unknown products and switched-off sales all credit nothing.
- If consumption fails mid-flow, the purchase is retried.
- Concurrent credits.
- Gift sends: idempotent retry, self-gift refused, inactive gift, quantity bounds, hourly and daily limits, insufficient balance, suspension.
- Admin reversal.
- Refunds: partial, full remainder, replayed events, and the negative-balance debt that blocks spending.
- Append-only enforcement, and every balance matching its ledger sum.
- Idempotent admin adjustment, the non-cash constraint, and client-role lockout.

`tsc --noEmit` passes for the mobile app. The one ESLint error in `coin-billing.tsx` (`react-hooks/immutability`) is the same pre-existing pattern reported in `promo-billing.tsx`.

**Still to test on device:** real license-tester purchases (single, multi-quantity, refund), regional price display, and repurchase after consumption.

## 8. Deployment and rollback

**Deploy:**
1. Run `supabase/add_dream_coins_gifting.sql` in Supabase, then confirm every row of the closing verification query is `ok = true`. The editor may not apply the paste atomically.
2. Deploy the API with `vercel deploy --prod`, leaving `DREAM_COINS_ENABLED` unset. Recognition, gift catalogue and admin work; nothing can be bought.
3. Ship the web export and the next APK.
4. After the policy items are signed off: run the products script (inactive), activate, do internal-track tester purchases, then set `DREAM_COINS_ENABLED=true`. Enable multi-quantity only after a multi-unit tester purchase has credited correctly.

**Rollback:**
- First, unset `DREAM_COINS_ENABLED`. Sales stop immediately and history is kept.
- Code: revert the commit. Nothing else depends on these files.
- Data: `supabase/rollback_dream_coins_gifting.sql` refuses to run if any real (non-test) purchase exists.

## 9. Files

**New:**
- `supabase/add_dream_coins_gifting.sql`, `supabase/rollback_dream_coins_gifting.sql`
- `lib/dreamCoins.js`, `lib/dreamCoinsRules.js`
- `pages/api/onedream/gifts/{catalogue,packages,verify-purchase,send,history,received}.js`
- `pages/api/onedream/rewards/{programs,progress,leaderboards}.js`
- `pages/api/admin/gifts/{index,catalogue,packages,actions,rewards,sync-voided,billing-status,export}.js`
- `scripts/create-dream-coin-products.mjs`, `scripts/test-dream-coins.mjs`
- `mobile/src/api/gifts.ts`, `mobile/src/components/{coin-billing,gift-art}.tsx`
- `mobile/src/app/gifts/{index,send}.tsx`, `mobile/src/app/gifts/recognition/[username].tsx`, `mobile/src/app/rewards.tsx`
- This report and the policy readiness document.

**Modified (additive only):**
- `public/admin-portal.html`: new tab.
- `vercel.json`: daily `/api/admin/gifts/sync-voided` cron.
- `package.json`: `test:dream-coins` script.
- `mobile/src/app/_layout.tsx`: 4 routes.
- `mobile/src/app/(tabs)/profile.tsx`: 2 menu rows.
- `mobile/src/app/profile/[username].tsx`: 1 button.
- `mobile/src/app/shop/cart.tsx` and `mobile/src/app/catalogue/item/[id].tsx`: the optional thank-you prompt, which renders only for delivered orders. Checkout and payment code are unchanged.

**Not modified (protected):** Paystack, crypto, marketplace checkout and verification, seller earnings and commissions, withdrawals, AI subscription and RTDN, ads and boost billing, digital products, `lib/adsGooglePlay.js`, `lib/aiPayments.js`.

## 10. Blockers and decisions needed

- **B1. One-time-product RTDN.** Handling coin notifications in real time would mean editing the subscription RTDN endpoint, which is protected. Without it, coins are credited when the app reports the purchase, pending purchases are picked up on the next app open, and refunds are applied by the daily sync. Authorise this only if real-time crediting is needed.
- **B2. Paid voting in the Android app.** Resolved 19 October 2026: retired (section 6).
- **B3. Merchant-referral and affiliate metrics.** Merchant accounts are separate from participants, and affiliate attribution does not exist yet. These programmes stay "coming soon" or inactive until the affiliate engine ([MERCHANT_AFFILIATE_FRAMEWORK.md](MERCHANT_AFFILIATE_FRAMEWORK.md)) supplies the data.
