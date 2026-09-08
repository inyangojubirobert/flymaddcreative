import { createClient } from '@supabase/supabase-js';
import {
  acknowledgeGooglePlaySubscription,
  GOOGLE_PLAY_PACKAGE_NAME,
  findGooglePlayParticipant,
  syncGooglePlayEntitlement,
  verifyGooglePlaySubscription,
  verifyGooglePubSubIdentity,
} from '../../../../lib/aiPayments';

const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const authenticated = await verifyGooglePubSubIdentity(req.headers.authorization);
  if (!authenticated) return res.status(401).json({ error: 'Invalid Google Pub/Sub identity' });

  try {
    const encoded = req.body?.message?.data;
    if (!encoded) return res.status(400).json({ error: 'Missing Pub/Sub message data' });
    const notification = JSON.parse(Buffer.from(encoded, 'base64').toString('utf8'));
    if (notification.packageName !== GOOGLE_PLAY_PACKAGE_NAME) return res.status(400).json({ error: 'Package mismatch' });
    const purchaseToken = notification?.subscriptionNotification?.purchaseToken;
    if (!purchaseToken) return res.status(204).end();

    const verified = await verifyGooglePlaySubscription(purchaseToken);
    // New/replacement/pending-completed tokens can arrive before the app posts
    // them. Resolve the owner from Google's account ID or the linked old token.
    const participantId = await findGooglePlayParticipant(supabase, purchaseToken, verified);
    if (!participantId) return res.status(503).json({ error: 'Purchase account not linked yet; retry notification' });
    await syncGooglePlayEntitlement(supabase, participantId, purchaseToken, verified);
    if (verified.active && verified.acknowledgementState === 'ACKNOWLEDGEMENT_STATE_PENDING') {
      await acknowledgeGooglePlaySubscription(verified.productId, purchaseToken);
    }
    return res.status(204).end();
  } catch (error) {
    console.error('Google Play RTDN processing error:', error);
    return res.status(500).json({ error: 'Notification processing failed' });
  }
}
