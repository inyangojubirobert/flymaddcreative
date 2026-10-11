// Seller commission and earnings. Commission is fixed on each order when it is
// created (from marketplace_fee_settings), so later rate changes never alter
// past sales. Balances are computed in the database from the orders
// themselves (seller_earnings_summary in supabase/add_seller_earnings.sql).
// All amounts are USD.

import { buyerFeePolicy, fromCents, toCents } from './marketplaceFees';

/** Commission fields for one order line: gross = commission + net, exactly. */
export function commissionFields(grossUsd, percent) {
  const grossCents = toCents(grossUsd);
  const pct = Math.max(0, Math.min(50, Number(percent) || 0));
  const commissionCents = Math.round(grossCents * pct / 100);
  return {
    commission_percent: pct,
    commission_usd: fromCents(commissionCents),
    seller_net_usd: fromCents(grossCents - commissionCents),
  };
}

export async function sellerCommissionPercent(supabase) {
  const policy = await buyerFeePolicy(supabase);
  return policy.sellerCommissionPercent;
}

export const ORDER_LEDGER_STATE = {
  paid: 'pending',
  pending_verification: 'pending',
  disputed: 'on_hold',
  buyer_confirmed: 'withdrawable',
  released: 'withdrawable',
};

/** Seller-facing order fields: never the buyer_token (it authorises buyer actions). */
export const SELLER_ORDER_FIELDS = [
  'id', 'item_id', 'checkout_id', 'seller_username', 'status', 'created_at', 'updated_at',
  'buyer_name', 'buyer_email', 'buyer_whatsapp', 'delivery_address', 'notes',
  'quantity', 'unit_price_usd', 'amount_usd', 'commission_percent', 'commission_usd', 'seller_net_usd',
  'payment_method', 'currency', 'payment_ref', 'tx_hash',
  'buyer_confirmed_at', 'disputed_at', 'released_at',
].join(', ');
