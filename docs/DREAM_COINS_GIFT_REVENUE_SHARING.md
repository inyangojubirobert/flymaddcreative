# Dream Coins: Gift Revenue Sharing (Proposed Extension)

17 October 2026. Status: **built per the owner's decisions and switched off** (`gift_earnings_enabled`). See [EARNINGS_AND_AFFILIATE_IMPLEMENTATION.md](EARNINGS_AND_AFFILIATE_IMPLEMENTATION.md).

The owner's decisions replaced two suggestions below:
- **No fixed value per coin.** Gifts are valued from the coin lots that paid for them: the configured Play price, then Google's actual fee and tax from the earnings report.
- **No fixed 30-day hold.** Earnings become withdrawable when Google's payout for that report has reached One Dream.

The merchant period is option B: 12 months from the recipient's registration. The rest of this document is the original proposal, kept for reference.

## 1. The owner's model

When a user sends a gift, its value is shared three ways:

| Party | Share |
|---|---|
| Gift recipient | 50% |
| One Dream | 40% |
| The merchant who referred the **recipient** | 10% |

Rewarding the recipient's referrer encourages merchants to recruit creators and sellers who build an audience. If the recipient was not referred, or the referral has expired, the 10% stays with One Dream.

## 2. Audit of existing records (production, read only, 17 October 2026)

| Record | Count | What it means |
|---|---|---|
| `dream_coin_purchases` | 0 | Coin sales are switched off. No real money has been taken |
| `virtual_gift_transactions` | 0 | No gifts have been sent |
| `dream_coin_ledger` | 0 | |
| `participants` | 34 | |
| …with `referred_by_merchant_link_id` set | 0 | No participant has been referred by a merchant yet |
| `referral_merchants` | 1 | |
| `merchant_referral_links` | 2 | |
| `merchant_referral_rewards` | 0 | |

**So there is no liability to migrate and no history to rewrite.** This is the right moment to decide, because the accounting below is much easier to add **before** the first coin is sold.

**How referrals are recorded today:** when someone registers with a merchant's `ref_code`, `pages/api/onedream/register.js` stores the link on `participants.referred_by_merchant_link_id`. That link points to `merchant_referral_links.merchant_id`. This is set once, at registration, and can't be changed later, so it is a sound basis for "who referred the recipient". The registration date (`participants.created_at`) is when a time-limited entitlement would start.

## 3. Turning a gift into money

**Dream Coins have no single price.** Depending on the pack, a coin costs between $0.0099 and $0.0062, and Google keeps 15% (up to 30%). Splitting the price the buyer paid would mean every gift needs its purchase traced, and two identical gifts could pay differently.

**Proposal: a fixed earnings value per coin**, set by admin and stored on every gift when it is sent. The safe default is the cheapest coin after Google's fee:

