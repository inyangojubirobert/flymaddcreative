import { createClient } from '@supabase/supabase-js';
import { requireParticipant } from '../../../../lib/participantAuth';
import { activateVerifiedPaystackSubscription, fetchPaystackTransaction } from '../../../../lib/aiPayments';

const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const participant = await requireParticipant(req, res);
  if (!participant) return;

  const reference = String(req.body?.reference || '').trim();
  if (!reference || reference.length > 240) return res.status(400).json({ error: 'A valid payment reference is required.' });

  try {
    const transaction = await fetchPaystackTransaction(reference);
    const entitlement = await activateVerifiedPaystackSubscription(supabase, participant, transaction);
    return res.status(200).json({
      success: true,
      message: `${entitlement.plan.name} is now active.`,
      ...entitlement,
    });
  } catch (error) {
    console.error('AI Paystack verification error:', error);
    const migrationMissing = error?.code === '42P01';
    const invalidPayment = String(error?.message || '').startsWith('payment_')
      || String(error?.message || '').startsWith('invalid_payment')
      || error?.message === 'unknown_ai_plan';
    return res.status(migrationMissing ? 503 : invalidPayment ? 400 : 502).json({
      error: migrationMissing
        ? 'AI payment storage is being set up. Run the AI subscription payment migration.'
        : invalidPayment
          ? 'This payment could not be verified for your account and selected plan.'
          : 'Paystack verification is temporarily unavailable.',
    });
  }
}
