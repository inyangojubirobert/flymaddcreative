// The partner's offer memberships.
//   GET                                   mine, with listing, links and creatives
//   POST  { offer_id, model, resale_price_usd? }   join (auto or seller approval)
//   PATCH { membership_id, resale_price_usd }      change a resale price (floor/ceiling, once a day)

import { earningsDb, must, requireParty, requirePartner } from '../../../lib/earnings';
import { affiliateErrorReply } from '../../../lib/earningsRules';

export default async function handler(req, res) {
  const party = await requireParty(req, res);
  if (!party) return;
  const partner = await requirePartner(req, res, party);
  if (!partner) return;

  try {
    if (req.method === 'GET') {
      const rows = must(await earningsDb.from('affiliate_memberships')
        .select('*, offer:affiliate_offers(id, funding, commission_percent, allow_resale, resale_floor_usd, resale_ceiling_usd, fulfilment, status, item:catalogue_items(id, title, price_usd, images, seller_username))')
        .eq('partner_id', partner.id).order('created_at', { ascending: false }));
      const [links, creatives] = await Promise.all([
        earningsDb.from('affiliate_links').select('id, code, target, membership_id, collection_id, clicks, created_at').eq('partner_id', partner.id).then(must),
        rows.length ? earningsDb.from('affiliate_creatives').select('*').in('membership_id', rows.map((r) => r.id)).then(must) : [],
      ]);
      return res.status(200).json({
        memberships: rows.map((m) => ({
          ...m,
          links: links.filter((l) => l.membership_id === m.id),
          creatives: creatives.filter((c) => c.membership_id === m.id),
        })),
      });
    }
    if (req.method === 'POST') {
      const model = String(req.body?.model || '');
      const price = req.body?.resale_price_usd === undefined || req.body?.resale_price_usd === null ? null : Number(req.body.resale_price_usd);
      const { data, error } = await earningsDb.rpc('affiliate_join_offer', {
        p_partner: partner.id, p_offer: String(req.body?.offer_id || ''), p_model: model, p_resale_price: price,
      });
      if (error) {
        const reply = affiliateErrorReply(error.message);
        if (reply) return res.status(reply.status).json(reply.body);
        throw error;
      }
      return res.status(200).json(data);
    }
    if (req.method === 'PATCH') {
      const { error } = await earningsDb.rpc('affiliate_set_resale_price', {
        p_partner: partner.id, p_membership: String(req.body?.membership_id || ''), p_price: Number(req.body?.resale_price_usd),
      });
      if (error) {
        const reply = affiliateErrorReply(error.message);
        if (reply) return res.status(reply.status).json(reply.body);
        throw error;
      }
      return res.status(200).json({ success: true });
    }
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (error) {
    console.error('affiliate/memberships error:', error);
    return res.status(500).json({ error: 'Could not update your partnerships' });
  }
}
