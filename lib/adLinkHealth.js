// Re-validation of external ad destinations after approval. A website can
// change after it was checked, so live links are re-checked daily (cron) and
// on demand (admin), and approval requires a check within the last 7 days.
//
// Outcomes for a campaign:
//   ok             still safe, same final URL  -> check time refreshed
//   sent_to_review now redirects somewhere new -> back to review (paused;
//                                                paused time returned on approval)
//   suspended      no longer reachable / unsafe -> live ad suspended with reason
//   updated        pending ad: check time / final URL refreshed for the reviewer

import { adsDb } from './ads';
import { checkDestination } from './adDestinations';

export async function recheckCampaignLink(campaignId, { actorId = null, check = checkDestination, db = adsDb } = {}) {
  const { data: c, error } = await db.from('advertising_campaigns')
    .select('id, status, destination_type, destination_url, destination_final_url').eq('id', campaignId).maybeSingle();
  if (error) throw error;
  if (!c || c.destination_type !== 'external') return { error: 'This campaign has no external link' };
  if (!['active', 'pending_review'].includes(c.status)) return { error: 'Only live or pending campaigns are re-checked' };

  const result = await check(c.destination_url);
  const now = new Date().toISOString();
  const log = (action, note) => db.from('advertising_moderation').insert({ campaign_id: c.id, action, actor: actorId ? 'admin' : 'system', actor_id: actorId, note });

  if (!result.ok) {
    if (c.status === 'active') {
      await db.from('advertising_campaigns').update({ status: 'suspended', paused_at: null, review_note: `Link check failed: ${result.reason}`, updated_at: now }).eq('id', c.id);
      await log('link_failed_suspended', result.reason);
      return { outcome: 'suspended', reason: result.reason };
    }
    await db.from('advertising_campaigns').update({ review_note: `Link check failed: ${result.reason}`, updated_at: now }).eq('id', c.id);
    await log('link_failed', result.reason);
    return { outcome: 'updated', reason: result.reason };
  }

  const redirectChanged = !!c.destination_final_url && result.finalUrl !== c.destination_final_url;
  const update = { destination_checked_at: now, destination_final_url: result.finalUrl, updated_at: now };
  if (redirectChanged && c.status === 'active') {
    await db.from('advertising_campaigns').update({ ...update, status: 'pending_review', review_note: `Link now leads to ${result.finalUrl}` }).eq('id', c.id);
    await log('link_redirect_changed', `${c.destination_final_url} -> ${result.finalUrl}`);
    return { outcome: 'sent_to_review', final_url: result.finalUrl };
  }
  await db.from('advertising_campaigns').update(update).eq('id', c.id);
  return { outcome: c.status === 'active' ? 'ok' : 'updated', final_url: result.finalUrl };
}
