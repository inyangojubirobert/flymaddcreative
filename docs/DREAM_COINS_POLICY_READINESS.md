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
| 7 | Does the app contain prohibited real-money contest mechanics? | No. **Resolved 19 October 2026: paid voting is retired.** The owner decided to remove it and keep Dream Coins and gifts. Production had no real vote sales (0 `votes` rows, 0 `payments`, 0 withdrawals; the 179 `total_votes` on 20 accounts are seed data from 4 January 2026). Every vote purchase, crediting and vote-withdrawal route now returns 410 (`lib/paidVoting.js`). Buy Votes, the vote screen, the vote leaderboard, cash prizes and the 1,000,000-vote bar are gone from Android 1.0.22, the web app and the website. Old vote links redirect to the creator's profile. Vote records are kept as history. |
| 8 | Refund and consumption requirements | **[DESIGN]** Purchases are consumed only after the coins are credited. Credited-but-unconsumed purchases are retried, and Google auto-refunds anything not acknowledged within 3 days. A daily job (`/api/admin/gifts/sync-voided`) applies full and quantity-based partial refunds. If coins were already spent, the balance goes negative and spending is blocked. |
| 9 | Required disclosures and terms | **[OPEN]** The purchase confirmation already says that coins have no cash value and cannot be withdrawn or used for votes or prizes. Still needed: a Dream Coins section in the Terms (no cash value, non-refundable except as required by law or Google's refund policy, the account must be in good standing, admin reversal for abuse), and a store-listing line for in-app purchases. |
| 10 | Are seller rewards commercial incentives or regulated contests? | The current programmes are non-cash recognition with published criteria and no purchase requirement. Eligibility is based on verified sales and delivery. **[OPEN]** Any monetary bonus or affiliate commission needs legal review as a commercial incentive and must not depend on gift totals. |

## 3. Open items before `DREAM_COINS_ENABLED=true`

1. ~~Owner decision on the paid-voting flow (item 7).~~ Done 19 October 2026: paid voting retired.
2. Terms of Service and store listing updates (item 9).
3. Products created in Play Console with `scripts/create-dream-coin-products.mjs`, first without multi-quantity.
4. License-tester purchases on the internal testing track: single unit, then multi-unit after `--multi-quantity`, then a refund. Confirm the credited coins and the reversal in the admin Gifts tab.
5. Age and region review: decide whether gifting should be limited to adult accounts in regions where virtual-currency rules apply.

## 4. Features kept behind a disabled switch or out of scope

- Coin sales: `DREAM_COINS_ENABLED` (off).
- Recipient withdrawals, cash tipping and creator payouts: **not built.** These need a separate design and a compliance review.
- Monetary reward programmes: blocked by a database constraint.
- `affiliate_performance` programme: seeded **inactive** until affiliate agreements are approved.

## 5. Gift revenue sharing (added 17 October 2026: built, switched off)

The owner decided that gifts should earn money: **50% to the recipient, 10% to the merchant who referred the recipient (for 12 months), 40% to One Dream**, valued from Google's actual proceeds. This is built behind `gift_earnings_enabled` (off) and `payouts_enabled` (off). See [EARNINGS_AND_AFFILIATE_IMPLEMENTATION.md](EARNINGS_AND_AFFILIATE_IMPLEMENTATION.md).

It changes this assessment:
- **Question 3 (peer-to-peer payment):** recipients now earn money from coins other users bought, paid outside Google Play. Before switching it on, confirm that Google Play's Payments and creator-monetisation policies are met, including how the app describes it.
- **Questions 4 and 5:** the earnings are real monetary value, but **coins themselves are still never redeemable** by the buyer.
- **New requirements before switching on:**
  - payee identity checks and a minimum age of 18 (built as manual admin verification);
  - tax and money-transmission advice for each country paid;
  - Terms covering creator earnings, reversals after refunds, and recovery of negative balances;
  - updated in-app wording. The coin purchase sheet stays as it is: coins have no cash value to the buyer.
- **Unchanged:** gifts still never decide votes, prizes or rankings that carry money, and the anti-gambling rules stay.
