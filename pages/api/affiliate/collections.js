// Storefront collections (curated groups of the partner's approved listings).
//   GET                                                  mine with their memberships
//   POST   { title, slug? }                              create
//   PATCH  { id, title?, sort_order?, add?: [membership_id], remove?: [membership_id] }
//   DELETE ?id=

import { earningsDb, must, requireParty, requirePartner } from '../../../lib/earnings';

const slugify = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);

export default async function handler(req, res) {
  const party = await requireParty(req, res);
  if (!party) return;
  const partner = await requirePartner(req, res, party);
  if (!partner) return;

  try {
    if (req.method === 'GET') {
      const collections = must(await earningsDb.from('affiliate_collections')
        .select('*, items:affiliate_collection_items(membership_id, sort_order)').eq('partner_id', partner.id).order('sort_order'));
      return res.status(200).json({ collections });
    }
    if (req.method === 'POST') {
      const title = String(req.body?.title || '').trim().slice(0, 60);
      const slug = slugify(req.body?.slug || title);
      if (title.length < 2 || slug.length < 2) return res.status(400).json({ error: 'Give the collection a name' });
      const { data, error } = await earningsDb.from('affiliate_collections').insert({ partner_id: partner.id, title, slug }).select('*').single();
      if (error?.code === '23505') return res.status(409).json({ error: 'You already have a collection with that name' });
      if (error) throw error;
      return res.status(201).json({ collection: data });
    }
    if (req.method === 'PATCH') {
      const collection = must(await earningsDb.from('affiliate_collections').select('id').eq('id', String(req.body?.id || '')).eq('partner_id', partner.id).maybeSingle());
      if (!collection) return res.status(404).json({ error: 'Collection not found' });
      const patch = {};
      if (req.body.title) patch.title = String(req.body.title).trim().slice(0, 60);
      if (Number.isInteger(req.body.sort_order)) patch.sort_order = req.body.sort_order;
      if (Object.keys(patch).length) must(await earningsDb.from('affiliate_collections').update(patch).eq('id', collection.id));
      const add = Array.isArray(req.body.add) ? req.body.add.map(String) : [];
      if (add.length) {
        // Only the partner's own approved memberships can go on their storefront.
        const ok = must(await earningsDb.from('affiliate_memberships').select('id').in('id', add).eq('partner_id', partner.id).eq('status', 'approved'));
        if (ok.length) must(await earningsDb.from('affiliate_collection_items').upsert(ok.map((m) => ({ collection_id: collection.id, membership_id: m.id }))));
      }
      const remove = Array.isArray(req.body.remove) ? req.body.remove.map(String) : [];
      if (remove.length) must(await earningsDb.from('affiliate_collection_items').delete().eq('collection_id', collection.id).in('membership_id', remove));
      return res.status(200).json({ success: true });
    }
    if (req.method === 'DELETE') {
      must(await earningsDb.from('affiliate_collections').delete().eq('id', String(req.query.id || '')).eq('partner_id', partner.id));
      return res.status(200).json({ success: true });
    }
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (error) {
    console.error('affiliate/collections error:', error);
    return res.status(500).json({ error: 'Could not update your collections' });
  }
}