> $99.99 ÷ 16,000 coins × 0.85 = **$0.0053 per coin** (at Google's 15% rate)

Examples at $0.0053 per coin:

| Gift | Coins | Value | Recipient 50% | Merchant 10% | One Dream 40% |
|---|---|---|---|---|---|
| Appreciation Heart | 10 | $0.053 | $0.027 | $0.005 | $0.021 |
| Golden Trophy | 100 | $0.53 | $0.27 | $0.05 | $0.21 |
| Legendary Support | 1,000 | $5.30 | $2.65 | $0.53 | $2.12 |

One Dream also keeps the difference between this value and what buyers of smaller packs actually paid. For example, a 100-coin pack nets One Dream $0.84 after Google's fee against $0.53 of coin value. That extra covers payment risk and refunds.

**Rules:**
- Amounts are stored in USD micro-units. The value per coin and the split are fixed on the gift row when it is sent.
- Coins from Google license-tester purchases (`is_test`) and coins added by admin adjustment earn **nothing**.
- Self-gifts are already blocked. A merchant earns nothing on a gift to an account linked to themselves.

## 3a. Schema audit: can gift value be accounted for without double counting?

I checked the live schema (`supabase/add_dream_coins_gifting.sql`) against what revenue sharing needs:

| Need | What exists | Gap |
|---|---|---|
| What the buyer paid | `dream_coin_purchases` stores the product, **verified quantity**, coins per unit and total coins. **It stores no price or currency**, because Google's purchase check doesn't return one | Money in can only be reconciled from Play Console earnings reports, not row by row. This is the main reason for a **fixed value per coin**: gift earnings never depend on a per-purchase price |
| Which purchase paid for a gift | Coins are one pooled balance (`dream_coin_balances`), and gifts debit it (`gift_debit`) | **No link from a gift to the purchase that funded it.** A refund can't reverse the right gift's earnings, and gifts paid with test or admin-adjusted coins can't be excluded. Coin lots are needed |
| A gift's size | `virtual_gift_transactions.coins_spent`, `status` (`sent` / `reversed`), and a snapshot of the gift | Sufficient |
| The recipient's referrer | `participants.referred_by_merchant_link_id` → `merchant_referral_links.merchant_id` | Sufficient. It should be **copied onto the earnings row** when the gift is sent |
| Refunds | `dream_coins_reverse_purchase()`, partial and idempotent | It reduces the balance only. It must also reverse the earnings of the gifts that lot paid for |

**Rules that prevent double counting:**
1. **Coin balances and the coin ledger are never changed by revenue sharing.** It is a separate layer that only **reads** gifts and lots and writes its own earnings rows. Dream Coins stay exactly as they are for buyers.
2. **Revenue is counted once, at purchase**, as Google's net. Unspent coins are deferred revenue. A gift creates an **earnings liability** (recipient plus merchant) against that revenue. It doesn't create new revenue, and the 40% isn't booked a second time.
3. **One earnings row per gift.** It is unique on the gift id and created in the same transaction as the gift, so a retry or a replayed `client_request_id` can't create a second one.
4. **Recognition points stay separate.** They are a display count and are never converted. Earnings come from coins and the fixed value per coin, not from points.
5. **Only purchased coins earn.** Each gift's lot allocation shows whether coins came from a real purchase, a test purchase or an admin adjustment, and only real purchases earn.
6. **An admin gift reversal** (`virtual_gift_reverse`) also reverses that gift's earnings.

## 4. Accounting that must exist before coin sales start

1. **Coin lots.** Each purchase becomes a lot. Gifts spend the oldest lots first, and each gift records which lot or lots paid for it. When Google refunds a purchase, **only the gifts paid for by that lot** have their earnings reversed. The current ledger knows a balance went negative, but not which gifts were funded by the refunded coins. That is fine for recognition, but not when money is paid out.
2. **An earnings record for each gift.** Each gift gets a row with: the coins, the value per coin, the recipient, merchant and platform amounts, the merchant who referred the recipient, the funding lots, and a status.
3. **Statuses:**
   - `pending` when the gift is sent;
   - `held` for 30 days (Google's voided-purchases window), longer for large amounts;
   - then `available`, `paid`, or `reversed` if the funding lot was refunded.

   If a reversal comes after payout, the payee's balance goes negative and is recovered from future earnings.
4. **Separate ledgers.**
   - A creator earnings ledger for recipients.
   - The `gift_referral` source for merchants, in the same unified merchant account as the affiliate marketplace ([MERCHANT_AFFILIATE_FRAMEWORK.md](MERCHANT_AFFILIATE_FRAMEWORK.md), section 13).
   - These are never mixed with seller earnings, vote earnings or affiliate commission.
5. **Payouts.** These need the withdrawal changes already flagged as protected:
   - creators: a new `participant_withdrawals.source`;
   - merchants: the merchant withdrawal path, which currently has a race condition and no ledger (`MERCHANT_COMPENSATION_REVIEW.md`, section 11).
6. **Reporting.** The admin view and CSV export add earned, held, available, paid and reversed totals per party, plus Google gross and net per month.

## 5. Merchant entitlement period (decision needed)

| Option | How it works | Trade-off |
|---|---|---|
| A. Lifetime | 10% of every gift the recipient ever receives | Strongest incentive. It becomes a permanent cost, and old referrals can't be renegotiated |
| **B. 12 months from the recipient's registration** (suggested) | Ends 12 months after `participants.created_at` | A clear, bounded cost. Rewards merchants for bringing in active creators early |
| C. A lifetime cap per referred recipient | For example up to $200 per recipient, then it stops | Bounded, but harder for merchants to follow |

Whichever is chosen, the end date is stored when the gift is sent, so the rules can't change after the fact.

## 6. Compliance and policy (must be redone before launch)

- **Google Play.** Buying coins through Play Billing to send virtual gifts, and paying creators outside Play, is a model large apps use. But it changes the assessment in [DREAM_COINS_POLICY_READINESS.md](DREAM_COINS_POLICY_READINESS.md), questions 3-5. Gifts become a way for users to earn money and must be assessed as such. Gifts must still never affect votes, prizes or rankings that carry money.
- **Payees.** Recipients and merchants who are paid need:
  - identity checks;
  - a minimum age of 18;
  - tax details where the law requires them;
  - a minimum payout amount.

  Depending on the country, paying users from pooled funds can fall under money-transmission rules. This needs legal advice, especially for Nigeria (NGN payouts).
- **What users are told.**
  - Buyers can still be told coins have no cash value: coins are never refundable to them as money.
  - The recipient wording "recognition points are not money" would change for recipients who opt into earnings.
  - The Terms need a creator earnings section.
- **The anti-gambling rules stay:** no prize pools, no rankings that pay out, and no paid votes tied to gifts.

## 7. What changes in the live system if this is approved

- Additive tables for coin lots, gift earnings, payee profiles and earnings ledgers. The existing gift and ledger tables keep working as they are.
- `virtual_gift_send()` also allocates lots and records earnings. This is a change to a function we built; no protected payment code is involved.
- The refund job reverses earnings for each lot.
- Payout paths need the withdrawal approvals above.
- The app gets a creator earnings screen and a merchant gift-referral earnings screen, and its wording changes.
- `reward_programs_non_cash` stays as it is. It covers recognition programmes, which remain non-cash.

## 8. Decisions needed

1. Confirm the 50 / 40 / 10 split, applied to a **fixed value per coin** (suggested $0.0053).
2. The merchant entitlement period: A, B (suggested) or C.
3. The hold period: 30 days suggested.
4. Should creators opt in to earnings, or earn automatically once identity checks pass?
5. Which countries payouts are offered in, and whether there is legal sign-off on paying users.
6. **Order of work:** build coin lots **before** turning on `DREAM_COINS_ENABLED`, even if payouts come later. This keeps the books clean from the first sale. Recommended.
