// Verifies a Google Play Dream Coin purchase and credits it exactly once.
// Rules: lib/dreamCoinsRules.js (processCoinPurchase).
//
// - The purchase is re-read from Google with the service account; the
//   client's word (including quantity) is never trusted.
// - Coins = Google's verified quantity x the package's coins_per_unit.
// - Idempotent per purchase token; consumed after crediting.
// - Refused while DREAM_COINS_ENABLED is off (unacknowledged purchases are
//   refunded by Google automatically after 3 days).
// One-time product APIs only - subscriptions and other packages untouched.

import { requireParticipant } from '../../../../lib/participantAuth';
import { coinPurchaseDeps } from '../../../../lib/dreamCoins';
import { processCoinPurchase } from '../../../../lib/dreamCoinsRules';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const participant = await requireParticipant(req, res);
  if (!participant) return;

  try {
    const result = await processCoinPurchase({
      participantId: participant.id,
      productId: String(req.body?.product_id || '').trim(),
      purchaseToken: String(req.body?.purchase_token || '').trim(),
    }, coinPurchaseDeps);
    return res.status(result.status).json(result.body);
  } catch (error) {
    console.error('gifts/verify-purchase error:', error.message || error);
    if ([400, 404, 410].includes(error?.status)) return res.status(400).json({ error: 'Google Play has no record of this purchase' });
    const notConfigured = ['google_play_not_configured', 'invalid_google_play_credentials'].includes(error?.message);
    return res.status(notConfigured ? 503 : 502).json({ error: notConfigured ? 'Google Play verification is not configured' : 'Could not verify this purchase. Try again shortly.' });
  }
}
