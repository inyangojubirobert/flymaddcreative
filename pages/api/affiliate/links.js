// The partner's tracked links.
//   GET                                                 mine, with click counts and share URLs
//   POST { target: 'membership' | 'storefront' | 'collection', membership_id?, collection_id? }
// Share URLs: <site>/r/<code>. A storefront link is created automatically.

import { createAffiliateLink, earningsDb, ensureStorefrontLink, must, requireParty, requirePartner, siteUrl } from '../../../lib/earnings';

export default async function handler(req, res) {
  const party = await requireParty(req, res);
  if (!party) return;
  const partner = await requirePartner(req, res, party);
  if (!partner) return;

  try {
    if (req.method === 'GET') {
      await ensureStorefrontLink(partner.id);
      const links = must(await earningsDb.from('affiliate_links').select('*').eq('partner_id', partner.id).order('created_at'));
      return res.status(200).json({ links: links.map((l) => ({ ...l, url: `${siteUrl()}/r/${l.code}` })) });
    }
    if (req.method === 'POST') {
      const target = String(req.body?.target || '');
      if (target === 'storefront') {
        const link = await ensureStorefrontLink(partner.id);
        return res.status(200).json({ link: { ...link, url: `${siteUrl()}/r/${link.code}` } });
      }
      let row;
      if (target === 'membership') {
        const membership = must(await earningsDb.from('affiliate_memberships').select('id, status').eq('id', String(req.body?.membership_id || ''))
          .eq('partner_id', partner.id).maybeSingle());
        if (!membership || membership.status !== 'approved') return res.status(400).json({ error: 'This partnership is not approved yet' });
        row = { partner_id: partner.id, target, membership_id: membership.id };
      } else if (target === 'collection') {
        const collection = must(await earningsDb.from('affiliate_collections').select('id').eq('id', String(req.body?.collection_id || ''))
          .eq('partner_id', partner.id).maybeSingle());
        if (!collection) return res.status(404).json({ error: 'Collection not found' });
        row = { partner_id: partner.id, target, collection_id: collection.id };
      } else {
        return res.status(400).json({ error: 'Unknown link target' });
      }
      const link = await createAffiliateLink(row);
      return res.status(201).json({ link: { ...link, url: `${siteUrl()}/r/${link.code}` } });
    }
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (error) {
    console.error('affiliate/links error:', error);
    return res.status(500).json({ error: 'Could not update your links' });
  }
}
