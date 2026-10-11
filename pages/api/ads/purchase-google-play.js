// Verifies a Google Play purchase of an advertising / boost package and grants
// exactly one entitlement for it. Rules: lib/adsPurchase.js.
//
// - Refused for inactive packages, packages without a google_play_product_id,
//   or while PROMOTIONAL_BILLING_PAUSED=true (emergency stop). A placeholder
//   id with no Play product never grants: Google has no purchase for it.
// - The purchase is re-read from Google with the service account; the
//   client's word is never trusted.
// - Idempotent per purchase token; the purchase is consumed after granting.
// Uses one-time product APIs only - AI subscriptions are not touched.

import { requireParticipant } from '../../../lib/participantAuth';
import { adsDb } from '../../../lib/ads';
import { consumeProductPurchase, getProductPurchase } from '../../../lib/adsGooglePlay';
import { processAdPurchase } from '../../../lib/adsPurchase';

const deps = {
  async findPackageByProduct(productId) {
    const { data, error } = await adsDb.from('advertising_packages').select('*').eq('google_play_product_id', productId).maybeSingle();
    if (error) throw error;
    return data;
  },
  async findEntitlementByToken(token) {
    const { data, error } = await adsDb.from('advertising_entitlements').select('id, participant_id, status')
      .eq('provider', 'google_play').eq('provider_ref', token).maybeSingle();
    if (error) throw error;
    return data;
  },
  async insertEntitlement(row) {
    const { data, error } = await adsDb.from('advertising_entitlements').insert(row).select('id, status').single();
    if (error?.code === '23505') return { duplicate: true };
    if (error) throw error;
    return { row: data };
  },
  getPurchase: getProductPurchase,
  consume: consumeProductPurchase,
};

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const participant = await requireParticipant(req, res);
  if (!participant) return;

  try {
    const result = await processAdPurchase({
      participantId: participant.id,
      productId: String(req.body?.product_id || '').trim(),
      purchaseToken: String(req.body?.purchase_token || '').trim(),
    }, deps);
    return res.status(result.status).json(result.body);
  } catch (error) {
    console.error('ads/purchase-google-play error:', error.message || error);
    // Google has no such purchase (e.g. a product id that is only a placeholder): refuse, grant nothing.
    if ([400, 404, 410].includes(error?.status)) return res.status(400).json({ error: 'Google Play has no record of this purchase' });
    const notConfigured = ['google_play_not_configured', 'invalid_google_play_credentials'].includes(error?.message);
    return res.status(notConfigured ? 503 : 502).json({ error: notConfigured ? 'Google Play verification is not configured' : 'Could not verify this purchase. Try again shortly.' });
  }
}
