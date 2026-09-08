import { createClient } from '@supabase/supabase-js';
import { requireParticipant } from '../../../lib/participantAuth';
import {
  AI_ACTION_COSTS,
  AI_PLAN_DEFINITIONS,
  buildBusinessMetrics,
  getAiUsage,
  publicPlanDefinitions,
  resolveAiSubscription,
} from '../../../lib/aiFeature';
import { GOOGLE_PLAY_AI_PRODUCTS, GOOGLE_PLAY_PACKAGE_NAME } from '../../../lib/aiPayments';

const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const participant = await requireParticipant(req, res);
  if (!participant) return;

  try {
    const [subscription, metrics, billingResult] = await Promise.all([
      resolveAiSubscription(supabase, participant.id),
      buildBusinessMetrics(supabase, participant),
      supabase.from('ai_provider_subscriptions')
        .select('provider, product_id, plan, status, current_period_end, pending_product_id, auto_renewing')
        .eq('participant_id', participant.id).is('replaced_by_reference', null),
    ]);
    if (billingResult.error) throw billingResult.error;
    const plan = AI_PLAN_DEFINITIONS[subscription.plan] || AI_PLAN_DEFINITIONS.free;
    const usage = await getAiUsage(supabase, participant.id, plan);

    return res.status(200).json({
      plan,
      usage,
      plans: publicPlanDefinitions(),
      actionCosts: AI_ACTION_COSTS,
      storeProducts: { googlePlay: GOOGLE_PLAY_AI_PRODUCTS },
      subscription,
      billing: {
        integrationVersion: 2,
        packageName: GOOGLE_PLAY_PACKAGE_NAME,
        subscriptions: (billingResult.data || []).filter((row) => (
          ['pending', 'past_due'].includes(row.status)
          || (['active', 'trialing', 'cancelled'].includes(row.status)
            && (!row.current_period_end || new Date(row.current_period_end).getTime() > Date.now()))
        )),
      },
      metrics,
    });
  } catch (error) {
    console.error('AI overview error:', error);
    return res.status(500).json({ error: 'Unable to load AI business overview' });
  }
}
