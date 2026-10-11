// Signed, single-use parameters for uploading one advertising image or video
// directly to Cloudinary (the API secret stays on the server). The upload
// lands in the advertiser's own folder as a private ("authenticated") asset
// and must then be registered via POST /api/ads/media for verification.

import { requireParticipant } from '../../../lib/participantAuth';
import { signAdUpload } from '../../../lib/cloudinaryAds';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const participant = await requireParticipant(req, res);
  if (!participant) return;

  const resourceType = req.body?.resource_type;
  if (!['image', 'video'].includes(resourceType)) return res.status(400).json({ error: 'resource_type must be image or video' });

  try {
    return res.status(200).json(signAdUpload(participant.id, resourceType));
  } catch (error) {
    console.error('ads/media-sign error:', error.message);
    return res.status(503).json({ error: 'Media uploads are not available right now' });
  }
}
