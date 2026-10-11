// Admin overview for advertising: review queue (campaigns + creatives with
// signed previews), live campaigns, packages, placements and recent purchases.
//   GET ?view=queue|live|all

import { requireActiveAdmin } from '../../../../lib/adminAuth';
import { adsDb, campaignState, mediaView } from '../../../../lib/ads';

const SELECT = '*, participants(username, name, email), catalogue_items(title), advertising_campaign_media(position, advertising_media(*))';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const admin = await requireActiveAdmin(req, res, adsDb);
  if (!admin) return;

  const view = ['queue', 'live', 'all'].includes(req.query.view) ? req.query.view : 'queue';
  try {
    let query = adsDb.from('advertising_campaigns').select(SELECT).order('submitted_at', { ascending: true, nullsFirst: false }).limit(100);
    if (view === 'queue') query = query.eq('status', 'pending_review');
    if (view === 'live') query = query.eq('status', 'active').gt('ends_at', new Date().toISOString());

    const [campaigns, packages, placements, entitlements] = await Promise.all([
      query,
      adsDb.from('advertising_packages').select('*').order('sort_order'),
      adsDb.from('advertising_placements').select('*').order('key'),
      adsDb.from('advertising_entitlements').select('id, package_id, provider, order_id, price_usd, is_paid, status, created_at, participants(username)')
        .order('created_at', { ascending: false }).limit(50),
    ]);
    for (const r of [campaigns, packages, placements, entitlements]) if (r.error) throw r.error;

    return res.status(200).json({
      campaigns: (campaigns.data || []).map((c) => ({
        id: c.id,
        kind: c.kind,
        package_id: c.package_id,
        owner: c.participants,
        title: c.title,
        body: c.body,
        cta_label: c.cta_label,
        destination_type: c.destination_type,
        destination_url: c.destination_url,
        destination_final_url: c.destination_final_url,
        destination_checked_at: c.destination_checked_at,
        listing_title: c.catalogue_items?.title || null,
        placements: c.placements,
        status: c.status,
        state: campaignState(c),
        starts_at: c.starts_at,
        ends_at: c.ends_at,
        submitted_at: c.submitted_at,
        review_note: c.review_note,
        media: (c.advertising_campaign_media || []).sort((a, b) => a.position - b.position)
          .map((row) => row.advertising_media && { ...mediaView(row.advertising_media), cloudinary_public_id: row.advertising_media.cloudinary_public_id })
          .filter(Boolean),
      })),
      packages: packages.data || [],
      placements: placements.data || [],
      entitlements: entitlements.data || [],
    });
  } catch (error) {
    console.error('admin/ads error:', error);
    return res.status(500).json({ error: 'Could not load advertising data' });
  }
}
