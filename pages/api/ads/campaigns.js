// Advertiser / seller campaigns (ads and listing boosts).
//   GET            -> your entitlements (packages bought), campaigns with
//                     creatives, schedule and impressions/clicks
//   POST           -> create a draft from an available entitlement
//   PATCH          -> edit; changing a live ad's text, link or creatives sends
//                     it back to review (enforced by a database trigger; the
//                     paused time is returned when it is re-approved)
//   DELETE ?id=    -> delete a draft/rejected campaign (package is returned)
// Submitting for review: POST /api/ads/campaign-submit.

import { requireParticipant } from '../../../lib/participantAuth';
import { adsDb, campaignState, mediaView } from '../../../lib/ads';
import { checkDestination } from '../../../lib/adDestinations';

const clean = (value, max) => (typeof value === 'string' ? value.trim().slice(0, max) : '');

export default async function handler(req, res) {
  const participant = await requireParticipant(req, res);
  if (!participant) return;
  try {
    if (req.method === 'GET') return await list(res, participant);
    if (req.method === 'POST') return await create(req, res, participant);
    if (req.method === 'PATCH') return await update(req, res, participant);
    if (req.method === 'DELETE') return await remove(req, res, participant);
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (error) {
    console.error('ads/campaigns error:', error);
    return res.status(500).json({ error: 'Campaign request failed' });
  }
}

async function list(res, participant) {
  const [entitlements, campaigns] = await Promise.all([
    adsDb.from('advertising_entitlements')
      .select('id, package_id, package_snapshot, provider, order_id, price_usd, is_paid, status, revoke_reason, created_at')
      .eq('participant_id', participant.id)
      .order('created_at', { ascending: false })
      .limit(100),
    adsDb.from('advertising_campaigns')
      .select('*, advertising_campaign_media(position, advertising_media(*)), catalogue_items(title, images)')
      .eq('owner_id', participant.id)
      .order('created_at', { ascending: false })
      .limit(50),
  ]);
  if (entitlements.error) throw entitlements.error;
  if (campaigns.error) throw campaigns.error;

  const rows = await Promise.all((campaigns.data || []).map(async (c) => {
    const [impressions, clicks] = await Promise.all(['impression', 'click'].map((kind) =>
      adsDb.from('advertising_events').select('id', { count: 'exact', head: true }).eq('campaign_id', c.id).eq('kind', kind)));
    return {
      id: c.id,
      kind: c.kind,
      package_id: c.package_id,
      entitlement_id: c.entitlement_id,
      title: c.title,
      body: c.body,
      cta_label: c.cta_label,
      destination_type: c.destination_type,
      destination_url: c.destination_url,
      listing_id: c.listing_id,
      listing_title: c.catalogue_items?.title || null,
      placements: c.placements,
      status: c.status,
      state: campaignState(c),
      starts_at: c.starts_at,
      ends_at: c.ends_at,
      submitted_at: c.submitted_at,
      review_note: c.review_note,
      created_at: c.created_at,
      media: (c.advertising_campaign_media || [])
        .sort((a, b) => a.position - b.position)
        .map((row) => row.advertising_media && mediaView(row.advertising_media))
        .filter(Boolean),
      impressions: impressions.count || 0,
      clicks: clicks.count || 0,
    };
  }));

  return res.status(200).json({
    // Every purchase/grant, newest first: "available" ones can start a
    // campaign; the rest form the purchase history.
    entitlements: (entitlements.data || []).map((e) => ({
      id: e.id, package_id: e.package_id, package: e.package_snapshot, status: e.status, is_paid: e.is_paid,
      provider: e.provider, order_id: e.order_id, price_usd: e.price_usd === null ? null : Number(e.price_usd),
      revoke_reason: e.revoke_reason, created_at: e.created_at,
    })),
    campaigns: rows,
  });
}

/** Validates content against the purchased package terms. Returns { fields } or { error }. */
async function buildFields(body, participant, snapshot, existing = null) {
  const fields = {};
  if (body.title !== undefined || !existing) {
    fields.title = clean(body.title, 80);
    if (fields.title.length < 2) return { error: 'Give your campaign a title' };
  }
  if (body.body !== undefined) fields.body = clean(body.body, 280) || null;
  if (body.cta_label !== undefined) fields.cta_label = clean(body.cta_label, 24) || null;

  const destinationType = body.destination_type ?? existing?.destination_type ?? (snapshot.kind === 'boost' ? 'listing' : null);
  if (!['external', 'listing', 'profile'].includes(destinationType)) return { error: 'Choose where the campaign leads' };
  if (snapshot.kind === 'boost' && destinationType !== 'listing') return { error: 'A boost promotes one of your listings' };
  fields.destination_type = destinationType;

  if (destinationType === 'external') {
    if (!snapshot.allow_external_link) return { error: 'This package does not include external links' };
    const url = body.destination_url !== undefined ? body.destination_url : existing?.destination_url;
    if (body.destination_url !== undefined || !existing?.destination_checked_at || existing?.destination_type !== 'external') {
      const checked = await checkDestination(url);
      if (!checked.ok) return { error: checked.reason };
      Object.assign(fields, { destination_url: checked.url, destination_final_url: checked.finalUrl, destination_checked_at: new Date().toISOString() });
    }
    fields.listing_id = null;
  } else {
    Object.assign(fields, { destination_url: null, destination_final_url: null, destination_checked_at: null });
  }

  if (destinationType === 'listing') {
    const listingId = body.listing_id !== undefined ? body.listing_id : existing?.listing_id;
    const { data: listing } = await adsDb.from('catalogue_items').select('id, seller_username, status')
      .eq('id', String(listingId || '')).maybeSingle();
    if (!listing || listing.seller_username !== participant.username || listing.status !== 'active') {
      return { error: 'Choose one of your own live listings' };
    }
    fields.listing_id = listing.id;
  } else if (destinationType === 'profile') {
    fields.listing_id = null;
  }
  return { fields };
}

async function setMedia(campaignId, mediaIds, participant, snapshot) {
  if (!Array.isArray(mediaIds)) return null;
  const ids = [...new Set(mediaIds.map(String))];
  // Unchanged selection: leave it alone (re-saving would trigger a re-review).
  const { data: current } = await adsDb.from('advertising_campaign_media').select('media_id, position').eq('campaign_id', campaignId).order('position');
  if ((current || []).map((row) => row.media_id).join(',') === ids.join(',')) return null;
  if (ids.length > snapshot.max_creatives) return `This package allows up to ${snapshot.max_creatives} creative${snapshot.max_creatives === 1 ? '' : 's'}`;
  if (ids.length) {
    const { data } = await adsDb.from('advertising_media').select('id').in('id', ids).eq('owner_id', participant.id).in('status', ['pending', 'approved']);
    if ((data || []).length !== ids.length) return 'One of the selected creatives is not available';
  }
  await adsDb.from('advertising_campaign_media').delete().eq('campaign_id', campaignId);
  if (ids.length) {
    const { error } = await adsDb.from('advertising_campaign_media').insert(ids.map((media_id, position) => ({ campaign_id: campaignId, media_id, position })));
    if (error) throw error;
  }
  return null;
}

async function create(req, res, participant) {
  const entitlementId = String(req.body?.entitlement_id || '');
  // Claim the package atomically: one campaign per purchase.
  const { data: entitlement } = await adsDb.from('advertising_entitlements')
    .update({ status: 'used', updated_at: new Date().toISOString() })
    .eq('id', entitlementId).eq('participant_id', participant.id).eq('status', 'available')
    .select('*').maybeSingle();
  if (!entitlement) return res.status(409).json({ error: 'Choose a package you have bought and not used yet' });

  const release = () => adsDb.from('advertising_entitlements').update({ status: 'available' }).eq('id', entitlement.id).eq('status', 'used');
  const snapshot = entitlement.package_snapshot;
  const built = await buildFields(req.body || {}, participant, snapshot);
  if (built.error) { await release(); return res.status(400).json({ error: built.error }); }

  const { data: campaign, error } = await adsDb.from('advertising_campaigns').insert({
    ...built.fields,
    owner_id: participant.id,
    kind: snapshot.kind,
    package_id: entitlement.package_id,
    entitlement_id: entitlement.id,
    placements: snapshot.placements,
    priority: snapshot.priority,
    status: 'draft',
  }).select('id').single();
  if (error) { await release(); throw error; }

  const mediaError = await setMedia(campaign.id, req.body?.media_ids || [], participant, snapshot);
  if (mediaError) {
    await adsDb.from('advertising_campaigns').delete().eq('id', campaign.id);
    await release();
    return res.status(400).json({ error: mediaError });
  }
  return res.status(201).json({ id: campaign.id, status: 'draft' });
}

async function update(req, res, participant) {
  const id = String(req.body?.id || '');
  const { data: campaign } = await adsDb.from('advertising_campaigns').select('*, advertising_entitlements(package_snapshot)')
    .eq('id', id).eq('owner_id', participant.id).maybeSingle();
  if (!campaign) return res.status(404).json({ error: 'Campaign not found' });
  if (['suspended', 'revoked'].includes(campaign.status)) return res.status(409).json({ error: 'This campaign can no longer be edited' });
  if (campaign.kind === 'boost' && campaign.status === 'active') return res.status(409).json({ error: 'A live boost cannot be changed' });
  if (campaignState(campaign) === 'completed') return res.status(409).json({ error: 'This campaign has finished' });

  const snapshot = campaign.advertising_entitlements.package_snapshot;
  const built = await buildFields(req.body || {}, participant, snapshot, campaign);
  if (built.error) return res.status(400).json({ error: built.error });

  const mediaError = await setMedia(campaign.id, req.body?.media_ids, participant, snapshot);
  if (mediaError) return res.status(400).json({ error: mediaError });

  // Only send columns that actually change, so an unchanged save never pulls
  // a live ad out of rotation.
  const changes = Object.fromEntries(Object.entries(built.fields).filter(([key, value]) => {
    if (key === 'destination_checked_at' || key === 'destination_final_url') return true;
    return String(value ?? '') !== String(campaign[key] ?? '');
  }));
  const { data: updated, error } = await adsDb.from('advertising_campaigns')
    .update({ ...changes, updated_at: new Date().toISOString() })
    .eq('id', campaign.id).select('status').single();
  if (error) {
    if (/live_boost_locked/.test(error.message || '')) return res.status(409).json({ error: 'A live boost cannot be changed' });
    throw error;
  }
  if (campaign.status === 'active' && updated.status === 'pending_review') {
    await adsDb.from('advertising_moderation').insert({ campaign_id: campaign.id, action: 'edited_needs_review', actor: 'owner', actor_id: participant.id });
  }
  return res.status(200).json({ id: campaign.id, status: updated.status });
}

async function remove(req, res, participant) {
  const id = String(req.query.id || '');
  const { data: campaign } = await adsDb.from('advertising_campaigns').select('id, status, entitlement_id')
    .eq('id', id).eq('owner_id', participant.id).maybeSingle();
  if (!campaign) return res.status(404).json({ error: 'Campaign not found' });
  if (!['draft', 'rejected'].includes(campaign.status)) return res.status(409).json({ error: 'Only drafts and rejected campaigns can be deleted' });
  const { error } = await adsDb.from('advertising_campaigns').delete().eq('id', campaign.id);
  if (error) throw error;
  await adsDb.from('advertising_entitlements').update({ status: 'available', updated_at: new Date().toISOString() })
    .eq('id', campaign.entitlement_id).eq('status', 'used');
  return res.status(200).json({ success: true });
}
