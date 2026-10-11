// Opens a licensed product on this device: registers the device (within the
// device limit) and returns access to every file:
//   PDF   -> page images watermarked with the buyer's username
//   EPUB  -> time-limited download + watermark line for the reader
//   audio / video -> time-limited links (stream now or download for offline)
// plus offline_until and offline_key: an offline copy is encrypted on the
// device with offline_key (derived per licence + device) and must be
// re-checked online before offline_until, or the app deletes it.
//   POST { license_id, device_id }               an owned item
//   POST { item_id, device_id }                  an item included in an active creator subscription

import { requireParticipant } from '../../../lib/participantAuth';
import { assetAccess, digitalDb, digitalError, digitalSettings, offlineKey } from '../../../lib/digital';
import { googleRefreshDue, refreshGoogleSubscriptionRow } from '../../../lib/digitalBilling';

const UUID = /^[0-9a-f-]{36}$/i;

async function subscriptionAccess(participantId, itemId) {
  const { data, error } = await digitalDb.rpc('digital_subscription_access', { p_subscriber_id: participantId, p_item_id: itemId });
  if (error) throw error;
  return (Array.isArray(data) ? data[0] : data) || null;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const participant = await requireParticipant(req, res);
  if (!participant) return;

  const licenseId = String(req.body?.license_id || '');
  const subItemId = String(req.body?.item_id || '');
  const deviceId = typeof req.body?.device_id === 'string' ? req.body.device_id.trim() : '';
  if ((!UUID.test(licenseId) && !UUID.test(subItemId)) || deviceId.length < 16 || deviceId.length > 128) {
    return res.status(400).json({ error: 'license_id (or item_id) and device_id are required' });
  }

  try {
    const settings = await digitalSettings();
    let itemId;
    let devices;
    let scope;
    let offlineUntil = Date.now() + settings.offline_days * 24 * 3600 * 1000;

    if (UUID.test(licenseId)) {
      const { data, error: deviceError } = await digitalDb.rpc('digital_register_device', {
        p_license_id: licenseId, p_buyer_id: participant.id, p_device_id: deviceId,
      });
      if (deviceError) {
        const known = digitalError(deviceError);
        if (known) return res.status(known.status).json({ error: known.error });
        throw deviceError;
      }
      devices = data;
      const { data: license } = await digitalDb.from('digital_licenses').select('item_id').eq('id', licenseId).single();
      itemId = license.item_id;
      scope = `lic:${licenseId}`;
    } else {
      let access = await subscriptionAccess(participant.id, subItemId);
      if (!access) {
        // A Google Play subscription may have renewed since we last looked.
        const { data: product } = await digitalDb.from('digital_products').select('seller_username').eq('item_id', subItemId).maybeSingle();
        const { data: rows } = product
          ? await digitalDb.from('digital_subscriptions').select('*').eq('subscriber_id', participant.id).eq('creator_username', product.seller_username).limit(3)
          : { data: [] };
        const due = (rows || []).filter(googleRefreshDue);
        if (due.length) {
          await Promise.all(due.map((row) => refreshGoogleSubscriptionRow(row).catch(() => null)));
          access = await subscriptionAccess(participant.id, subItemId);
        }
      }
      if (!access) return res.status(403).json({ error: 'Your subscription does not include this item any more' });
      const { data, error: deviceError } = await digitalDb.rpc('digital_register_sub_device', {
        p_subscription_id: access.subscription_id, p_subscriber_id: participant.id, p_device_id: deviceId,
      });
      if (deviceError) {
        const known = digitalError(deviceError);
        if (known) return res.status(known.status).json({ error: known.error });
        throw deviceError;
      }
      devices = data;
      itemId = subItemId;
      scope = `sub:${access.subscription_id}:${subItemId}`;
      // Offline copies of subscription items never outlive the paid month.
      offlineUntil = Math.min(offlineUntil, new Date(access.current_period_end).getTime());
    }

    const [{ data: assets }, { data: buyer }] = await Promise.all([
      digitalDb.from('digital_assets').select('*').eq('item_id', itemId).eq('status', 'approved').order('position'),
      digitalDb.from('participants').select('username').eq('id', participant.id).single(),
    ]);

    let key = null;
    try { key = offlineKey(scope, deviceId); } catch { key = null; }

    return res.status(200).json({
      license_id: UUID.test(licenseId) ? licenseId : null,
      item_id: itemId,
      via: UUID.test(licenseId) ? 'purchase' : 'subscription',
      devices_used: devices,
      max_devices: settings.max_devices,
      offline_until: new Date(offlineUntil).toISOString(),
      offline_key: key,
      files: (assets || []).map((asset) => ({
        id: asset.id,
        kind: asset.kind,
        title: asset.title,
        position: asset.position,
        format: asset.format,
        bytes: Number(asset.bytes),
        pages: asset.pages,
        duration_seconds: asset.duration_seconds === null ? null : Number(asset.duration_seconds),
        access: assetAccess(asset, buyer?.username),
      })),
    });
  } catch (error) {
    console.error('digital/access error:', error);
    return res.status(500).json({ error: 'Could not open this item' });
  }
}
