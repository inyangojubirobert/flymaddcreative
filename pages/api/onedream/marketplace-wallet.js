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
// P9: naira-settled sales (multi-currency listings) have their own balance,
// `naira`, paid out in naira through the same manual withdrawal workflow
// (POST with currency: 'NGN'). The USD figures exclude them (P8).
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

    const withdrawalsFor = (columns) => supabase
        .from('participant_withdrawals')
        .select(columns)
        .eq('username', participant.username)
        .eq('source', 'marketplace')
        .order('created_at', { ascending: false });
    const LEGACY_WITHDRAWAL_COLUMNS = 'id, amount_usd, payment_method, status, created_at, payout_reference, payout_confirmed_at, admin_note';
    // eslint-disable-next-line prefer-const
    let [summaryResult, ordersResult, withdrawalsResult, legacyResult, nairaResult] = await Promise.all([
      supabase.rpc('seller_earnings_summary', { p_username: participant.username }),
      supabase
        .from('catalogue_orders')
        .select('id, item_id, status, created_at, quantity, unit_price_usd, amount_usd, commission_percent, commission_usd, seller_net_usd, buyer_confirmed_at, disputed_at, released_at, catalogue_items(title, images, listing_type)')
        .eq('seller_username', participant.username)
        .not('commission_percent', 'is', null)
        .order('created_at', { ascending: false })
        .limit(200),
      withdrawalsFor(`${LEGACY_WITHDRAWAL_COLUMNS}, amount_ngn, currency`),
      supabase
        .from('catalogue_orders')
        .select('id', { count: 'exact', head: true })
        .eq('seller_username', participant.username)
        .is('commission_percent', null),
      supabase.rpc('seller_earnings_summary_ngn', { p_username: participant.username }),
    ]);
    // Before P8/P9's SQL is applied the naira columns and function don't exist yet:
    // keep serving the USD wallet exactly as before.
    if (withdrawalsResult.error?.code === '42703') withdrawalsResult = await withdrawalsFor(LEGACY_WITHDRAWAL_COLUMNS);
    for (const result of [summaryResult, ordersResult, withdrawalsResult]) {
      if (result.error) throw result.error;
    }

    const s = (Array.isArray(summaryResult.data) ? summaryResult.data[0] : summaryResult.data) || {};
    if (nairaResult.error) console.error('marketplace-wallet: naira wallet unavailable (P9 SQL not applied?):', nairaResult.error.message);
    const n = nairaResult.error ? null : (Array.isArray(nairaResult.data) ? nairaResult.data[0] : nairaResult.data) || {};
    // Each sale in the currency it settles in (frozen at checkout).
    const orderIds = (ordersResult.data || []).map((order) => order.id);
    const { data: snapshots, error: snapshotError } = orderIds.length
      ? await supabase.from('order_financial_snapshots').select('order_id, settlement_currency, charged_minor, commission_minor, seller_earnings_minor').in('order_id', orderIds)
      : { data: [] };
    if (snapshotError) throw snapshotError;
    const snapshotByOrder = new Map((snapshots || []).map((row) => [row.order_id, row]));
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
      ...settledIn(snapshotByOrder.get(order.id)),
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
      naira: n ? {
        completed_sales_ngn: money(n.completed_gross_ngn),
        commission_deducted_ngn: money(n.commission_ngn),
        pending_earnings_ngn: money(n.pending_net_ngn),
        pending_orders: Number(n.pending_count) || 0,
        on_hold_ngn: money(n.on_hold_net_ngn),
        withdrawals_pending_ngn: money(n.withdrawals_pending_ngn),
        withdrawals_paid_ngn: money(n.withdrawals_paid_ngn),
        available_ngn: Math.max(0, money(n.available_ngn)),
        balance_owed_ngn: money(n.available_ngn) < 0 ? money(-n.available_ngn) : 0,
      } : undefined,
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

  const naira = req.body?.currency === 'NGN';
  const { data, error } = await supabase.rpc(naira ? 'request_seller_withdrawal_ngn' : 'request_seller_withdrawal', {
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
    if (error.message?.includes('rate_unavailable')) {
      return res.status(503).json({ error: 'Naira withdrawals are paused while exchange rates update. Please try again shortly.' });
    }
    throw error;
  }
  const result = Array.isArray(data) ? data[0] : data;

  const { data: profile } = await supabase.from('participants').select('id, name, username').eq('id', participant.id).single();
  let alertUsd = amount;
  if (naira) {
    const { data: row } = await supabase.from('participant_withdrawals').select('amount_usd').eq('id', result?.withdrawal_id).maybeSingle();
    alertUsd = Number(row?.amount_usd) || 0;
  }
  await alertAdminsOfWithdrawal(supabase, {
    participant: profile || participant,
    withdrawalId: result?.withdrawal_id,
    amountUsd: alertUsd,
    source: 'marketplace',
    method: naira ? `${method} - pay NGN ${amount.toLocaleString('en-US', { minimumFractionDigits: 2 })} (naira earnings)` : method,
  });

  return res.status(200).json({
    success: true,
    withdrawal_id: result?.withdrawal_id,
    currency: naira ? 'NGN' : 'USD',
    ...(naira ? { available_ngn: money(result?.available_balance) } : { available_usd: money(result?.available_balance) }),
  });
}

/** P9: a sale's figures in its settlement currency, from the frozen snapshot (USD when there is none). */
function settledIn(snapshot) {
  if (!snapshot || snapshot.settlement_currency === 'USD') return { settlement_currency: 'USD' };
  return {
    settlement_currency: snapshot.settlement_currency,
    gross_local: Number(snapshot.charged_minor) / 100,
    commission_local: Number(snapshot.commission_minor) / 100,
    net_local: Number(snapshot.seller_earnings_minor) / 100,
  };
}
