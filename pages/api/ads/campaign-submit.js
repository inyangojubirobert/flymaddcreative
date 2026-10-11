// Submits a campaign. Rules are enforced in ads_submit_campaign(): ads go to
// admin review; boosts of the seller's own live listing go live at once.

import { requireParticipant } from '../../../lib/participantAuth';
import { adErrorMessage, adsDb } from '../../../lib/ads';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const participant = await requireParticipant(req, res);
  if (!participant) return;

  const { data, error } = await adsDb.rpc('ads_submit_campaign', { p_campaign_id: String(req.body?.id || ''), p_owner_id: participant.id });
  if (error) {
    const message = adErrorMessage(error);
    if (message) return res.status(400).json({ error: message });
    console.error('ads/campaign-submit error:', error);
    return res.status(500).json({ error: 'Could not submit campaign' });
  }
  return res.status(200).json({
    status: data,
    message: data === 'active' ? 'Your boost is live.' : 'Submitted. One Dream will review your campaign before it goes live.',
  });
}
