import { createClient } from '@supabase/supabase-js';
import {
  activateVerifiedPaystackSubscription,
  applyAiSubscriptionEntitlement,
  fetchPaystackTransaction,
  planFromPaystackData,
  verifyPaystackWebhookSignature,
} from '../../../../lib/aiPayments';

const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

function subscriptionCode(data) {
  return data?.subscription?.subscription_code || data?.subscription_code || data?.subscription?.code || null;
}

async function findParticipant(data) {
  const metadataId = data?.metadata?.participant_id;
  if (metadataId) {
    const { data: participant } = await supabase.from('participants').select('id, username, email').eq('id', metadataId).maybeSingle();
    if (participant) return participant;
  }

  const code = subscriptionCode(data);
  if (code) {
    const { data: subscription } = await supabase
      .from('ai_subscriptions')
      .select('participant_id')
      .eq('provider', 'paystack')
      .eq('provider_reference', code)
      .maybeSingle();
    if (subscription?.participant_id) {
      const { data: participant } = await supabase.from('participants').select('id, username, email').eq('id', subscription.participant_id).maybeSingle();
      if (participant) return participant;
    }

    const { data: payment } = await supabase
      .from('ai_subscription_transactions')
      .select('participant_id')
      .eq('provider', 'paystack')
      .eq('provider_subscription_id', code)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (payment?.participant_id) {
      const { data: participant } = await supabase.from('participants').select('id, username, email').eq('id', payment.participant_id).maybeSingle();
      if (participant) return participant;
    }
  }

  const email = data?.customer?.email;
  if (email) {
    const { data: participant } = await supabase.from('participants').select('id, username, email').eq('email', email).maybeSingle();
    if (participant) return participant;
  }
  return null;
}

async function processSuccessfulCharge(eventData) {
  if (!eventData.reference) throw new Error('missing_payment_reference');
  const verified = await fetchPaystackTransaction(eventData.reference);
  // Invoice webhooks carry the subscription link even when transaction/verify
  // omits it. eventData comes only from this authenticated webhook handler.
  const transaction = { ...verified, subscription: verified.subscription || eventData.subscription };
  if (!planFromPaystackData(transaction) && !subscriptionCode(transaction)) return;
  const participant = await findParticipant(transaction);
  if (!participant) throw new Error('paystack_participant_not_found');
  return activateVerifiedPaystackSubscription(supabase, participant, transaction);
}

async function processLifecycleEvent(event, data) {
  const participant = await findParticipant(data);
  const code = subscriptionCode(data);
  if (!participant || !code) return;

  if (event === 'subscription.create') {
    const existingLink = await supabase.from('ai_subscription_transactions').select('id')
      .eq('provider', 'paystack').eq('provider_subscription_id', code).limit(1).maybeSingle();
    if (existingLink.error) throw existingLink.error;
    if (existingLink.data) return;
    const planCode = data.plan?.plan_code || data.plan_object?.plan_code;
    if (!planCode) return;
    const { data: quote, error } = await supabase.from('ai_subscription_transactions')
      .select('id, provider_reference').eq('provider', 'paystack').eq('participant_id', participant.id)
      .eq('product_id', planCode).eq('amount_minor', Number(data.amount ?? data.plan?.amount))
      .eq('currency', data.plan?.currency || data.plan_object?.currency || data.currency)
      .is('provider_subscription_id', null).in('status', ['pending', 'active'])
      .order('created_at', { ascending: false }).limit(1).maybeSingle();
    if (error) throw error;
    if (!quote) return;
    const linked = await supabase.from('ai_subscription_transactions')
      .update({ provider_subscription_id: code }).eq('id', quote.id).is('provider_subscription_id', null);
    if (linked.error) throw linked.error;
    // Bind the recurring code to the saved checkout; creation alone grants no access.
    const { data: paid, error: paidError } = await supabase.from('ai_provider_subscriptions').select('*')
      .eq('participant_id', participant.id).eq('provider', 'paystack').eq('provider_reference', quote.provider_reference).maybeSingle();
    if (paidError) throw paidError;
    if (paid) await applyAiSubscriptionEntitlement(supabase, {
      participantId: participant.id, provider: 'paystack', providerReference: code,
      linkedReference: quote.provider_reference, productId: paid.product_id,
      plan: paid.plan, status: paid.status, currentPeriodStart: paid.current_period_start,
      currentPeriodEnd: paid.current_period_end, observedAt: paid.observed_at,
    });
    return;
  }

  if (event === 'invoice.update' && data.paid) {
    return processSuccessfulCharge({ reference: data.transaction?.reference, subscription: data.subscription });
  }

  const { data: current, error } = await supabase.from('ai_provider_subscriptions')
    .select('plan, product_id, current_period_start, current_period_end').eq('participant_id', participant.id)
    .eq('provider', 'paystack').eq('provider_reference', code).maybeSingle();
  if (error) throw error;
  if (!current) return;
  const status = event === 'invoice.payment_failed' || (event === 'invoice.update' && !data.paid)
    ? 'past_due'
    : event === 'subscription.not_renew'
      ? 'cancelled'
      : 'expired';
  await applyAiSubscriptionEntitlement(supabase, {
    participantId: participant.id,
    provider: 'paystack',
    providerReference: code,
    productId: current.product_id,
    plan: current.plan,
    status,
    currentPeriodStart: current.current_period_start,
    currentPeriodEnd: current.current_period_end,
  });
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!verifyPaystackWebhookSignature(req.body, req.headers['x-paystack-signature'])) {
    return res.status(401).json({ error: 'Invalid webhook signature' });
  }

  try {
    const { event, data } = req.body || {};
    if (event === 'charge.success') await processSuccessfulCharge(data || {});
    if (['subscription.create', 'invoice.update', 'invoice.payment_failed', 'subscription.not_renew', 'subscription.disable'].includes(event)) {
      await processLifecycleEvent(event, data || {});
    }
    return res.status(200).json({ received: true });
  } catch (error) {
    console.error('AI Paystack webhook error:', error);
    return res.status(500).json({ error: 'Webhook processing failed' });
  }
}
