// Seller earnings ledger + marketplace withdrawals for the profile wallet.
//
// GET  -> balances (computed in the database from the seller's orders and
//         marketplace withdrawals - see seller_earnings_summary), each sale with
//         gross / commission / net and its pending-or-withdrawable state, and
//         the marketplace withdrawal history.
// POST -> { amount, method, details }: requests a withdrawal against
//         withdrawable earnings only. request_seller_withdrawal() locks the
//         seller and reserves the amount at once; admins approve, reject or
//         mark it paid through the existing withdrawal workflow.
//
// Earnings become withdrawable only once the buyer confirms delivery. Vote
// rewards are separate (/api/onedream/withdraw).

import { createClient } from '@supabase/supabase-js';
import { requireParticipant } from '../../../lib/participantAuth';
import { ORDER_LEDGER_STATE } from '../../../lib/sellerEarnings';
import { alertAdminsOfWithdrawal } from '../../../lib/withdrawalAlerts';

const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

const money = (value) => Math.round((Number(value) || 0) * 100) / 100;

export default async function handler(req, res) {
  if (!['GET', 'POST'].includes(req.method)) {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  const participant = await requireParticipant(req, res);
  if (!participant) return;

  try {
    if (req.method === 'POST') return await requestWithdrawal(req, res, participant);

    const [summaryResult, ordersResult, withdrawalsResult, legacyResult] = await Promise.all([
      supabase.rpc('seller_earnings_summary', { p_username: participant.username }),
      supabase
        .from('catalogue_orders')
        .select('id, item_id, status, created_at, quantity, unit_price_usd, amount_usd, commission_percent, commission_usd, seller_net_usd, buyer_confirmed_at, disputed_at, released_at, catalogue_items(title, images, listing_type)')
        .eq('seller_username', participant.username)
        .not('commission_percent', 'is', null)
        .order('created_at', { ascending: false })
        .limit(200),
      supabase
        .from('participant_withdrawals')
        .select('id, amount_usd, payment_method, status, created_at, payout_reference, payout_confirmed_at, admin_note')
        .eq('username', participant.username)
        .eq('source', 'marketplace')
        .order('created_at', { ascending: false }),
      supabase
        .from('catalogue_orders')
        .select('id', { count: 'exact', head: true })
        .eq('seller_username', participant.username)
        .is('commission_percent', null),
    ]);
    for (const result of [summaryResult, ordersResult, withdrawalsResult]) {
      if (result.error) throw result.error;
    }

    const s = (Array.isArray(summaryResult.data) ? summaryResult.data[0] : summaryResult.data) || {};
    const sales = (ordersResult.data || []).map((order) => ({
      order_id: order.id,
      item_id: order.item_id,
      title: order.catalogue_items?.title || 'Listing',
      image: order.catalogue_items?.images?.[0] || null,
      listing_type: order.catalogue_items?.listing_type || 'product',
      quantity: order.quantity || 1,
      gross_usd: money(order.amount_usd),
      commission_percent: Number(order.commission_percent),
      commission_usd: money(order.commission_usd),
      net_usd: money(order.seller_net_usd),
      order_status: order.status,
      ledger_state: ORDER_LEDGER_STATE[order.status] || 'excluded',
      created_at: order.created_at,
      buyer_confirmed_at: order.buyer_confirmed_at,
      disputed_at: order.disputed_at,
    }));

    return res.status(200).json({
      currency: 'USD',
      completed_sales_usd: money(s.completed_gross_usd),
      commission_deducted_usd: money(s.commission_usd),
      earned_withdrawable_usd: money(s.withdrawable_earned_usd),
      pending_earnings_usd: money(s.pending_net_usd),
      pending_orders: Number(s.pending_count) || 0,
      on_hold_usd: money(s.on_hold_net_usd),
      withdrawals_pending_usd: money(s.withdrawals_pending_usd),
      withdrawals_paid_usd: money(s.withdrawals_paid_usd),
      available_usd: Math.max(0, money(s.available_usd)),
      balance_owed_usd: money(s.available_usd) < 0 ? money(-s.available_usd) : 0,
      legacy_orders: legacyResult.count || 0,
      sales,
      withdrawals: withdrawalsResult.data || [],
    });
  } catch (error) {
    console.error('marketplace-wallet error:', error);
    return res.status(500).json({ error: 'Could not load marketplace earnings' });
  }
}

async function requestWithdrawal(req, res, participant) {
  const amount = Math.round(Number(req.body?.amount) * 100) / 100;
  const method = typeof req.body?.method === 'string' ? req.body.method.trim().slice(0, 100) : '';
  const details = typeof req.body?.details === 'string' ? req.body.details.trim().slice(0, 500) : '';
  if (!(amount > 0)) return res.status(400).json({ error: 'Enter a valid amount' });
  if (!method || !details) return res.status(400).json({ error: 'Enter a payout method and account/wallet details' });

  const { data, error } = await supabase.rpc('request_seller_withdrawal', {
    p_participant_id: participant.id,
    p_amount: amount,
    p_method: method,
    p_details: details,
  });
  if (error) {
    if (error.message?.includes('insufficient_balance')) {
      return res.status(400).json({ error: 'Amount exceeds your withdrawable marketplace earnings' });
    }
    if (error.message?.includes('participant_not_found')) return res.status(404).json({ error: 'Account not found' });
    throw error;
  }
  const result = Array.isArray(data) ? data[0] : data;

  const { data: profile } = await supabase.from('participants').select('id, name, username').eq('id', participant.id).single();
  await alertAdminsOfWithdrawal(supabase, {
    participant: profile || participant,
    withdrawalId: result?.withdrawal_id,
    amountUsd: amount,
    source: 'marketplace',
    method,
  });

  return res.status(200).json({ success: true, withdrawal_id: result?.withdrawal_id, available_usd: money(result?.available_balance) });
}
