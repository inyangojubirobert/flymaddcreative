// Creative partner engagements (model 4). The creative partner sells the work
// as an ordinary service listing; the seller buys it through the normal
// marketplace checkout (existing escrow and seller earnings apply). This
// records the brief, deliverables and progress, and can attach a
// performance offer on the products being promoted.
//   GET                                                       mine, as seller and as partner
//   POST  { partner_handle, brief, service_item_id? }          seller proposes to a partner
//   POST  { seller_username, brief, service_item_id? }         partner proposes to a seller
//   PATCH { id, status?, deliverables?, order_id?, performance_offer_id? }

import { earningsDb, must, partnerForParticipant, requireParty } from '../../../lib/earnings';

const NEXT = {
  proposed: ['accepted', 'cancelled'],
  accepted: ['in_progress', 'cancelled'],
  in_progress: ['delivered', 'cancelled'],
  delivered: ['completed', 'in_progress'],
};

export default async function handler(req, res) {
  const party = await requireParty(req, res);
  if (!party) return;
  if (party.party_type !== 'participant') return res.status(403).json({ error: 'Sign in with your One Dream account' });
  const username = party.participant.username;

  try {
    const partner = await partnerForParticipant(party.party_id);
    if (req.method === 'GET') {
      const select = '*, partner:affiliate_partners(handle, display_name), service:catalogue_items(id, title, price_usd)';
      const [asSeller, asPartner] = await Promise.all([
        earningsDb.from('creative_engagements').select(select).eq('seller_username', username).order('created_at', { ascending: false }).limit(100).then(must),
        partner ? earningsDb.from('creative_engagements').select(select).eq('partner_id', partner.id).order('created_at', { ascending: false }).limit(100).then(must) : [],
      ]);
      const rows = [...new Map([...asSeller, ...asPartner].map((e) => [e.id, e])).values()]
        .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
      return res.status(200).json({
        engagements: rows.map((e) => ({ ...e, role: e.seller_username === username ? 'seller' : 'partner' })),
      });
    }

    if (req.method === 'POST') {
      const brief = String(req.body?.brief || '').trim();
      if (brief.length < 5) return res.status(400).json({ error: 'Describe the work' });
      let row;
      if (req.body?.partner_handle) {
        const target = must(await earningsDb.from('affiliate_partners').select('id, participant_id, status')
          .eq('handle', String(req.body.partner_handle).toLowerCase()).maybeSingle());
        if (!target || target.status !== 'active') return res.status(404).json({ error: 'Partner not found' });
        if (target.participant_id === party.party_id) return res.status(400).json({ error: 'You cannot hire yourself' });
        row = { seller_username: username, partner_id: target.id, brief, created_by: 'seller' };
      } else if (req.body?.seller_username) {
        if (!partner) return res.status(404).json({ error: 'Join the partner programme first' });
        const seller = String(req.body.seller_username).toLowerCase();
        if (seller === username.toLowerCase()) return res.status(400).json({ error: 'You cannot propose to yourself' });
        const exists = must(await earningsDb.from('participants').select('id').eq('username', seller).maybeSingle());
        if (!exists) return res.status(404).json({ error: 'Seller not found' });
        row = { seller_username: seller, partner_id: partner.id, brief, created_by: 'partner' };
      } else {
        return res.status(400).json({ error: 'Choose who the engagement is with' });
      }
      if (req.body?.service_item_id) {
        // The service must be the creative partner's own listing.
        const service = must(await earningsDb.from('catalogue_items').select('id, seller_username').eq('id', String(req.body.service_item_id)).maybeSingle());
        const owner = must(await earningsDb.from('affiliate_partners').select('participant:participants(username)').eq('id', row.partner_id).single());
        if (!service || service.seller_username !== owner.participant?.username) return res.status(400).json({ error: 'The service must be the creative partner\'s own listing' });
        row.service_item_id = service.id;
      }
      const data = must(await earningsDb.from('creative_engagements').insert(row).select('*').single());
      return res.status(201).json({ engagement: data });
    }

    if (req.method === 'PATCH') {
      const e = must(await earningsDb.from('creative_engagements').select('*').eq('id', String(req.body?.id || '')).maybeSingle());
      const isSeller = e && e.seller_username === username;
      const isPartner = e && partner && e.partner_id === partner.id;
      if (!isSeller && !isPartner) return res.status(404).json({ error: 'Engagement not found' });
      const patch = { updated_at: new Date().toISOString() };
      if (req.body.status) {
        if (!(NEXT[e.status] || []).includes(req.body.status)) return res.status(400).json({ error: `Can't move from ${e.status} to ${req.body.status}` });
        if (req.body.status === 'completed' && !isSeller) return res.status(403).json({ error: 'Only the seller can mark the work complete' });
        if (req.body.status === 'delivered' && !isPartner) return res.status(403).json({ error: 'Only the creative partner can mark the work delivered' });
        patch.status = req.body.status;
      }
      if (req.body.deliverables !== undefined && isPartner) patch.deliverables = String(req.body.deliverables).slice(0, 2000);
      if (req.body.order_id && isSeller) {
        const order = must(await earningsDb.from('catalogue_orders').select('id, item_id').eq('id', String(req.body.order_id)).maybeSingle());
        if (!order || order.item_id !== e.service_item_id) return res.status(400).json({ error: 'That order is not for this service' });
        patch.order_id = order.id;
      }
      if (req.body.performance_offer_id && isSeller) {
        const offer = must(await earningsDb.from('affiliate_offers').select('id, seller_username').eq('id', String(req.body.performance_offer_id)).maybeSingle());
        if (!offer || offer.seller_username !== username) return res.status(400).json({ error: 'Choose one of your own offers' });
        patch.performance_offer_id = offer.id;
      }
      const data = must(await earningsDb.from('creative_engagements').update(patch).eq('id', e.id).select('*').single());
      return res.status(200).json({ engagement: data });
    }
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (error) {
    console.error('affiliate/engagements error:', error);
    return res.status(500).json({ error: 'Could not update engagements' });
  }
}
