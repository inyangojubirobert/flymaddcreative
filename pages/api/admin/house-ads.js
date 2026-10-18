// Admin: house ads - One Dream's own image/video ads with links to its own
// products, apps and pages. Shown in the normal ad slots without any
// advertiser package or subscription (lib/houseAds.js).
//   GET                                             list with impressions/clicks
//   POST { action: 'sign', resource_type }          Cloudinary upload parameters
//   POST { action: 'create', public_id, resource_type, title, body?, cta_label?,
//          destination_type, destination_url? | listing_id? | profile_username?,
//          placements?, mode?, weight?, starts_at?, ends_at? }
//   PATCH { id, status? | title? | body? | cta_label? | placements? | mode? | weight? | ends_at? }

import { requireActiveAdmin } from '../../../lib/adminAuth';
import { adsDb } from '../../../lib/ads';
import { parseDestination } from '../../../lib/adDestinations';
import { HOUSE_PLACEMENTS, houseAdPreview, signHouseAdUpload, verifyHouseUpload } from '../../../lib/houseAds';

const must = ({ data, error }) => {
  if (error) throw error;
  return data;
};
const text = (v, max) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null);

/** Shared field checks for create and edit. Returns { fields } or { error }. */
function editableFields(b) {
  const fields = {};
  if (b.title !== undefined) {
    const title = text(b.title, 80);
    if (!title || title.length < 2) return { error: 'Enter a title (2-80 characters)' };
    fields.title = title;
  }
  if (b.body !== undefined) fields.body = text(b.body, 300);
  if (b.cta_label !== undefined) fields.cta_label = text(b.cta_label, 24);
  if (b.placements !== undefined) {
    const placements = [...new Set((Array.isArray(b.placements) ? b.placements : []).filter((p) => HOUSE_PLACEMENTS.includes(p)))];
    if (!placements.length) return { error: `Choose at least one placement: ${HOUSE_PLACEMENTS.join(', ')}` };
    fields.placements = placements;
  }
  if (b.mode !== undefined) {
    if (!['fill', 'rotate'].includes(b.mode)) return { error: 'mode: fill or rotate' };
    fields.mode = b.mode;
  }
  if (b.weight !== undefined) {
    const weight = Math.round(Number(b.weight));
    if (!(weight >= 1 && weight <= 100)) return { error: 'weight: 1-100' };
    fields.weight = weight;
  }
  for (const key of ['starts_at', 'ends_at']) {
    if (b[key] !== undefined) {
      if (b[key] === null || b[key] === '') { if (key === 'ends_at') fields.ends_at = null; continue; }
      const date = new Date(b[key]);
      if (Number.isNaN(date.getTime())) return { error: `${key}: not a valid date` };
      fields[key] = date.toISOString();
    }
  }
  return { fields };
}

async function destinationFields(b) {
  if (b.destination_type === 'external') {
    const parsed = parseDestination(b.destination_url);
    if (!parsed.ok) return { error: parsed.reason };
    return { fields: { destination_type: 'external', destination_url: parsed.url, listing_id: null, profile_username: null } };
  }
  if (b.destination_type === 'listing') {
    const item = must(await adsDb.from('catalogue_items').select('id, status').eq('id', String(b.listing_id || '')).maybeSingle());
    if (!item || item.status === 'deleted') return { error: 'Listing not found' };
    return { fields: { destination_type: 'listing', listing_id: item.id, destination_url: null, profile_username: null } };
  }
  if (b.destination_type === 'profile') {
    const username = String(b.profile_username || '').trim().replace(/^@/, '');
    const p = must(await adsDb.from('participants').select('username').eq('username', username).maybeSingle());
    if (!p) return { error: 'User not found' };
    return { fields: { destination_type: 'profile', profile_username: p.username, destination_url: null, listing_id: null } };
  }
  return { error: 'destination_type: external, listing or profile' };
}

export default async function handler(req, res) {
  const admin = await requireActiveAdmin(req, res, adsDb);
  if (!admin) return;
  try {
    if (req.method === 'GET') {
      const rows = must(await adsDb.from('house_ads').select('*').neq('status', 'archived').order('created_at', { ascending: false }).limit(100)) || [];
      const ids = rows.map((r) => r.id);
      const events = ids.length ? must(await adsDb.from('house_ad_events').select('house_ad_id, kind').in('house_ad_id', ids).limit(50000)) : [];
      const stats = new Map();
      for (const e of events || []) {
        const s = stats.get(e.house_ad_id) || { impressions: 0, clicks: 0 };
        s[e.kind === 'click' ? 'clicks' : 'impressions'] += 1;
        stats.set(e.house_ad_id, s);
      }
      return res.status(200).json({
        house_ads: rows.map((r) => ({ ...r, preview: houseAdPreview(r), ...(stats.get(r.id) || { impressions: 0, clicks: 0 }) })),
      });
    }

    if (req.method === 'POST' && req.body?.action === 'sign') {
      return res.status(200).json({ upload: signHouseAdUpload(req.body?.resource_type) });
    }

    if (req.method === 'POST' && req.body?.action === 'create') {
      const b = req.body;
      const media = await verifyHouseUpload(b.resource_type, b.public_id);
      if (!media.ok) return res.status(400).json({ error: media.reason });
      const dest = await destinationFields(b);
      if (dest.error) return res.status(400).json({ error: dest.error });
      const edits = editableFields({ placements: HOUSE_PLACEMENTS, ...b, title: b.title ?? '' });
      if (edits.error) return res.status(400).json({ error: edits.error });
      const { data, error } = await adsDb.from('house_ads').insert({
        ...media.media, ...dest.fields, ...edits.fields, status: 'active', created_by: admin.id,
      }).select('*').single();
      if (error?.code === '23505') return res.status(409).json({ error: 'This upload is already a house ad' });
      if (error) throw error;
      return res.status(200).json({ house_ad: data });
    }

    if (req.method === 'PATCH') {
      const b = req.body || {};
      const edits = editableFields(b);
      if (edits.error) return res.status(400).json({ error: edits.error });
      const fields = { ...edits.fields };
      if (b.status !== undefined) {
        if (!['active', 'paused', 'archived'].includes(b.status)) return res.status(400).json({ error: 'status: active, paused or archived' });
        fields.status = b.status;
      }
      if (b.destination_type !== undefined) {
        const dest = await destinationFields(b);
        if (dest.error) return res.status(400).json({ error: dest.error });
        Object.assign(fields, dest.fields);
      }
      if (!Object.keys(fields).length) return res.status(400).json({ error: 'Nothing to change' });
      const row = must(await adsDb.from('house_ads').update({ ...fields, updated_at: new Date().toISOString() })
        .eq('id', String(b.id || '')).select('*').maybeSingle());
      if (!row) return res.status(404).json({ error: 'House ad not found' });
      return res.status(200).json({ house_ad: row });
    }
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (error) {
    if (['PGRST205', '42P01'].includes(error?.code)) return res.status(503).json({ error: 'Run supabase/add_house_ads.sql first' });
    if (/cloudinary_not_configured/.test(error?.message || '')) return res.status(503).json({ error: 'Cloudinary is not configured' });
    console.error('admin/house-ads error:', error.message || error);
    return res.status(500).json({ error: 'House ad update failed' });
  }
}
