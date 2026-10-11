// The logged-in user's creator subscriptions.
//   GET                                  list (refreshes Google Play ones that may have renewed)
//   POST { subscription_id, action: 'cancel' | 'resume' }   website subscriptions
// Cancelling stops renewal; access continues to the end of the paid month.
// Google Play subscriptions are cancelled in Google Play (manage_url).

import { requireParticipant } from '../../../lib/participantAuth';
import { digitalDb } from '../../../lib/digital';
import { listSubscriptions, manageUrl } from '../../../lib/digitalBilling';

export default async function handler(req, res) {
  const participant = await requireParticipant(req, res);
  if (!participant) return;
  try {
    if (req.method === 'GET') return res.status(200).json({ subscriptions: await listSubscriptions(participant.id) });
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    const action = req.body?.action;
    if (!['cancel', 'resume'].includes(action)) return res.status(400).json({ error: 'action must be cancel or resume' });
    const { data: sub } = await digitalDb.from('digital_subscriptions').select('*').eq('id', String(req.body?.subscription_id || '')).maybeSingle();
    if (!sub || sub.subscriber_id !== participant.id) return res.status(404).json({ error: 'Subscription not found' });
    if (sub.provider === 'google_play') return res.status(400).json({ error: 'Manage this subscription in Google Play', manage_url: manageUrl(sub.product_id) });
    if (!['active', 'past_due'].includes(sub.status) || new Date(sub.current_period_end).getTime() <= Date.now()) {
      return res.status(409).json({ error: 'This subscription has ended' });
    }
    if (action === 'resume') {
      if (!sub.paystack_authorization_code) return res.status(409).json({ error: 'No saved card for renewals. Subscribe again when this month ends.' });
      const { data: plan } = await digitalDb.from('digital_creator_plans').select('is_active').eq('creator_username', sub.creator_username).maybeSingle();
      if (!plan?.is_active) return res.status(409).json({ error: 'This creator no longer offers a subscription' });
    }
    await digitalDb.from('digital_subscriptions').update({
      auto_renew: action === 'resume',
      end_reason: action === 'cancel' ? 'cancelled' : null,
      updated_at: new Date().toISOString(),
    }).eq('id', sub.id);
    return res.status(200).json({ success: true, auto_renew: action === 'resume', access_until: sub.current_period_end });
  } catch (error) {
    console.error('digital/subscriptions error:', error.message || error);
    return res.status(500).json({ error: 'Could not load subscriptions' });
  }
}
