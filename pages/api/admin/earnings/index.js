// Admin overview of partner & creator earnings, the affiliate marketplace,
// Google Play settlement and payouts (read only).
//   GET -> { settings, totals, signals, payouts, payees, batches, lots, partners,
//            offers, creatives, attributions, rewards, engagements, audit }
// `signals` flag things worth a look; nothing is changed automatically:
//   unreconciled_lot   earning coin lot older than 45 days with no Google report
//   negative_balance   a payee whose withdrawable balance is below zero (refund after payout)
//   high_conversion    partner with >= 10 attributed orders and >= 50% of clicks converting
//   repeat_refunds     partner with >= 3 reversed attributions in 30 days
//   self_referral      attribution excluded because the partner was the buyer or the seller

import { requireActiveAdmin } from '../../../../lib/adminAuth';
import { earningsDb, getEarningsSettings, must, payoutsLiveInDeployment } from '../../../../lib/earnings';

const daysAgo = (d) => new Date(Date.now() - d * 86400e3).toISOString();

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const admin = await requireActiveAdmin(req, res, earningsDb);
  if (!admin) return;

  try {
    const [settings, payouts, payees, batches, lots, partners, offers, creatives, attributions, rewards, engagements, audit, ledgerTotals] = await Promise.all([
      getEarningsSettings(),
      earningsDb.from('payout_requests').select('*').order('created_at', { ascending: false }).limit(100).then(must),
      earningsDb.from('payee_profiles').select('*').order('updated_at', { ascending: false }).limit(100).then(must),
      earningsDb.from('play_settlement_batches').select('*').order('imported_at', { ascending: false }).limit(24).then(must),
      earningsDb.from('coin_lots').select('id, participant_id, source, order_id, buyer_region, coins_total, coins_remaining, coins_refunded, earning, gross_micro, provisional_net_micro, settled_net_micro, settlement_status, created_at')
        .eq('earning', true).order('created_at', { ascending: false }).limit(100).then(must),
      earningsDb.from('affiliate_partners').select('*, participant:participants(username)').order('created_at', { ascending: false }).limit(100).then(must),
      earningsDb.from('affiliate_offers').select('*, item:catalogue_items(title, price_usd)').order('updated_at', { ascending: false }).limit(100).then(must),
      earningsDb.from('affiliate_creatives').select('*, membership:affiliate_memberships(partner:affiliate_partners(handle), offer:affiliate_offers(item:catalogue_items(title)))')
        .eq('status', 'pending').order('created_at').limit(100).then(must),
      earningsDb.from('affiliate_attributions').select('*, partner:affiliate_partners(handle)').order('created_at', { ascending: false }).limit(200).then(must),
      earningsDb.from('referral_rewards').select('*, merchant:referral_merchants(merchant_name)').order('created_at', { ascending: false }).limit(100).then(must),
      earningsDb.from('creative_engagements').select('*, partner:affiliate_partners(handle)').order('created_at', { ascending: false }).limit(50).then(must),
      earningsDb.from('earnings_admin_audit').select('*').order('id', { ascending: false }).limit(100).then(must),
      earningsDb.from('partner_ledger').select('party_type, party_id, source, bucket, amount_micro').limit(50000).then(must),
    ]);

    // Per-party available balances (for negative-balance signals) and bucket totals.
    const totals = { pending: 0, available: 0, reserved: 0, paid: 0 };
    const available = new Map();
    for (const row of ledgerTotals) {
      totals[row.bucket] += Number(row.amount_micro);
      if (row.bucket === 'available') {
        const key = `${row.party_type}:${row.party_id}:${row.source}`;
        available.set(key, (available.get(key) || 0) + Number(row.amount_micro));
      }
    }

    const clickCounts = must(await earningsDb.from('affiliate_clicks').select('partner_id').gte('created_at', daysAgo(30)).limit(50000));
    const clicksBy = clickCounts.reduce((m, c) => m.set(c.partner_id, (m.get(c.partner_id) || 0) + 1), new Map());
    const handle = (id) => partners.find((p) => p.id === id)?.handle || id;

    const signals = [
      ...lots.filter((l) => l.settlement_status === 'unreported' && l.created_at < daysAgo(45))
        .map((l) => ({ type: 'unreconciled_lot', detail: `lot ${l.id.slice(0, 8)} order ${l.order_id || '?'} has no Google report after 45 days` })),
      ...[...available.entries()].filter(([, v]) => v < 0)
        .map(([k, v]) => ({ type: 'negative_balance', detail: `${k} available ${(v / 1e6).toFixed(2)} USD` })),
      ...[...new Set(attributions.map((a) => a.partner_id))].flatMap((pid) => {
        const mine = attributions.filter((a) => a.partner_id === pid && a.created_at >= daysAgo(30));
        const out = [];
        const converted = mine.filter((a) => !['excluded', 'reversed'].includes(a.status)).length;
        const clicks = clicksBy.get(pid) || 0;
        if (converted >= 10 && clicks && converted / clicks >= 0.5) out.push({ type: 'high_conversion', detail: `@${handle(pid)}: ${converted} orders from ${clicks} clicks` });
        const reversed = mine.filter((a) => a.status === 'reversed').length;
        if (reversed >= 3) out.push({ type: 'repeat_refunds', detail: `@${handle(pid)}: ${reversed} reversed attributions in 30 days` });
        const self = mine.filter((a) => a.status === 'excluded' && /partner_is_(buyer|seller)/.test(a.status_reason || '')).length;
        if (self) out.push({ type: 'self_referral', detail: `@${handle(pid)}: ${self} self-referral attempt(s)` });
        return out;
      }),
    ];

    return res.status(200).json({
      settings, payouts_provider_live: payoutsLiveInDeployment(), totals, signals,
      payouts, payees, batches, lots, partners, offers, creatives, attributions, rewards, engagements, audit,
    });
  } catch (error) {
    console.error('admin/earnings error:', error);
    return res.status(500).json({ error: 'Could not load earnings data' });
  }
}
