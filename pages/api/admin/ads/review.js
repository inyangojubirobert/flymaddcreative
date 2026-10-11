// Admin moderation.
//   { target: 'media', id, action: 'approve' | 'reject', note }
//     approve -> asset switched to public delivery in Cloudinary, then marked approved
//     reject  -> (also for already-approved media) asset made private again;
//                live campaigns using it are suspended
//   { target: 'campaign', id, action: 'extend', hours, note }
//     logged compensation for platform problems (capped at the package duration)
//   { target: 'campaign', id, action: 'approve' | 'reject' | 'suspend' | 'reinstate', note, approve_media }
//     approve_media: true approves the campaign's pending creatives first
// Every decision is recorded in advertising_moderation.

import { requireActiveAdmin } from '../../../../lib/adminAuth';
import { adErrorMessage, adsDb } from '../../../../lib/ads';
import { publishAdAsset, unpublishAdAsset } from '../../../../lib/cloudinaryAds';
import { recheckCampaignLink } from '../../../../lib/adLinkHealth';

const clean = (value) => (typeof value === 'string' ? value.trim().slice(0, 1000) : '') || null;

async function reviewMedia(admin, id, action, note) {
  const { data: media } = await adsDb.from('advertising_media').select('*').eq('id', id).maybeSingle();
  if (!media || media.status === 'removed') return { status: 404, error: 'Media not found' };
  if (action === 'approve') {
    if (media.status === 'approved') return { status: 200, media };
    if (media.delivery_type === 'authenticated') await publishAdAsset(media.resource_type, media.cloudinary_public_id);
    const { data, error } = await adsDb.from('advertising_media')
      .update({ status: 'approved', delivery_type: 'upload', reviewed_by: admin.id, reviewed_at: new Date().toISOString(), reject_reason: null })
      .eq('id', id).select('*').single();
    if (error) throw error;
    await adsDb.from('advertising_moderation').insert({ media_id: id, action: 'media_approved', actor: 'admin', actor_id: admin.id, note });
    return { status: 200, media: data };
  }
  if (action === 'reject') {
    if (!note) return { status: 400, error: 'Give the advertiser a reason' };
    if (media.status === 'rejected') return { status: 200 };
    // Private in Cloudinary first, so the database never claims a still-public
    // asset has been withdrawn.
    if (media.delivery_type === 'upload') await unpublishAdAsset(media.resource_type, media.cloudinary_public_id);
    const { error } = await adsDb.rpc('ads_reject_media', { p_media_id: id, p_admin_id: admin.id, p_note: note });
    if (error) throw error;
    return { status: 200 };
  }
  return { status: 400, error: 'Unknown action' };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const admin = await requireActiveAdmin(req, res, adsDb);
  if (!admin) return;

  const { target, action } = req.body || {};
  const id = String(req.body?.id || '');
  const note = clean(req.body?.note);

  try {
    if (target === 'media') {
      const result = await reviewMedia(admin, id, action, note);
      return res.status(result.status).json(result.error ? { error: result.error } : { success: true });
    }
    if (target !== 'campaign') return res.status(400).json({ error: 'Unknown target' });
    if (action === 'recheck_link') {
      const outcome = await recheckCampaignLink(id, { actorId: admin.id });
      return res.status(outcome.error ? 400 : 200).json(outcome.error ? { error: outcome.error } : { success: true, ...outcome });
    }
    if (action === 'extend') {
      if (!note) return res.status(400).json({ error: 'Explain the compensation' });
      const { data: endsAt, error: extendError } = await adsDb.rpc('ads_extend_campaign', {
        p_campaign_id: id, p_admin_id: admin.id, p_hours: Number.parseInt(req.body?.hours, 10), p_note: note,
      });
      if (extendError) {
        const message = adErrorMessage(extendError);
        if (message) return res.status(400).json({ error: message });
        throw extendError;
      }
      return res.status(200).json({ success: true, ends_at: endsAt });
    }
    if (['reject', 'suspend'].includes(action) && !note) return res.status(400).json({ error: 'Give the advertiser a reason' });

    if (action === 'approve' && req.body?.approve_media) {
      const { data: rows } = await adsDb.from('advertising_campaign_media').select('media_id, advertising_media(status)').eq('campaign_id', id);
      for (const row of rows || []) {
        if (row.advertising_media?.status === 'pending') {
          const result = await reviewMedia(admin, row.media_id, 'approve', note);
          if (result.error) return res.status(result.status).json({ error: result.error });
        }
      }
    }

    const { data, error } = await adsDb.rpc('ads_review_campaign', { p_campaign_id: id, p_admin_id: admin.id, p_action: action, p_note: note });
    if (error) {
      const message = adErrorMessage(error);
      if (message) return res.status(400).json({ error: message });
      throw error;
    }

    // Tell the advertiser (same support inbox used for payout notices).
    const { data: campaign } = await adsDb.from('advertising_campaigns').select('owner_id, title, ends_at').eq('id', id).single();
    const text = {
      approve: `Your campaign "${campaign.title}" is approved and live until ${new Date(campaign.ends_at).toUTCString()}.`,
      reject: `Your campaign "${campaign.title}" needs changes before it can go live: ${note}`,
      suspend: `Your campaign "${campaign.title}" has been paused by One Dream: ${note}`,
      reinstate: `Your campaign "${campaign.title}" has been reinstated.`,
    }[action];
    if (text) {
      await adsDb.from('support_messages').insert({ participant_id: campaign.owner_id, admin_id: admin.id, sender_type: 'system', message_type: 'general', body: text })
        .then(({ error: e }) => { if (e) console.error('ad notice failed:', e.message); });
    }
    return res.status(200).json({ success: true, status: data });
  } catch (error) {
    console.error('admin/ads/review error:', error);
    return res.status(500).json({ error: 'Review failed' });
  }
}
