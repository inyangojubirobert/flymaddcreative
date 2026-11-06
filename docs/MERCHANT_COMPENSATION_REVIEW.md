# One Dream: Premium Vote Revenue Sharing & Merchant Compensation Review

> **Superseded in part (17 October 2026).** One Dream is moving away from paid votes and prize thresholds to Dream Coins (non-cash appreciation) and the merchant affiliate marketplace. For how merchants earn now, see [MERCHANT_AFFILIATE_FRAMEWORK.md](MERCHANT_AFFILIATE_FRAMEWORK.md). The vote-revenue analysis below is kept as history; the merchant withdrawal risks in section 11 still apply.

Read-only audit, 16 October 2026. No code, database, price, reward formula or configuration was changed for this review. Production data could not be read (the session was not allowed to query the live database), so balances and volumes are unverified. The read-only queries in Appendix A fill that gap.

Labels used below:
- **[VERIFIED]** means confirmed in the code at the file and line given.
- **[ASSUMPTION]** means not in the code, such as Paystack's published pricing or an exchange rate.
- **[RECOMMENDATION]** means a proposal that needs owner approval.

---

## 1. Executive summary

1. **A premium vote costs a fixed $2, and the voted-for participant earns $1 of it.** This is enforced server-side.
2. **The other $1 is not platform revenue according to the site's public copy.** `Onedream.html` presents it as a **"Grand Prize Pool"** for the top 3 winners. No code, table or ledger records a prize pool, a platform share, processing fees or operating costs; the second $1 simply stays in the Paystack or wallet balance. The working assumption "50% participant / 50% One Dream" is therefore not what the site promises publicly. **The owner must decide what the second $1 is before any merchant commission can be priced.**
3. **Processing fees are not deducted anywhere.** On a one-vote Paystack payment, the fee is about 5% of the gross. One Dream absorbs it out of the non-participant half.
4. **The 50-token merchant reward is not live.** `lib/merchantRewards.js` exists, but nothing calls it, so no merchant has been credited since the current vote code was written. Merchant balances should therefore be zero; this needs confirming with query A2.
5. **The "tokens" are database numbers**, not a cryptocurrency and not money. They are stored in `referral_merchants.available_tokens`. They have no defined value, no backing and no working payout. A merchant "withdrawal" lowers the number and reports "processing", but nothing is recorded or paid.
6. **The Bascardo cryptocurrency does not exist in this codebase.** "Bascardo" appears only as the brand name of the AI subscription (Bascardo AI).
7. **Recommendation.** Keep the participant's $1. Decide how the second $1 divides between the prize pool and operations. Pay merchants a **USD commission funded from the operations portion**, as a percentage net of processing fees: about 10% of the non-participant half, roughly $0.09 per vote. Add a per-merchant monthly cap, a global referral budget, a 30-day hold and a $10 minimum withdrawal. Retire the 50-token promise for future votes. Fix the merchant withdrawal and reward plumbing (Section 11) before any real money flows.

---

## 2. Verified current premium-vote revenue flow

| Step | What happens | Where |
|---|---|---|
| Price | $2 per vote, a hard-coded constant (not configurable from the database) | `lib/voteCredits.js:21` (`VOTE_VALUE_USD = 2`), `lib/verifyCryptoTx.js:16`, `mobile/src/api/votes.ts:3`, `public/js/paystack-payments.js:45` |
| Channels | Paystack (charged in NGN at the live USD→NGN rate) and USDT on BSC (BEP-20) or Tron (TRC-20) | `lib/voteCredits.js:39-60`, `lib/verifyCryptoTx.js:18-34` |
| Paystack intent | The server records the participant, vote count, rate and exact kobo amount in `payments` with status `initialized` | `lib/voteCredits.js:46-60` |
| Paystack verify | Paystack's API is checked; the charge must be at least 98% of the expected kobo | `lib/voteCredits.js:67-126` (tolerance at :114) |
| USDT verify | Checked on-chain; votes = floor(amount ÷ $2), so any remainder is kept by One Dream | `lib/voteCredits.js:129-150` (:147) |
| Credit | Exactly once per payment: `payments.status` moves `initialized/verifying → crediting → succeeded`. One `votes` row is written per vote and `participants.total_votes` is incremented | `lib/voteCredits.js:156-266` (:223-249) |
| Gross recorded | `payments.amount_usd`, `amount_ngn`, `exchange_rate` and `currency`. **No fee, net, prize-pool or platform-share columns** | `lib/voteCredits.js:173-186, 226` |
| Participant earnings | Computed when needed as **`total_votes × $1.00`**, minus non-rejected withdrawals. No per-payment ledger | `pages/api/onedream/withdraw.js:17, 112-116`; `supabase/fix_participant_withdrawals_schema.sql:52, 65-75`; `public/js/supabase-config.js:269` |
| Participant withdrawal | An atomic RPC locks the participant, rechecks the balance and inserts a `pending` row. Payout is manual (bank or USDT) after admin review | `pages/api/onedream/withdraw.js:41-46`; SQL :36-83 |
| Refunds and reversals | **Not handled.** The webhook acts only on `charge.success`. Credited votes and earnings are never reversed | `pages/api/onedream/paymentWebhook.js:48` |

