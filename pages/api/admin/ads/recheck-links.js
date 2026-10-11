// Re-checks the external links of live and pending ads (oldest check first).
// Admin portal button, or daily Vercel cron (Authorization: Bearer CRON_SECRET).
// See lib/adLinkHealth.js for what happens to each campaign.

import { requireActiveAdmin } from '../../../../lib/adminAuth';
import { adsDb } from '../../../../lib/ads';
import { recheckCampaignLink } from '../../../../lib/adLinkHealth';

export default async function handler(req, res) {
  if (!['GET', 'POST'].includes(req.method)) return res.status(405).json({ error: 'Method not allowed' });
  const cronSecret = process.env.CRON_SECRET;
  const isCron = cronSecret && req.headers.authorization === `Bearer ${cronSecret}`;
  let admin = null;
  if (!isCron) {
    admin = await requireActiveAdmin(req, res, adsDb);
    if (!admin) return;
    if (req.method !== 'POST') return res.status(405).json({ error: 'Use POST' });
  }

  try {
    const { data, error } = await adsDb.from('advertising_campaigns').select('id')
      .eq('destination_type', 'external').in('status', ['active', 'pending_review'])
      .order('destination_checked_at', { ascending: true, nullsFirst: true })
      .limit(40);
    if (error) throw error;
    const results = { ok: 0, sent_to_review: 0, suspended: 0, updated: 0 };
    for (const row of data || []) {
      const outcome = await recheckCampaignLink(row.id, { actorId: admin?.id || null });
      if (outcome.outcome) results[outcome.outcome] = (results[outcome.outcome] || 0) + 1;
    }
    return res.status(200).json({ checked: (data || []).length, ...results });
  } catch (error) {
    console.error('admin/ads/recheck-links error:', error);
    return res.status(500).json({ error: 'Link re-check failed' });
  }
}
