// Admin: affiliate marketplace controls (all audited).
//   POST { action: 'suspend_partner' | 'restore_partner', partner_id, reason }
//   POST { action: 'approve_creative' | 'reject_creative', creative_id, reason? }
//   POST { action: 'reverse_attribution', attribution_id, reason }
//   POST { action: 'release_held', attribution_id, reason }
//   POST { action: 'pause_offer' | 'resume_offer', offer_id, reason }
//   POST { action: 'platform_offer', item_id, commission_percent, reason }   One Dream-funded promotion on a listing

import { requireActiveAdmin } from '../../../../lib/adminAuth';
import { auditEarnings, earningsDb, getEarningsSettings, must } from '../../../../lib/earnings';
import { cloudinaryConfig, publishAdAsset } from '../../../../lib/cloudinaryAds';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const admin = await requireActiveAdmin(req, res, earningsDb);
  if (!admin) return;
  const body = req.body || {};
  const action = String(body.action || '');
  const reason = String(body.reason || '').trim().slice(0, 300);
  const now = new Date().toISOString();

  try {
    if (action === 'suspend_partner' || action === 'restore_partner') {
      if (action === 'suspend_partner' && reason.length < 3) return res.status(400).json({ error: 'Give a reason' });
      must(await earningsDb.from('affiliate_partners').update({
        status: action === 'suspend_partner' ? 'suspended' : 'active', suspended_reason: action === 'suspend_partner' ? reason : null, updated_at: now,
      }).eq('id', String(body.partner_id || '')));
      await auditEarnings(admin.id, action, 'affiliate_partner', body.partner_id, { reason });
      return res.status(200).json({ success: true });
    }
    if (action === 'approve_creative' || action === 'reject_creative') {
      if (action === 'reject_creative' && reason.length < 3) return res.status(400).json({ error: 'Give a reason' });
      // A privately uploaded creative becomes public only when approved.
      let mediaUrl;
      if (action === 'approve_creative') {
        const creative = must(await earningsDb.from('affiliate_creatives').select('kind, media_url, cloudinary_public_id').eq('id', String(body.creative_id || '')).maybeSingle());
        if (!creative) return res.status(404).json({ error: 'Creative not found' });
        if (creative.media_url?.includes('/authenticated/') && creative.cloudinary_public_id) {
          try {
            await publishAdAsset(creative.kind, creative.cloudinary_public_id);
          } catch (error) {
            console.error('creative publish failed:', error.message);
            return res.status(502).json({ error: 'Could not publish the media file. Try again.' });
          }
          mediaUrl = `https://res.cloudinary.com/${cloudinaryConfig().cloudName}/${creative.kind}/upload/${creative.cloudinary_public_id}`;
        }
      }
      must(await earningsDb.from('affiliate_creatives').update({
        status: action === 'approve_creative' ? 'approved' : 'rejected', reject_reason: action === 'reject_creative' ? reason : null,
        reviewed_by: admin.id, reviewed_at: now, ...(mediaUrl ? { media_url: mediaUrl } : {}),
      }).eq('id', String(body.creative_id || '')));
      await auditEarnings(admin.id, action, 'affiliate_creative', body.creative_id, { reason });
      return res.status(200).json({ success: true });
    }
    if (action === 'reverse_attribution' || action === 'release_held') {
      if (reason.length < 3) return res.status(400).json({ error: 'Give a reason' });
      const fn = action === 'reverse_attribution' ? 'affiliate_reverse_attribution' : 'affiliate_release_held';
      const params = action === 'reverse_attribution'
        ? { p_id: String(body.attribution_id || ''), p_admin: admin.id, p_reason: reason }
        : { p_id: String(body.attribution_id || ''), p_admin: admin.id, p_note: reason };
      const { data, error } = await earningsDb.rpc(fn, params);
      if (error) return res.status(400).json({ error: error.message });
      return res.status(200).json({ success: true, result: data });
    }
    if (action === 'pause_offer' || action === 'resume_offer') {
      must(await earningsDb.from('affiliate_offers').update({ status: action === 'pause_offer' ? 'paused' : 'active', updated_at: now })
        .eq('id', String(body.offer_id || '')));
      await auditEarnings(admin.id, action, 'affiliate_offer', body.offer_id, { reason });
      return res.status(200).json({ success: true });
    }
    if (action === 'platform_offer') {
      const settings = await getEarningsSettings();
      const pct = Number(body.commission_percent);
      if (!(pct > 0 && pct <= Number(settings.affiliate_max_commission_percent))) return res.status(400).json({ error: 'commission_percent out of range' });
      if (!(Number(settings.platform_monthly_budget_micro) > 0)) return res.status(400).json({ error: 'Set a monthly platform budget first' });
      const item = must(await earningsDb.from('catalogue_items').select('id, seller_username').eq('id', String(body.item_id || '')).maybeSingle());
      if (!item) return res.status(404).json({ error: 'Listing not found' });
      const existing = must(await earningsDb.from('affiliate_offers').select('id, funding').eq('item_id', item.id).maybeSingle());
      if (existing && existing.funding === 'seller') return res.status(409).json({ error: 'The seller already runs a seller-funded offer on this listing' });
      const row = { item_id: item.id, seller_username: item.seller_username, funding: 'platform', commission_percent: pct, status: 'active', updated_at: now };
      const data = existing
        ? must(await earningsDb.from('affiliate_offers').update(row).eq('id', existing.id).select('*').single())
        : must(await earningsDb.from('affiliate_offers').insert(row).select('*').single());
      await auditEarnings(admin.id, 'platform_offer', 'affiliate_offer', data.id, { item_id: item.id, commission_percent: pct, reason });
      return res.status(200).json({ offer: data });
    }
    return res.status(400).json({ error: 'Unknown action' });
  } catch (error) {
    console.error('admin/earnings/affiliate error:', error);
    return res.status(500).json({ error: 'Action failed' });
  }
}