## 3. The existing 50/50 split and its beneficiaries

- **Participant: $1.00 per vote received** [VERIFIED]. This is enforced in the database function and the API (references above). The participant is the person voted *for*, not the voter. The earnings are real, withdrawable USD.
- **Second $1.00: no beneficiary recorded in code** [VERIFIED]. Public copy describes it as follows:
  - `public/Onedream.html:1218-1231`: "How each $2 vote is split: $1.00 Grand Prize Pool … Top 3 winners take the prize. + $1.00 Straight to YOU."
  - `public/user-dashboard.html:258`: "50% of every $2 vote goes directly to you."
- **When the split happens:** the participant's half accrues the moment votes are credited, because it is derived from `total_votes`. The prize-pool half is not computed or stored anywhere.
- **Where it is enforced:** the participant half is enforced in the backend and database. The prize-pool half exists only in website copy.
- **Reserves for operations, merchants or profit:** none in code [VERIFIED].

Two smaller copy issues: the same page says "withdraw anytime" (`Onedream.html:1075`) and "Withdraw monthly" (`:1231`).

## 4. Existing merchant token reward implementation

| Question | Finding | Where |
|---|---|---|
| Trigger | It *would* fire after a paid vote for a participant whose `referred_by_merchant_link_id` is set. **Nothing calls it**: no route, webhook or script imports `creditMerchantReferralReward` | `lib/merchantRewards.js:22`; repo-wide search finds no callers |
| Amount | `50 × voteCount` tokens (env `MERCHANT_REWARD_TOKENS_PER_VOTE`, default 50) | `lib/merchantRewards.js:20, 43` |
| Unit of reward | Per vote, not per participant, and with no time limit | `:43` |
| Whose votes count | Votes **received by** the referred participant, bought by anyone. The marketing says "every person you refer **who votes**" (`Onedream.html:618`), which does not match | `:26-33` |
| Duplicate prevention | A unique index on `merchant_referral_rewards.payment_id` makes the insert idempotent | `lib/merchantRewards.js:45-61`; `supabase/fix_merchant_schema.sql:86` |
| Crediting | `credit_merchant_tokens()` adds the amount to both `available_tokens` and `total_tokens_earned` | `supabase/fix_merchant_schema.sql:162` |
| Value of 50 tokens | **Undefined.** No conversion rate exists anywhere | n/a |
| Effect on the split | **None today.** It is not deducted from the participant or from the second $1, because it is never credited and has no value | n/a |
| Already accounted for in the split | No | n/a |

## 5. Token versus monetary balance findings

| Concept | Exists? | What it actually is |
|---|---|---|
| Planned Bascardo cryptocurrency | **No** | Not in the code. "Bascardo" only names the AI subscription (`lib/aiPayments.js:9-15`) |
| Merchant reward tokens | Yes, as numbers | `referral_merchants.available_tokens` and `total_tokens_earned` (numeric). No backing, value or redemption |
| Participant vote earnings | Yes | USD, derived as `total_votes × $1` and withdrawable |
| Seller marketplace earnings | Yes | A USD ledger per order with commission fixed at sale (`lib/sellerEarnings.js:9-17`), withdrawn separately (`participant_withdrawals.source = 'marketplace'`, `pages/api/onedream/marketplace-wallet.js:50, 130`) |
| Merchant withdrawable money | **No** | See Section 6 |

