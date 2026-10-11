// Verifies a Google Play price-tier purchase and grants the digital licence
// for the exact item recorded in Google's purchase (rules: lib/digitalPurchase.js).
//   POST { product_id, purchase_token, item_id? }

import { requireParticipant } from '../../../lib/participantAuth';
import { digitalDb, digitalSalesPaused } from '../../../lib/digital';
import { consumeProductPurchase, getProductPurchase } from '../../../lib/adsGooglePlay';
import { processDigitalPurchase } from '../../../lib/digitalPurchase';

const deps = {
  paused: digitalSalesPaused,
  async findTierByProduct(productId) {
    const { data, error } = await digitalDb.from('digital_price_tiers').select('*').eq('google_play_product_id', productId).maybeSingle();
    if (error) throw error;
    return data;
  },
  async findLicenseByToken(token) {
    const { data, error } = await digitalDb.from('digital_licenses').select('id, buyer_id, item_id')
      .eq('provider', 'google_play').eq('provider_ref', token).maybeSingle();
    if (error) throw error;
    return data;
  },
  async grantLicense({ buyerId, itemId, paidTierId, providerRef, orderId }) {
    const { data, error } = await digitalDb.rpc('digital_grant_license', {
      p_buyer_id: buyerId, p_item_id: itemId, p_paid_tier_id: paidTierId,
      p_provider: 'google_play', p_provider_ref: providerRef, p_order_id: orderId, p_is_paid: true,
    });
    if (error) throw new Error(error.message);
    return data;
  },
  getPurchase: getProductPurchase,
  consume: consumeProductPurchase,
};

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const participant = await requireParticipant(req, res);
  if (!participant) return;

  try {
    const itemId = typeof req.body?.item_id === 'string' && /^[0-9a-f-]{36}$/i.test(req.body.item_id) ? req.body.item_id : null;
    const result = await processDigitalPurchase({
      participantId: participant.id,
      productId: String(req.body?.product_id || '').trim(),
      purchaseToken: String(req.body?.purchase_token || '').trim(),
      itemId,
    }, deps);
    return res.status(result.status).json(result.body);
  } catch (error) {
    console.error('digital/purchase-google-play error:', error.message || error);
    if ([400, 404, 410].includes(error?.status)) return res.status(400).json({ error: 'Google Play has no record of this purchase' });
    const notConfigured = ['google_play_not_configured', 'invalid_google_play_credentials'].includes(error?.message);
    return res.status(notConfigured ? 503 : 502).json({ error: notConfigured ? 'Google Play verification is not configured' : 'Could not verify this purchase. Open your Library shortly - it will retry.' });
  }
}
