# Dream Coins & Virtual Gifts: Google Play Policy Readiness

Status on 17 October 2026: **not approved for production sales.** Coin sales stay off (`DREAM_COINS_ENABLED` unset) until the owner signs off the open items in section 3. Nothing here claims Google Play approval.

Labels: **[DESIGN]** means enforced in code or schema, **[OPEN]** means a decision or review is still needed.

## 1. What is being sold

- Seven consumable one-time products, `dream_coins_100` to `dream_coins_16000`. Each pack adds a fixed number of Dream Coins to the buyer's in-app balance.
- Dream Coins can only be spent on virtual appreciation gifts. A gift shows on the recipient's profile as recognition points and badges.
- Coins have no cash value. They cannot be withdrawn, transferred between users, converted to crypto, or used for votes, prize entries or chances of winning money. **[DESIGN]** No function or endpoint does any of these things.

## 2. Assessment against the questions in the directive

| # | Question | Assessment |
|---|---|---|
| 1 | Are Dream Coin purchases eligible for Google Play Billing? | Yes. They are in-app virtual currency spent on in-app digital items, which Google Play's Payments policy requires to go through Play Billing. **[DESIGN]** On Android, coins are sold only through Play Billing. The web app sells none (it shows "buy in the Android app"). |
| 2 | Do gifts provide digital benefits? | Yes, to both sides. The sender gets a visible gift and an optional thank-you note. The recipient gets recognition points, badges and leaderboard visibility. All of these exist only in the app. |
| 3 | Is a gift effectively a peer-to-peer payment? | Not in the current design. **[DESIGN]** Recipients receive no money, no withdrawable balance and no coins. Recognition points are a separate counter that cannot be spent or withdrawn. Gift activity creates no payable liability, and seller earnings and withdrawals are untouched. |
| 4 | Do platform commissions or retained fees affect the classification? | No commission exists, because nothing is paid out to recipients. **[OPEN]** If creator payouts are added later, the payment classification changes and the feature must be reassessed before it is built, including whether it becomes a peer-to-peer payment outside Play Billing's scope. |
| 5 | Is any reward convertible into real-world monetary value? | No. **[DESIGN]** `reward_programs` has a constraint (`reward_programs_non_cash`) that rejects monetary programmes. Programme rewards are badges, achievements, featured placement and platform benefits. |
| 6 | Do gift rankings influence monetary prizes? | No. **[DESIGN]** Gifts are stored in separate tables that no vote, prize, withdrawal or settlement code reads. Leaderboards state "Recognition only. No prizes". The reliable-merchants board uses delivered orders, not gifts. |
| 7 | Does the app contain prohibited real-money contest mechanics? | **[OPEN] Yes, independent of this feature.** The existing paid-voting flow (`app/vote/[username].tsx`, "Buy Votes") sells votes by Paystack or USDT inside the Android app, and the website advertises cash prizes for top vote-getters. That is a paid-entry contest with cash prizes, paid outside Play Billing. It is the largest policy risk in the app. See the retirement plan in DREAM_COINS_IMPLEMENTATION_REPORT.md, section 6. |
| 8 | Refund and consumption requirements | **[DESIGN]** Purchases are consumed only after the coins are credited. Credited-but-unconsumed purchases are retried, and Google auto-refunds anything not acknowledged within 3 days. A daily job (`/api/admin/gifts/sync-voided`) applies full and quantity-based partial refunds. If coins were already spent, the balance goes negative and spending is blocked. |
| 9 | Required disclosures and terms | **[OPEN]** The purchase confirmation already says that coins have no cash value and cannot be withdrawn or used for votes or prizes. Still needed: a Dream Coins section in the Terms (no cash value, non-refundable except as required by law or Google's refund policy, the account must be in good standing, admin reversal for abuse), and a store-listing line for in-app purchases. |
| 10 | Are seller rewards commercial incentives or regulated contests? | The current programmes are non-cash recognition with published criteria and no purchase requirement. Eligibility is based on verified sales and delivery. **[OPEN]** Any monetary bonus or affiliate commission needs legal review as a commercial incentive and must not depend on gift totals. |

## 3. Open items before `DREAM_COINS_ENABLED=true`

1. Owner decision on the paid-voting flow in the Android app (item 7). Selling Dream Coins does not fix the existing vote sales, and a review of the gifting feature may surface them.
2. Terms of Service and store listing updates (item 9).
3. Products created in Play Console with `scripts/create-dream-coin-products.mjs`, first without multi-quantity.
4. License-tester purchases on the internal testing track: single unit, then multi-unit after `--multi-quantity`, then a refund. Confirm the credited coins and the reversal in the admin Gifts tab.
5. Age and region review: decide whether gifting should be limited to adult accounts in regions where virtual-currency rules apply.

## 4. Features kept behind a disabled switch or out of scope

- Coin sales: `DREAM_COINS_ENABLED` (off).
- Recipient withdrawals, cash tipping and creator payouts: **not built.** These need a separate design and a compliance review.
- Monetary reward programmes: blocked by a database constraint.
- `affiliate_performance` programme: seeded **inactive** until affiliate agreements are approved.
