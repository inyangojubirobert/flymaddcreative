// Signed parameters for uploading one digital-product file (PDF, EPUB, audio
// or video) straight to Cloudinary as a private asset in the seller's folder.
// Register it afterwards with POST /api/digital/assets.

import { requireParticipant } from '../../../lib/participantAuth';
import { signDigitalUpload } from '../../../lib/digitalMedia';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const participant = await requireParticipant(req, res);
  if (!participant) return;
  const assetKind = req.body?.asset_kind;
  if (!['pdf', 'epub', 'audio', 'video'].includes(assetKind)) return res.status(400).json({ error: 'asset_kind must be pdf, epub, audio or video' });
  try {
    return res.status(200).json(signDigitalUpload(participant.id, assetKind));
  } catch (error) {
    console.error('digital/upload-sign error:', error.message);
    return res.status(503).json({ error: 'Uploads are not available right now' });
  }
}
