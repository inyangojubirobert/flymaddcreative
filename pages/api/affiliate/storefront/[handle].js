// Public storefront of a partner: /m/<handle>.
//   GET -> { partner, link_code, collections: [{ title, items }], items }
// Items are the partner's approved memberships on active offers and active
// listings. Price, title, specs and stock always come from the seller's
// listing; the partner's approved creatives are shown alongside. A resale
// item shows the reseller's price only once reseller checkout (P3) is live
// (until then it is sold at the seller's price, as a referral, if the offer
// allows referrals), and never shows the seller's floor.

import { earningsDb, ensureStorefrontLink, getEarningsSettings, must } from '../../../../lib/earnings';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const handle = String(req.query.handle || '').toLowerCase();
  if (!/^[a-z0-9][a-z0-9_-]{2,29}$/.test(handle)) return res.status(404).json({ error: 'Storefront not found' });

  try {
    const partner = must(await earningsDb.from('affiliate_partners').select('id, handle, display_name, bio, avatar_url, status').eq('handle', handle).maybeSingle());
    if (!partner || partner.status !== 'active') return res.status(404).json({ error: 'Storefront not found' });
    const [settings, link, memberships, collections] = await Promise.all([
      getEarningsSettings(),
      ensureStorefrontLink(partner.id),
      earningsDb.from('affiliate_memberships')
        .select('id, model, resale_price_usd, offer:affiliate_offers(id, status, fulfilment, allow_storefront, allow_referral, item:catalogue_items(id, title, description, price_usd, images, status, seller_username, listing_type))')
        .eq('partner_id', partner.id).eq('status', 'approved').then(must),
      earningsDb.from('affiliate_collections').select('id, title, slug, sort_order, items:affiliate_collection_items(membership_id, sort_order)')
        .eq('partner_id', partner.id).order('sort_order').then(must),
    ]);
    const live = memberships.filter((m) => m.offer?.status === 'active' && m.offer.item?.status === 'active'
      && (m.model !== 'resale' || settings.resale_checkout_enabled || m.offer.allow_referral));
    const creatives = live.length
      ? must(await earningsDb.from('affiliate_creatives').select('membership_id, kind, media_url, title, body')
          .in('membership_id', live.map((m) => m.id)).eq('status', 'approved'))
      : [];

    const items = live.map((m) => {
      const resale = m.model === 'resale' && settings.resale_checkout_enabled;
      return {
        membership_id: m.id,
        item_id: m.offer.item.id,
        title: m.offer.item.title,
        description: m.offer.item.description,
        image: Array.isArray(m.offer.item.images) ? m.offer.item.images[0] : null,
        listing_type: m.offer.item.listing_type,
        price_usd: resale ? Number(m.resale_price_usd) : Number(m.offer.item.price_usd),
        sold_by: resale ? partner.display_name : m.offer.item.seller_username,
        fulfilled_by: m.offer.fulfilment === 'reseller' && resale ? partner.display_name : m.offer.item.seller_username,
        resale,
        creatives: creatives.filter((c) => c.membership_id === m.id),
      };
    });
    const byId = new Map(items.map((i) => [i.membership_id, i]));
    res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=300');
    return res.status(200).json({
      partner: { handle: partner.handle, display_name: partner.display_name, bio: partner.bio, avatar_url: partner.avatar_url },
      link_code: link.code,
      collections: collections.map((c) => ({
        title: c.title, slug: c.slug,
        items: (c.items || []).sort((a, b) => a.sort_order - b.sort_order).map((ci) => byId.get(ci.membership_id)).filter(Boolean),
      })).filter((c) => c.items.length),
      items,
    });
  } catch (error) {
    console.error('affiliate/storefront error:', error);
    return res.status(500).json({ error: 'Could not load this storefront' });
  }
}
