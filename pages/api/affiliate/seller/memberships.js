// Seller side: partners on your offers.
//   GET                                                -> requests first, then approved / closed
//   POST { membership_id, decision: 'approve' | 'reject' | 'revoke', note? }
// Revoking stops new attribution at once; earnings already recorded follow
// their orders as normal.

import { earningsDb, must, requireParty } from '../../../../lib/earnings';

const ALLOWED = { approve: ['requested'], reject: ['requested'], revoke: ['approved'] };
const RESULT = { approve: 'approved', reject: 'rejected', revoke: 'revoked' };

export default async function handler(req, res) {
  const party = await requireParty(req, res);
  if (!party) return;
  if (party.party_type !== 'participant') return res.status(403).json({ error: 'Sign in with the account that owns the listings' });
  const username = party.participant.username;

  try {
    const offers = must(await earningsDb.from('affiliate_offers').select('id, item_id').eq('seller_username', username));
    if (req.method === 'GET') {
      if (!offers.length) return res.status(200).json({ memberships: [] });
      const rows = must(await earningsDb.from('affiliate_memberships')
        .select('id, model, status, resale_price_usd, created_at, decided_at, offer_id, partner:affiliate_partners(handle, display_name), offer:affiliate_offers(item:catalogue_items(title))')
        .in('offer_id', offers.map((o) => o.id)).order('created_at', { ascending: false }));
      const order = { requested: 0, approved: 1, rejected: 2, revoked: 3 };
      return res.status(200).json({ memberships: rows.sort((a, b) => order[a.status] - order[b.status]) });
    }
    if (req.method === 'POST') {
      const decision = String(req.body?.decision || '');
      if (!ALLOWED[decision]) return res.status(400).json({ error: 'Unknown decision' });
      const membership = must(await earningsDb.from('affiliate_memberships').select('id, status, offer_id').eq('id', String(req.body?.membership_id || '')).maybeSingle());
      if (!membership || !offers.some((o) => o.id === membership.offer_id)) return res.status(404).json({ error: 'Partnership not found' });
      if (!ALLOWED[decision].includes(membership.status)) return res.status(400).json({ error: `This partnership is ${membership.status}` });
      must(await earningsDb.from('affiliate_memberships').update({
        status: RESULT[decision], decided_at: new Date().toISOString(),
        decided_note: req.body?.note ? String(req.body.note).slice(0, 300) : null, updated_at: new Date().toISOString(),
      }).eq('id', membership.id));
      return res.status(200).json({ success: true, status: RESULT[decision] });
    }
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (error) {
    console.error('affiliate/seller/memberships error:', error);
    return res.status(500).json({ error: 'Could not update partnerships' });
  }
}
