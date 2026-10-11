// Sponsored content for one placement (public). Only live, approved campaigns
// with approved, publicly delivered media are returned - pending media never
// leaves the server.
//   GET ?placement=home|shop|search|category&ads=1&boosts=4[&category_id=]
// Selection is randomised, weighted by package priority, and capped so
// sponsored content never crowds out regular listings.

import { adsDb } from '../../../lib/ads';
import { adDeliveryUrl } from '../../../lib/cloudinaryAds';

const PLACEMENTS = new Set(['home', 'shop', 'search', 'category']);

function weightedPick(rows, count) {
  const pool = [...rows];
  const picked = [];
  while (pool.length && picked.length < count) {
    const total = pool.reduce((sum, row) => sum + Math.max(1, row.priority), 0);
    let roll = Math.random() * total;
    const index = pool.findIndex((row) => (roll -= Math.max(1, row.priority)) < 0);
    picked.push(pool.splice(index === -1 ? 0 : index, 1)[0]);
  }
  return picked;
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const placement = String(req.query.placement || '');
  if (!PLACEMENTS.has(placement)) return res.status(400).json({ error: 'Unknown placement' });
  const adLimit = Math.min(Math.max(Number.parseInt(req.query.ads, 10) || 0, 0), 3);
  const boostLimit = Math.min(Math.max(Number.parseInt(req.query.boosts, 10) || 0, 0), 4);
  const categoryId = typeof req.query.category_id === 'string' ? req.query.category_id : '';
  const now = new Date().toISOString();

  try {
    const live = (kind) => adsDb.from('advertising_campaigns')
      .select(kind === 'ad'
        ? 'id, title, body, cta_label, destination_type, destination_url, listing_id, priority, owner_id, participants(username), advertising_campaign_media(position, advertising_media(id, resource_type, format, cloudinary_public_id, delivery_type, status, width, height))'
        : 'id, listing_id, priority, catalogue_items(id, seller_username, title, description, price_usd, size, category_id, promo_video_url, images, payment_methods, status, created_at, listing_type, pricing_model, price_unit)')
      .eq('kind', kind).eq('status', 'active').lte('starts_at', now).gt('ends_at', now)
      .contains('placements', [placement])
      .limit(60);

    const [ads, boosts] = await Promise.all([adLimit ? live('ad') : { data: [] }, boostLimit ? live('boost') : { data: [] }]);
    if (ads.error) throw ads.error;
    if (boosts.error) throw boosts.error;

    const adRows = (ads.data || []).map((c) => ({
      ...c,
      media: (c.advertising_campaign_media || [])
        .map((row) => row.advertising_media)
        .filter((m) => m && m.status === 'approved' && m.delivery_type === 'upload'),
    })).filter((c) => c.media.length);

    const boostRows = (boosts.data || []).filter((b) => b.catalogue_items?.status === 'active'
      && (!categoryId || b.catalogue_items.category_id === categoryId));

    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json({
      placement,
      ads: weightedPick(adRows, adLimit).map((c) => ({
        id: c.id,
        title: c.title,
        body: c.body,
        cta_label: c.cta_label || (c.destination_type === 'external' ? 'Visit' : 'View'),
        destination: {
          type: c.destination_type,
          url: c.destination_type === 'external' ? c.destination_url : null,
          listing_id: c.destination_type === 'listing' ? c.listing_id : null,
          username: c.participants?.username || null,
        },
        media: c.media.map((m) => ({
          type: m.resource_type,
          url: adDeliveryUrl(m),
          poster: m.resource_type === 'video' ? adDeliveryUrl(m, { poster: true, width: 720 }) : null,
          width: m.width,
          height: m.height,
        })),
      })),
      boosted: weightedPick(boostRows, boostLimit).map((b) => ({ campaign_id: b.id, listing: b.catalogue_items })),
    });
  } catch (error) {
    console.error('ads/serve error:', error);
    // Never break the page because of ads.
    return res.status(200).json({ placement, ads: [], boosted: [] });
  }
}
