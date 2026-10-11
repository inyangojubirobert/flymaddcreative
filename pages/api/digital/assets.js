// Files of a digital product.
//   POST   { item_id, public_id, asset_kind, title }  register an upload made with
//          /api/digital/upload-sign; re-read from Cloudinary and checked (owner folder,
//          private delivery, format, size, pages/duration; EPUBs are opened and
//          checked: real EPUB, not DRM-protected, readable sections). Failures are deleted.
//          New files on a published product send it back to review.
//   DELETE ?id=   remove a file (not allowed once buyers own the product - they
//          would lose access; contact support instead)

import { requireParticipant } from '../../../lib/participantAuth';
import { digitalDb } from '../../../lib/digital';
import { destroyAdAsset } from '../../../lib/cloudinaryAds';
import { DIGITAL_RULES, KIND_ASSETS, getDigitalResource, privateDownloadUrl, validateDigitalResource } from '../../../lib/digitalMedia';
import { inspectEpub } from '../../../lib/digitalEpub';

async function checkEpub(asset) {
  const response = await fetch(privateDownloadUrl(asset, 300));
  if (!response.ok) return { ok: false, reason: 'Could not read the uploaded EPUB' };
  return inspectEpub(new Uint8Array(await response.arrayBuffer()));
}

export default async function handler(req, res) {
  const participant = await requireParticipant(req, res);
  if (!participant) return;

  try {
    if (req.method === 'POST') {
      const assetKind = req.body?.asset_kind;
      const publicId = typeof req.body?.public_id === 'string' ? req.body.public_id.trim() : '';
      const rules = DIGITAL_RULES[assetKind];
      if (!rules || !publicId || publicId.length > 200) return res.status(400).json({ error: 'public_id and asset_kind are required' });

      const { data: product } = await digitalDb.from('digital_products').select('item_id, seller_username, kind, status')
        .eq('item_id', String(req.body?.item_id || '')).maybeSingle();
      if (!product || product.seller_username !== participant.username) return res.status(404).json({ error: 'Set up the digital product first' });
      if (!KIND_ASSETS[product.kind].includes(assetKind)) return res.status(400).json({ error: 'That file type does not match this product' });
      if (product.kind === 'ebook') {
        const { count } = await digitalDb.from('digital_assets').select('id', { count: 'exact', head: true }).eq('item_id', product.item_id).neq('status', 'removed');
        if (count) return res.status(409).json({ error: 'An e-book has one file (PDF or EPUB). Remove the current one first.' });
      }

      const resource = await getDigitalResource(rules.resourceType, publicId);
      const checked = validateDigitalResource(resource, participant.id, assetKind);
      if (checked.ok && assetKind === 'epub') {
        const epub = await checkEpub(checked.asset).catch(() => ({ ok: false, reason: 'Could not read the uploaded EPUB' }));
        if (epub.ok) Object.assign(checked.asset, { pages: epub.sections, preview_sections: epub.preview });
        else Object.assign(checked, { ok: false, reason: epub.reason });
      }
      if (!checked.ok) {
        if (resource && String(resource.public_id).startsWith(`onedream_digital/${participant.id}/`)) {
          await destroyAdAsset(rules.resourceType, resource.public_id).catch(() => {});
        }
        return res.status(400).json({ error: checked.reason });
      }

      const { count: position } = await digitalDb.from('digital_assets').select('id', { count: 'exact', head: true }).eq('item_id', product.item_id);
      const { data: asset, error } = await digitalDb.from('digital_assets').insert({
        ...checked.asset,
        item_id: product.item_id,
        owner_id: participant.id,
        kind: assetKind,
        title: typeof req.body?.title === 'string' ? req.body.title.trim().slice(0, 120) || null : null,
        position: position || 0,
      }).select('id, kind, title, position, format, bytes, pages, duration_seconds, status').single();
      if (error) {
        if (error.code === '23505') return res.status(409).json({ error: 'File already registered' });
        throw error;
      }
      if (product.status === 'published') {
        await digitalDb.from('digital_products').update({ status: 'pending_review', updated_at: new Date().toISOString() }).eq('item_id', product.item_id);
      }
      return res.status(201).json({ asset });
    }

    if (req.method === 'DELETE') {
      const { data: asset } = await digitalDb.from('digital_assets').select('*, digital_products(seller_username)').eq('id', String(req.query.id || '')).maybeSingle();
      if (!asset || asset.digital_products?.seller_username !== participant.username || asset.status === 'removed') {
        return res.status(404).json({ error: 'File not found' });
      }
      const { count } = await digitalDb.from('digital_licenses').select('id', { count: 'exact', head: true }).eq('item_id', asset.item_id).eq('status', 'active');
      if (count) return res.status(409).json({ error: 'Buyers own this product, so its files cannot be removed. Contact support.' });
      await destroyAdAsset(asset.resource_type, asset.cloudinary_public_id, 'authenticated').catch((e) => console.error('digital asset destroy failed:', e.message));
      await digitalDb.from('digital_assets').update({ status: 'removed' }).eq('id', asset.id);
      return res.status(200).json({ success: true });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (error) {
    console.error('digital/assets error:', error);
    return res.status(500).json({ error: 'File request failed' });
  }
}
