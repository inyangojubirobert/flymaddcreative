// Seller setup of a digital product on one of their own product listings.
//   GET  ?item_id=               -> settings, files, price tiers
//   POST { item_id, kind, tier_id, preview_pages, preview_seconds, rights_confirmed, in_subscription }  -> save
//   POST { item_id, action: 'submit' }  -> send for review
// The listing price follows the chosen Google Play price tier. Changing the
// files or kind of a published product sends it back to review; changing the
// price tier does not (purchases are checked against the tier actually paid).

import { requireParticipant } from '../../../lib/participantAuth';
import { digitalDb } from '../../../lib/digital';
import { KIND_ASSETS } from '../../../lib/digitalMedia';

async function ownListing(participant, itemId) {
  const { data } = await digitalDb.from('catalogue_items').select('id, seller_username, status, listing_type, title')
    .eq('id', String(itemId || '')).maybeSingle();
  if (!data || data.seller_username !== participant.username || data.status === 'deleted') return null;
  return data;
}

export default async function handler(req, res) {
  const participant = await requireParticipant(req, res);
  if (!participant) return;

  try {
    if (req.method === 'GET') {
      const listing = await ownListing(participant, req.query.item_id);
      if (!listing) return res.status(404).json({ error: 'Listing not found' });
      const [product, assets, tiers] = await Promise.all([
        digitalDb.from('digital_products').select('*').eq('item_id', listing.id).maybeSingle(),
        digitalDb.from('digital_assets').select('id, kind, title, position, format, bytes, pages, duration_seconds, status, created_at').eq('item_id', listing.id).neq('status', 'removed').order('position'),
        digitalDb.from('digital_price_tiers').select('id, price_usd, is_active').eq('is_active', true).order('price_usd'),
      ]);
      const { count } = await digitalDb.from('digital_licenses').select('id', { count: 'exact', head: true }).eq('item_id', listing.id).eq('status', 'active');
      return res.status(200).json({
        listing,
        product: product.data,
        assets: assets.data || [],
        tiers: (tiers.data || []).map((t) => ({ ...t, price_usd: Number(t.price_usd) })),
        active_licenses: count || 0,
      });
    }

    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
    const listing = await ownListing(participant, req.body?.item_id);
    if (!listing) return res.status(404).json({ error: 'Listing not found' });
    if (listing.listing_type && listing.listing_type !== 'product') return res.status(400).json({ error: 'Only product listings can be sold as digital content' });

    const { data: existing } = await digitalDb.from('digital_products').select('*').eq('item_id', listing.id).maybeSingle();

    if (req.body?.action === 'submit') {
      if (!existing) return res.status(400).json({ error: 'Set up the digital product first' });
      if (!existing.rights_confirmed) return res.status(400).json({ error: 'Confirm you own the rights to this content' });
      const { data: assets } = await digitalDb.from('digital_assets').select('kind, status').eq('item_id', listing.id).in('status', ['pending', 'approved']);
      const allowed = KIND_ASSETS[existing.kind];
      if (!(assets || []).some((a) => allowed.includes(a.kind))) return res.status(400).json({ error: 'Upload at least one file first' });
      if (!['draft', 'rejected'].includes(existing.status)) return res.status(409).json({ error: 'Already submitted' });
      await digitalDb.from('digital_products').update({ status: 'pending_review', updated_at: new Date().toISOString() }).eq('item_id', listing.id);
      return res.status(200).json({ status: 'pending_review' });
    }

    const kind = req.body?.kind ?? existing?.kind;
    if (!['ebook', 'audio', 'video'].includes(kind)) return res.status(400).json({ error: 'Choose e-book, audio or video' });
    const tierId = String(req.body?.tier_id ?? existing?.tier_id ?? '');
    const { data: tier } = await digitalDb.from('digital_price_tiers').select('id, price_usd, is_active').eq('id', tierId).maybeSingle();
    if (!tier || !tier.is_active) return res.status(400).json({ error: 'Choose a price' });
    if (existing && existing.kind !== kind) {
      const { count } = await digitalDb.from('digital_assets').select('id', { count: 'exact', head: true }).eq('item_id', listing.id).neq('status', 'removed');
      if (count) return res.status(409).json({ error: 'Remove the uploaded files before changing the type' });
    }
    const clampInt = (value, min, max, fallback) => { const n = Number.parseInt(value, 10); return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback; };
    const row = {
      item_id: listing.id,
      seller_username: participant.username,
      kind,
      tier_id: tier.id,
      preview_pages: clampInt(req.body?.preview_pages, 0, 10, existing?.preview_pages ?? 3),
      preview_seconds: clampInt(req.body?.preview_seconds, 0, 120, existing?.preview_seconds ?? 30),
      rights_confirmed: req.body?.rights_confirmed === undefined ? !!existing?.rights_confirmed : req.body.rights_confirmed === true,
      updated_at: new Date().toISOString(),
    };
    // Included in the creator's monthly subscription (phase 2 column; default on).
    if (typeof req.body?.in_subscription === 'boolean') row.in_subscription = req.body.in_subscription;
    if (!row.rights_confirmed && existing && !['draft', 'rejected'].includes(existing.status)) {
      return res.status(400).json({ error: 'Rights confirmation cannot be withdrawn after submission' });
    }
    const { data: saved, error } = await digitalDb.from('digital_products').upsert(row, { onConflict: 'item_id' }).select('*').single();
    if (error) throw error;
    // The listing shows the price buyers actually pay (the tier).
    await digitalDb.from('catalogue_items').update({ price_usd: tier.price_usd }).eq('id', listing.id).eq('seller_username', participant.username);
    return res.status(200).json({ product: saved });
  } catch (error) {
    console.error('digital/seller error:', error);
    return res.status(500).json({ error: 'Could not save digital product' });
  }
}
