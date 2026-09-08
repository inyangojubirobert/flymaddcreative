import { createClient } from '@supabase/supabase-js';
import { requireParticipant } from '../../../lib/participantAuth';
import { AI_PLAN_DEFINITIONS } from '../../../lib/aiFeature';
import { initializePaystackAiSubscription } from '../../../lib/aiPayments';
import { resolveCallbackUrl } from '../../../lib/paystackCallbackUrl';

const supabase = createClient(process.env.SUPABASE_URL || '', process.env.SUPABASE_SERVICE_ROLE_KEY || '');

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const participant = await requireParticipant(req, res);
  if (!participant) return;

  const requestedPlan = String(req.body?.plan || '').toLowerCase();
  if (!['pro', 'business'].includes(requestedPlan)) {
    return res.status(400).json({ error: 'Choose the Pro or Business plan' });
  }

  try {
    const defaultCallback = `${process.env.NEXT_PUBLIC_SITE_URL || 'https://www.flymaddcreative.online'}/user-dashboard.html?view=ai&ai_subscription=verify`;
    const callbackUrl = resolveCallbackUrl(req.body?.callback_url, defaultCallback);
    const checkout = await initializePaystackAiSubscription(supabase, participant, requestedPlan, callbackUrl);
    return res.status(200).json({
      success: true,
      provider: 'paystack',
      plan: AI_PLAN_DEFINITIONS[requestedPlan],
      ...checkout,
    });
  } catch (error) {
    console.error('AI subscription checkout error:', error);
    const notConfigured = ['paystack_not_configured', 'invalid_ai_subscription_rate'].includes(error?.message);
    const migrationMissing = error?.code === '42P01';
    return res.status(notConfigured || migrationMissing ? 503 : 502).json({
      error: migrationMissing
        ? 'AI subscription payments are not available yet. Please try again later.'
        : notConfigured
        ? 'AI subscription payments are not configured yet.'
        : 'Unable to start the secure subscription checkout.',
    });
  }
}
