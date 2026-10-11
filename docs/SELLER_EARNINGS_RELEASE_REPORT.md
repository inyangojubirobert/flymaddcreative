# Release report — Seller earnings ledger, marketplace withdrawals, private order contacts

**Date:** 2026-10-11 · **Commit:** `08c6f51` · **App:** 1.0.16 (versionCode 18)
**Status:** ✅ Live on www.flymaddcreative.online, the web app (`/app`) and Android.

---

## 1. What shipped

| Area | Change |
|---|---|
| **Seller commission** | 5% by default (`marketplace_fee_settings.seller_commission_percent`), fixed on each order when it is bought. Each order stores `commission_percent`, `commission_usd` and `seller_net_usd`, and the database enforces `commission + net = sale price`. |
| **Wallet → Marketplace earnings** | Withdrawable balance; earnings awaiting buyer confirmation (visible, with a "buyer has not confirmed" notice, not withdrawable); disputes on hold; completed sales; commission deducted; withdrawals pending and paid; per-sale breakdown (product, order ref, qty, price, commission, net, state); withdrawal history. Vote rewards stay in their own tab and balance. |
| **Marketplace withdrawals** | Requests go into the existing `participant_withdrawals` table (`source = 'marketplace'`). Funds are reserved immediately, the existing admin screens show the source and the seller's private phone, and admins get a phone alert. Rejection returns the amount, a paid request can't be paid twice, and the seller is messaged at each step. |
| **Private contacts** | Seller phone/WhatsApp (My Shop; required in the app before publishing). Buyer phone (required at checkout) and delivery address (physical products). Visible only to that order's seller and admins. |
| **Order privacy** | Orders are read only through the API: the buyer with their order token, the seller with their login (own orders, no buyer tokens), admins with their login. |
| **Audit trail** | Every order status change is recorded in `catalogue_order_events`, with confirmation, dispute and release timestamps. |
| **Seller order cards** | Buyer contact with WhatsApp/Call buttons, delivery address, commission and net, and a pending-confirmation notice. |

## 2. Database — live crosscheck (read-only, after the scripts were run)

All three scripts are applied: `add_marketplace_fee_settings.sql`, `add_seller_earnings.sql`, `lockdown_catalogue_orders_read.sql`.

**18 / 18 checks passed**

| Check | Result |
|---|---|
| Fee settings row | 1% buyer fee, $1.00 cap, 5% seller commission |
| `catalogue_checkouts.fee_cap_usd`, `delivery_address` | ✅ |
| Order ledger columns (commission, net, delivery, status timestamps, checkout, quantity) | ✅ |
| `catalogue_order_events` table | ✅ |
| `participant_withdrawals.source`; no withdrawal without a source | ✅ (0 missing) |
| `participant_private_contacts` table | ✅ |
| `seller_earnings_summary()`, `claim_usdt_payment()` callable by the server | ✅ |
| Existing orders kept out of the ledger | ✅ (no orders existed yet: the ledger starts clean) |
| Public (anon) key blocked from orders, checkouts, contacts, fee settings and the audit trail | ✅ all `42501` |
| Public key blocked from the withdrawal and earnings functions | ✅ `42501` |

## 3. Tests

| Suite | Result |
|---|---|
| **Migrations + money logic** on a local Postgres (PGlite) with production-shaped tables: all three scripts' own verification queries, plus 24 scenarios (pending vs withdrawable, commission constraint, confirmation timestamps and audit, overdraw and sub-cent rejection, reservation and restore on rejection, single payout, vote and marketplace balances kept separate, disputes on hold, refund after payout showing as owed, idempotent cart checkout, client-role privileges, order lockdown) | **27 / 27 pass** |
| **Commission rounding**: gross = commission + net to the cent, 171,432 price × rate combinations | **0 mismatches** |
| **App typecheck** (`tsc --noEmit`) | ✅ clean |
| **Preview deployment**, read-only calls against the live database: marketplace wallet, vote wallet, seller orders and private contact (logged in → 200; no login → 401); buyer order with a wrong token → 404; cart quote reading the fee from the database | ✅ |
| **Production**: new routes respond correctly, `/app` serves the new build, the website loads orders through the API | ✅ |
| **Android**: release build 1.0.16 (18) installed on the test phone with `adb install -r` | ✅ |

Not covered by automated tests: two withdrawal requests from one seller at the same instant. This uses the same row-lock pattern as the existing vote withdrawals.

## 4. Before announcing seller commission

1. **Tell sellers** about the 5% commission. Only orders placed from now on carry it.
2. **Each seller adds their private contact** in My Shop. The app asks for it before publishing.
3. **Run one real low-value purchase end to end:**
   - Buyer pays; the order appears with the buyer's phone and address for the seller.
   - Buyer and seller exchange messages in the order chat (*Message seller* / *Message buyer*).
   - Buyer confirms delivery; the seller's earnings move from "Awaiting buyer" to withdrawable.
   - Seller requests a withdrawal; the admin gets the alert, marks it paid with a reference, and the seller is notified.
4. **Reconcile monthly:** sellers' net earnings on completed orders, minus paid withdrawals, should match the funds held.

## 5. Known gaps (not in this release)

- No push notification for new order-chat messages.
- A guest buyer needs their order link (*Copy link* on the success screen) to return to the chat.
- The website seller dashboard (`user-dashboard.html`) has no Marketplace earnings section yet. Desktop sellers use the web app at `/app`.
- Single-listing checkout has no buyer service charge.
- Refunds are processed manually. A refund after payout shows as an amount owed and blocks further withdrawals until it's cleared.