These four must stay separate ledgers. No approved conversion exists between tokens and money.

## 6. Current merchant withdrawal mechanism

`pages/api/merchants/[id]/withdraw.js` [VERIFIED]:
- **Minimum:** 50 tokens (line 21).
- **Balance update:** reads `available_tokens` (line 28), checks it in JavaScript (line 36), then writes `available_tokens - amount` (line 42). This is a **read-then-write race**: two concurrent requests can both pass the check.
- **Nothing recorded or paid:** returns `status: 'processing'` (line 51) but **writes no `merchant_withdrawals` row** and notifies no admin. No admin screen lists merchant withdrawals, and nothing is paid.
- **Ownership:** checked since today's fix (`requireMerchantOwnership`).

An atomic, ledgered version already exists in SQL but is unused: `request_merchant_withdrawal()` (`supabase/fix_merchant_schema.sql:133`) together with the `merchant_withdrawals` table (`:92`).

## 7. Financial sustainability calculations

**[ASSUMPTION]** inputs:
- Paystack Nigeria local fee: 1.5% + ₦100, with the ₦100 waived under ₦2,500 and a cap of ₦2,000 (Paystack's published pricing).
- Exchange rate: ₦1,500 = $1. This is illustrative; the live rate comes from `lib/currency.js`.
- USDT inbound costs One Dream nothing. A USDT payout costs about $1 on TRC-20 or about $0.10 on BEP-20.

### Per vote, with the second $1 treated as the prize pool (what the site promises)

| | 1 vote, Paystack | 5 votes, Paystack (per vote) | USDT (per vote) |
|---|---|---|---|
| Gross received | $2.000 | $2.000 | $2.000 |
| Processing fee | $0.097 (₦145 on ₦3,000) | $0.043 (₦325 on ₦15,000 ÷ 5) | $0.000 |
| Net available | $1.903 | $1.957 | $2.000 |
| Participant allocation [VERIFIED] | $1.000 | $1.000 | $1.000 |
| Prize pool (public promise) | $1.000 | $1.000 | $1.000 |
| Existing merchant reward | 50 tokens, $0 value, not credited | same | same |
| **Remaining for One Dream** | **−$0.097** | **−$0.043** | **$0.000** before payout costs |

If the prize pool is paid in full, every Paystack vote loses money and there is **no margin to fund merchants** without reducing the prize pool or the participant.

### Per vote, with the second $1 treated as platform revenue (the working assumption)

| | 1 vote, Paystack |
|---|---|
| Net after fee | $1.903 |
| Participant | $1.000 |
| Platform allocation, net | $0.903 |

At 10% of the platform allocation, the merchant gets about $0.090, the platform keeps about $0.813 and the participant still gets $1.000.

### Unfunded liability

- **Today:** none from merchants, because no tokens are credited (pending query A2).
- **If the reward were switched on as written:** the 50 tokens have no value, so the liability would be undefined. A merchant could later claim that "tokens in your pocket" (`Onedream.html:618`) implied money.
- **Participants:** earnings accrue before any chargeback window closes, and reversals are never applied. That is a small but real unfunded risk.

## 8. Comparison of compensation models A–E

Figures are per vote, on a one-vote Paystack payment. "Non-participant half" means the net second dollar, about $0.903 after fees. All rates are illustrative.

| | **A. % of platform share** | **B. Fixed $ per vote** | **C. Hybrid** | **D. Keep 50 tokens** | **E. Separate budget** |
|---|---|---|---|---|---|
| Merchant earns | 5% ≈ $0.045<br>10% ≈ $0.090<br>15% ≈ $0.135<br>20% ≈ $0.181 | e.g. $0.10 | $0.05 cash plus promotional credit (for example One Dream ad credit) | 50 tokens, value undefined, currently never credited | Pro-rata share of a fixed monthly pool |
| Participant | $1.00, unchanged | $1.00 | $1.00 | $1.00 | $1.00 |
| Platform keeps (if second $1 is revenue) | $0.858 / $0.813 / $0.768 / $0.722 | $0.803 | about $0.85 minus the cost of credit | $0.903 | $0.903 minus the pool |
| Payment and withdrawal costs | Payout fees; batch monthly with a $10 minimum | Same | Lower cash payouts | None (no payouts happen) | Same as A |
| Sustainability | Scales with net revenue, so it is never more than the platform earns | Fixed: can exceed the margin on small Paystack payments | Good. Credit costs little if it is ad inventory | Not credible to merchants and creates misleading-promise risk | Strong cost control, weaker incentive |
| Complexity | Medium: needs a ledger, hold and cap | Low to medium | Highest: two balances | None | Medium: monthly allocation job |
| Abuse risk | Self-referral (see 11.3). Self-voting stays unprofitable while participant + merchant < net | Same | Lower cash at risk | n/a | Pool cap limits losses |
| Infrastructure changes | New USD ledger, call site in `creditPaidVotes`, atomic withdrawal, admin payout screen | Same | The same plus a credit balance and ad redemption | Wire the call and fix withdrawal (still worthless) | Same as A plus a pool job |

## 9. Recommended compensation model and justification [RECOMMENDATION]

1. **Decide what the second $1 is.** Either it is a prize pool (as the site says), or it splits into a prize pool plus operations (for example $0.70 prize and $0.30 operations), or it is revenue with a discretionary prize. Update `Onedream.html:1218-1231` to match. This decision comes before everything else.
2. **Keep the participant's $1.00 per vote.** It is enforced, advertised and already being withdrawn.
3. **Fund merchants from the operations portion only,** never from the participant's $1 and never from a published prize amount.
4. **Use model A with model E's cap.** Pay a USD commission of about 10% of the net non-participant half, worked out per payment after the actual processing fee. Cap it per merchant per month and with a global monthly referral budget.
5. **Pay money, not tokens.** Retire the 50-token promise for future votes and update the marketing (`Onedream.html:601-640`, `merchant-register.html`).
6. **Protect existing balances.** Confirm they are zero (A2). If any are non-zero, freeze them as a legacy token balance and honour them only at an owner-approved conversion, separately from the new ledger.
7. **Payout rules:**
   - Hold each commission for 30 days (Paystack chargeback window), then make it available.
   - Reverse it if the payment is refunded or charged back.
   - $10 minimum withdrawal, paid monthly.
8. **Attribution:**
   - Reward votes received by a referred participant for 12 months after the participant registers.
   - Exclude self-referral: block a merchant email that matches the participant's email or the payer's details, and flag shared IP or device.
9. **Sustainability rule:** for any payment, participant plus merchant must stay below net revenue minus the prize allocation. That keeps self-voting unprofitable and the platform solvent.

## 10. Implications for the planned Affiliate Marketplace

- **Separate balances.** A merchant account can hold both income streams, but each needs its own ledger and withdrawal source:
  - vote-referral commission (`source = 'vote_referral'`);
  - marketplace affiliate commission (`source = 'affiliate'`);
  - legacy tokens, frozen.

  The existing `participant_withdrawals.source` pattern (`votes` / `marketplace`) is the precedent.
- **Who funds affiliate commission.** The seller pays it from their net, using the same model as seller commission in `lib/sellerEarnings.js:9-17`, so premium-vote economics are not touched. Fix it on the order at sale.
- **When it becomes payable.** Only after the order reaches `released` (`pages/api/catalogue/order-action.js`). Reverse it on dispute or refund.
- **Prerequisites.** The catalogue checkout findings now fixed (paused listings, invalid prices, payment methods, transaction reuse; see `PAYMENT_SECURITY_FINDINGS.md`) were prerequisites. Before affiliate money flows, the two production checks listed there (`claim_usdt_payment` exists, no browser `UPDATE` on `catalogue_orders`) should be confirmed.

## 11. Security and financial risks (before real money is paid to merchants)

1. **Merchant withdrawal race and no ledger** (`[id]/withdraw.js:28-51`). Switch to `request_merchant_withdrawal()` and add an admin payout queue.
2. **Reward never credited** (`lib/merchantRewards.js` has no caller). When it is wired up, credit it as `pending` with a hold, not straight into an available balance.
3. **Self-referral and self-voting.** Today a merchant can refer their own participant account and buy votes for it. That is not profitable while participant plus merchant is below net, but limits and matching rules are still needed.
4. **No refund or chargeback handling** for votes (`paymentWebhook.js:48`). This affects both participant earnings and any future commission.
5. **Earnings derived from `total_votes`.** Anything that changes `total_votes` creates a $1 liability per vote. That includes manual admin edits and `scripts/reconcile-usdt-payments.mjs:86`, which calls `increment_votes`. A per-payment earnings ledger would be safer.
6. **Ownership checks** on merchant routes: fixed today (`lib/merchantAuth.js` now used).
7. **Duplicate vote crediting:** protected by the `payments` status lifecycle and the USDT claim registry (`lib/voteCredits.js:205-232`).
8. **Marketing claims.** The "1,247+ Active Referrals" figure is hard-coded (`Onedream.html:633`). The token promise and the "who votes" wording should be corrected before launch.

## 12. Required code and database changes per option

| Option | Changes |
|---|---|
| All monetary options (A, B, C, E) | A `merchant_commissions` ledger (merchant, payment_id unique, source, gross, fee, net, rate, amount_usd, status pending→available→paid/reversed, available_at). Call it from `creditPaidVotes` after `succeeded`. Record the processing fee on `payments`. Use the atomic `request_merchant_withdrawal` and the `merchant_withdrawals` ledger. Add an admin merchant payout screen. Add a reversal hook for refunds and chargebacks. Add caps in settings. Update the merchant dashboard (USD instead of tokens). Update marketing copy |
| C | Also a promotional-credit balance and redemption against ad packages |
| E | Also a monthly pool setting and an allocation job |
| D | Wire `creditMerchantReferralReward` and fix the withdrawal race. The tokens remain worthless |
| Prize-pool clarity (any option) | A `vote_allocations` record per payment (participant / prize / operations / fees), so the split is enforced in data, not only in copy |

## 13. Changes requiring owner authorization

- Defining the second $1 (prize pool versus operations) and the public copy.
- The commission rate, caps, hold period, minimum withdrawal and attribution window.
- Retiring the 50-token reward for future votes, and the treatment of any legacy token balances.
- Any change to payment processing, refund handling or the participant earnings formula.
- Applying migrations and deploying.

## 14. Suggested implementation sequence

1. Run the Appendix A queries. Confirm balances and volumes.
2. Owner decides the second-$1 split and the commission parameters, then updates the public copy.
3. Pause merchant withdrawals in the UI until the payout path exists (balances should be zero).
4. Migration: commissions ledger, settings, vote allocation record, fee capture.
5. Wire commission crediting (pending, with hold), the atomic withdrawal, the admin payout queue and the reversal on refunds.
6. Update the merchant dashboard and marketing, and retire the token copy.
7. Pilot with a low cap. Review the numbers after one month.
8. Then build affiliate marketplace commissions on the same ledger pattern (separate source).

---

## Appendix A — read-only verification queries (Supabase SQL editor)

```sql
-- A1. Vote revenue to date by channel
select payment_method, currency, count(*) as payments,
       sum((metadata->>'vote_count')::int) as votes, sum(amount_usd) as gross_usd, sum(amount_ngn) as gross_ngn
from payments where status = 'succeeded' and metadata->>'type' = 'onedream_votes'
group by 1, 2;

-- A2. Merchant token balances and reward history (expected: all zero)
select count(*) as merchants, sum(available_tokens) as available, sum(total_tokens_earned) as earned
from referral_merchants;
select count(*), sum(tokens_awarded) from merchant_referral_rewards;
select count(*), sum(amount) from merchant_withdrawals;

-- A3. Referred participants and the votes they have received
select count(*) as referred_participants, sum(total_votes) as votes_received
from participants where referred_by_merchant_link_id is not null;

-- A4. Participant liability: earned vs withdrawn
select sum(total_votes) * 1.00 as earned_usd,
       (select sum(amount_usd) from participant_withdrawals where source = 'votes' and status <> 'rejected') as withdrawn_usd
from participants;
```
