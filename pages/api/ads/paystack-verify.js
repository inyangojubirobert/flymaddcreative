// Confirms a website (Paystack) package checkout for the logged-in buyer and
// grants the package. Idempotent; safe to call again.
//   POST { reference }

import { requireParticipant } from '../../../lib/participantAuth';
import { adPaystackDeps, verifyAdCheckout } from '../../../lib/adsPaystack';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const participant = await requireParticipant(req, res);
  if (!participant) return;
  try {
    const result = await verifyAdCheckout({ reference: String(req.body?.reference || '').trim(), participantId: participant.id }, adPaystackDeps);
    return res.status(result.status).json(result.body);
  } catch (error) {
    console.error('ads/paystack-verify error:', error.message || error);
    return res.status(502).json({ error: 'Could not confirm the payment yet. Your package appears once it is confirmed.' });
  }
}
