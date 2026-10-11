// Confirms a website (Paystack) digital checkout for the logged-in buyer and
// delivers it: a licence in the Library, or the creator subscription.
// Idempotent; safe to call again. Content that can't be delivered is refunded.
//   POST { reference }

import { requireParticipant } from '../../../lib/participantAuth';
import { paystackDeps } from '../../../lib/digitalBilling';
import { verifyDigitalCheckout } from '../../../lib/digitalPaystack';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const participant = await requireParticipant(req, res);
  if (!participant) return;
  try {
    const result = await verifyDigitalCheckout({ reference: String(req.body?.reference || '').trim(), participantId: participant.id }, paystackDeps);
    return res.status(result.status).json(result.body);
  } catch (error) {
    console.error('digital/paystack-verify error:', error.message || error);
    return res.status(502).json({ error: 'Could not confirm the payment yet. It will appear in your Library once confirmed.' });
  }
}
