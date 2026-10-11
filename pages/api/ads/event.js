// Records an impression or click for a live campaign. De-duplicated per
// viewer, campaign and hour in the database (ads_record_event), so refreshing
// or tapping repeatedly does not inflate the numbers.

import { adsDb, viewerKey } from '../../../lib/ads';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const campaignId = String(req.body?.campaign_id || '');
  const kind = req.body?.kind;
  if (!/^[0-9a-f-]{36}$/i.test(campaignId) || !['impression', 'click'].includes(kind)) {
    return res.status(400).json({ error: 'campaign_id and kind are required' });
  }
  const { data, error } = await adsDb.rpc('ads_record_event', {
    p_campaign_id: campaignId,
    p_kind: kind,
    p_placement: typeof req.body?.placement === 'string' ? req.body.placement : null,
    p_viewer_key: viewerKey(req),
  });
  if (error) console.error('ads/event error:', error.message);
  return res.status(200).json({ recorded: !!data });
}
