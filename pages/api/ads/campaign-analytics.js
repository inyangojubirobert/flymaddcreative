// Analytics for one of your own campaigns (ads and boosts).
//   GET ?id=<campaign>&range=7d|30d|lifetime&tz=<IANA time zone>
// Totals, daily series and Home/Shop/Search/Category breakdown come from the
// real advertising_events rows (lib/adAnalytics.js). Another advertiser's
// campaign answers 404, exactly like a campaign that doesn't exist.

import { requireParticipant } from '../../../lib/participantAuth';
import { adsDb } from '../../../lib/ads';
import { ANALYTICS_RANGES, isValidTimeZone, loadCampaignAnalytics } from '../../../lib/adAnalytics';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const participant = await requireParticipant(req, res);
  if (!participant) return;

  const campaignId = String(req.query.id || '');
  if (!/^[0-9a-f-]{36}$/i.test(campaignId)) return res.status(400).json({ error: 'Campaign id is required' });
  const range = ANALYTICS_RANGES.includes(req.query.range) ? req.query.range : '7d';
  const timeZone = isValidTimeZone(req.query.tz) ? req.query.tz : 'UTC';

  try {
    const result = await loadCampaignAnalytics(adsDb, { campaignId, ownerId: participant.id, range, timeZone });
    if (!result) return res.status(404).json({ error: 'Campaign not found' });
    res.setHeader('Cache-Control', 'private, no-store');
    return res.status(200).json(result);
  } catch (error) {
    console.error('ads/campaign-analytics error:', error);
    return res.status(500).json({ error: 'Could not load analytics' });
  }
}
