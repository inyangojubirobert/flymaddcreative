// Seller: marketplace earnings per settlement currency (NGN from naira
// listings, USD from everything paid in USDT). Read only. Withdrawals keep
// using the existing wallet (USD) until P8/P9 add naira balances and payouts.
//   GET -> { balances: [{ currency, pending_micro, on_hold_micro, withdrawable_micro, orders }] }

import { requireParticipant } from '../../../lib/participantAuth';
import { currencyDb } from '../../../lib/marketplaceCurrency';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const participant = await requireParticipant(req, res);
  if (!participant) return;
  try {
    const { data, error } = await currencyDb.rpc('seller_earnings_by_currency', { p_username: participant.username });
    if (error) throw error;
    return res.status(200).json({ balances: (data || []).map((r) => ({ ...r, pending_micro: Number(r.pending_micro), on_hold_micro: Number(r.on_hold_micro), withdrawable_micro: Number(r.withdrawable_micro) })) });
  } catch (error) {
    console.error('marketplace/seller-earnings error:', error);
    return res.status(500).json({ error: 'Could not load earnings' });
  }
}
