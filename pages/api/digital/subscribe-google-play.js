// Verifies a Google Play creator-subscription purchase (Android app) and
// records it, bound to the subscriber and creator stored in Google's record
// (rules: lib/digitalSubscriptions.js). Also used to restore / refresh.
//   POST { product_id, purchase_token, creator_username? }

import { requireParticipant } from '../../../lib/participantAuth';
import { googleSubscriptionDeps } from '../../../lib/digitalBilling';
import { processGoogleCreatorSubscription } from '../../../lib/digitalSubscriptions';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const participant = await requireParticipant(req, res);
  if (!participant) return;
  try {
    const result = await processGoogleCreatorSubscription({
      participantId: participant.id,
      productId: String(req.body?.product_id || '').trim(),
      purchaseToken: String(req.body?.purchase_token || '').trim(),
      creatorUsername: typeof req.body?.creator_username === 'string' ? req.body.creator_username.trim() : null,
    }, googleSubscriptionDeps);
    return res.status(result.status).json(result.body);
  } catch (error) {
    console.error('digital/subscribe-google-play error:', error.message || error);
    if ([400, 404, 410].includes(error?.status)) return res.status(400).json({ error: 'Google Play has no record of this subscription' });
    const notConfigured = ['google_play_not_configured', 'invalid_google_play_credentials'].includes(error?.message);
    return res.status(notConfigured ? 503 : 502).json({ error: notConfigured ? 'Google Play verification is not configured' : 'Could not verify this subscription. Open your Library shortly - it will retry.' });
  }
}
