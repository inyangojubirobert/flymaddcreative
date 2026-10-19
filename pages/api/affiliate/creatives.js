// A partner's own marketing for a listing: images, videos or text. Every
// creative is moderated before it appears on a storefront; the listing's
// specifications, stock, warranty and delivery terms always come from the
// seller and can't be overridden here.
//   GET                                   mine
//   POST   { action: 'sign', resource_type: 'image' | 'video', delivery? }  Cloudinary upload parameters
// Apps that send delivery: 'authenticated' upload privately: the file can
// only be opened through signed links (the partner and admins) until an
// admin approves it (pages/api/admin/earnings/affiliate.js makes it public).
//   POST   { membership_id, kind, public_id?, media_url?, title?, body? }  save a creative
//   DELETE ?id=

import crypto from 'crypto';
import { earningsDb, must, requireParty, requirePartner } from '../../../lib/earnings';
import { AD_MEDIA_RULES, cloudinaryConfig, creativeViewUrl, signParams } from '../../../lib/cloudinaryAds';

function signAffiliateUpload(partnerId, resourceType, authenticated) {
  const rules = AD_MEDIA_RULES[resourceType];
  const { apiKey, apiSecret, cloudName } = cloudinaryConfig();
  const params = {
    allowed_formats: rules.formats.join(','),
    folder: `onedream_affiliate/${partnerId}`,
    public_id: `cr_${crypto.randomBytes(12).toString('hex')}`,
    timestamp: Math.floor(Date.now() / 1000),
    ...(authenticated ? { type: 'authenticated' } : {}),
  };
  return {
    upload_url: `https://api.cloudinary.com/v1_1/${cloudName}/${resourceType}/upload`,
    api_key: apiKey,
    signature: signParams(params, apiSecret),
    ...params,
    max_bytes: rules.maxBytes,
    cloud_name: cloudName,
  };
}

export default async function handler(req, res) {
  const party = await requireParty(req, res);
  if (!party) return;
  const partner = await requirePartner(req, res, party);
  if (!partner) return;

  try {
    if (req.method === 'GET') {
      const memberships = must(await earningsDb.from('affiliate_memberships').select('id').eq('partner_id', partner.id));
      const creatives = memberships.length
        ? must(await earningsDb.from('affiliate_creatives').select('*').in('membership_id', memberships.map((m) => m.id)).order('created_at', { ascending: false }))
        : [];
      return res.status(200).json({ creatives: creatives.map((c) => ({ ...c, media_url: creativeViewUrl(c) })) });
    }
    if (req.method === 'POST' && req.body?.action === 'sign') {
      const type = req.body.resource_type === 'video' ? 'video' : 'image';
      try {
        return res.status(200).json(signAffiliateUpload(partner.id, type, req.body.delivery === 'authenticated'));
      } catch (error) {
        if (error.message === 'cloudinary_not_configured') return res.status(503).json({ error: 'Media uploads are not configured' });
        throw error;
      }
    }
    if (req.method === 'POST') {
      const membership = must(await earningsDb.from('affiliate_memberships').select('id, status, offer:affiliate_offers(creative_rules)')
        .eq('id', String(req.body?.membership_id || '')).eq('partner_id', partner.id).maybeSingle());
      if (!membership || membership.status !== 'approved') return res.status(400).json({ error: 'This partnership is not approved yet' });
      const rules = membership.offer?.creative_rules || {};
      const kind = ['image', 'video', 'text'].includes(req.body.kind) ? req.body.kind : null;
      if (!kind) return res.status(400).json({ error: 'Choose image, video or text' });
      if (kind !== 'text' && rules.own_media === false) return res.status(403).json({ error: 'The seller does not allow your own media for this listing' });
      if (kind === 'text' && rules.own_description === false) return res.status(403).json({ error: 'The seller does not allow your own description for this listing' });

      let mediaUrl = null;
      let publicId = null;
      if (kind !== 'text') {
        publicId = String(req.body.public_id || '');
        if (!publicId.startsWith(`onedream_affiliate/${partner.id}/`)) return res.status(400).json({ error: 'Upload the file first' });
        const { cloudName } = cloudinaryConfig();
        mediaUrl = `https://res.cloudinary.com/${cloudName}/${kind}/${req.body.delivery === 'authenticated' ? 'authenticated' : 'upload'}/${publicId}`;
      }
      const body = kind === 'text' ? String(req.body.body || '').trim().slice(0, 1000) : (req.body.body ? String(req.body.body).slice(0, 1000) : null);
      if (kind === 'text' && body.length < 10) return res.status(400).json({ error: 'Write at least a short description' });
      const data = must(await earningsDb.from('affiliate_creatives').insert({
        membership_id: membership.id, kind, media_url: mediaUrl, cloudinary_public_id: publicId,
        title: req.body.title ? String(req.body.title).slice(0, 120) : null, body,
      }).select('*').single());
      return res.status(201).json({ creative: { ...data, media_url: creativeViewUrl(data) } });
    }
    if (req.method === 'DELETE') {
      const creative = must(await earningsDb.from('affiliate_creatives').select('id, membership:affiliate_memberships(partner_id)')
        .eq('id', String(req.query.id || '')).maybeSingle());
      if (!creative || creative.membership?.partner_id !== partner.id) return res.status(404).json({ error: 'Not found' });
      must(await earningsDb.from('affiliate_creatives').delete().eq('id', creative.id));
      return res.status(200).json({ success: true });
    }
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (error) {
    console.error('affiliate/creatives error:', error);
    return res.status(500).json({ error: 'Could not update your creatives' });
  }
}
