// Seller's digital sales ledger (separate from marketplace escrow earnings).
// Gross = tier price paid; minus the Google Play fee and One Dream's
// commission = net. Net is pending for the hold period, then cleared; One Dream
// pays cleared earnings out after reconciling with Google Play's payouts.
// Refunds reverse the sale.
//   GET

import { requireParticipant } from '../../../lib/participantAuth';
import { digitalDb, digitalSettings } from '../../../lib/digital';

const money = (v) => Math.round((Number(v) || 0) * 100) / 100;

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const participant = await requireParticipant(req, res);
  if (!participant) return;
  try {
    const [summary, sales, settings] = await Promise.all([
      digitalDb.rpc('digital_earnings_summary', { p_seller: participant.username }),
      digitalDb.from('digital_earnings').select('*')
        .eq('seller_username', participant.username).order('created_at', { ascending: false }).limit(100),
      digitalSettings(),
    ]);
    if (summary.error) throw summary.error;
    if (sales.error) throw sales.error;
    const s = (Array.isArray(summary.data) ? summary.data[0] : summary.data) || {};
    const now = Date.now();
    return res.status(200).json({
      currency: 'USD',
      store_fee_percent: Number(settings.store_fee_percent),
      commission_percent: Number(settings.commission_percent),
      hold_hours: settings.hold_hours,
      sales: s.sales || 0,
      gross_usd: money(s.gross_usd),
      store_fees_usd: money(s.store_fees_usd),
      commission_usd: money(s.commission_usd),
      pending_usd: money(s.pending_usd),
      cleared_usd: money(s.cleared_usd),
      paid_out_usd: money(s.paid_out_usd),
      reversed_usd: money(s.reversed_usd),
      recent: (sales.data || []).map(({ license_id: _l, subscription_payment_id: _s, payout_reference: _p, ...e }) => ({
        ...e,
        source: e.source || 'purchase',
        gross_usd: money(e.gross_usd), store_fee_usd: money(e.store_fee_usd), commission_usd: money(e.commission_usd), net_usd: money(e.net_usd),
        state: e.status === 'pending' ? (new Date(e.clears_at).getTime() <= now ? 'cleared' : 'pending') : e.status,
      })),
    });
  } catch (error) {
    console.error('digital/earnings error:', error);
    return res.status(500).json({ error: 'Could not load digital earnings' });
  }
}
