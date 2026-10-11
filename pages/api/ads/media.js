// Advertiser media library.
//   GET            -> your media (signed previews for pending items)
//   POST           -> { public_id, resource_type } register an upload made with
//                     /api/ads/media-sign. The asset is re-read from Cloudinary
//                     and checked (owner folder, private delivery, format,
//                     size, duration); anything that fails is deleted.
//   DELETE ?id=    -> remove (not allowed while used by a live/pending campaign)

import { requireParticipant } from '../../../lib/participantAuth';
import { adsDb, mediaView } from '../../../lib/ads';
import { destroyAdAsset, getAdResource, validateAdResource } from '../../../lib/cloudinaryAds';

export default async function handler(req, res) {
  const participant = await requireParticipant(req, res);
  if (!participant) return;

  try {
    if (req.method === 'GET') {
      const { data, error } = await adsDb
        .from('advertising_media')
        .select('*')
        .eq('owner_id', participant.id)
        .neq('status', 'removed')
        .order('created_at', { ascending: false });
      if (error) throw error;
      return res.status(200).json({ media: (data || []).map((m) => mediaView(m)) });
    }

    if (req.method === 'POST') {
      const resourceType = req.body?.resource_type;
      const publicId = typeof req.body?.public_id === 'string' ? req.body.public_id.trim() : '';
      if (!['image', 'video'].includes(resourceType) || !publicId || publicId.length > 200) {
        return res.status(400).json({ error: 'public_id and resource_type are required' });
      }

      const resource = await getAdResource(resourceType, publicId);
      const checked = validateAdResource(resource, participant.id, resourceType);
      if (!checked.ok) {
        // Only clean up assets inside this advertiser's own folder.
        if (resource && String(resource.public_id).startsWith(`onedream_ads/${participant.id}/`)) {
          await destroyAdAsset(resourceType, resource.public_id).catch(() => {});
        }
        return res.status(400).json({ error: checked.reason });
      }

      const { data, error } = await adsDb
        .from('advertising_media')
        .upsert({ ...checked.media, owner_id: participant.id, delivery_type: 'authenticated', status: 'pending' },
          { onConflict: 'cloudinary_public_id', ignoreDuplicates: true })
        .select('*')
        .maybeSingle();
      if (error) throw error;
      const media = data || (await adsDb.from('advertising_media').select('*').eq('cloudinary_public_id', checked.media.cloudinary_public_id).single()).data;
      if (!media || media.owner_id !== participant.id) return res.status(409).json({ error: 'Upload already registered' });
      return res.status(201).json({ media: mediaView(media) });
    }

    if (req.method === 'DELETE') {
      const id = String(req.query.id || '');
      const { data: media } = await adsDb.from('advertising_media').select('*').eq('id', id).eq('owner_id', participant.id).maybeSingle();
      if (!media || media.status === 'removed') return res.status(404).json({ error: 'Media not found' });

      const { data: uses } = await adsDb
        .from('advertising_campaign_media')
        .select('campaign_id, advertising_campaigns!inner(status)')
        .eq('media_id', id)
        .in('advertising_campaigns.status', ['active', 'pending_review']);
      if (uses?.length) return res.status(409).json({ error: 'This media is used by a live or pending campaign' });

      await destroyAdAsset(media.resource_type, media.cloudinary_public_id, media.delivery_type).catch((e) => console.error('ad media destroy failed:', e.message));
      await adsDb.from('advertising_campaign_media').delete().eq('media_id', id);
      const { error } = await adsDb.from('advertising_media').update({ status: 'removed', removed_at: new Date().toISOString() }).eq('id', id);
      if (error) throw error;
      return res.status(200).json({ success: true });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (error) {
    console.error('ads/media error:', error);
    return res.status(500).json({ error: 'Media request failed' });
  }
}
