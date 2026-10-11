// Admin: end one digital licence now (abuse, rights complaint, a refund made
// outside the automatic sync). The seller's earning is reversed if not yet
// paid out; offline copies are wiped at the app's next online check.
// This does not move money - refund the buyer in Google Play / Paystack.
//   POST { license_id, reason }

import { requireActiveAdmin } from '../../../../lib/adminAuth';
import { digitalDb } from '../../../../lib/digital';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const admin = await requireActiveAdmin(req, res, digitalDb);
  if (!admin) return;
  const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim().slice(0, 200) : '';
  if (!reason) return res.status(400).json({ error: 'A reason is required' });
  try {
    const { data: license } = await digitalDb.from('digital_licenses').select('provider, provider_ref, status').eq('id', String(req.body?.license_id || '')).maybeSingle();
    if (!license) return res.status(404).json({ error: 'Licence not found' });
    const { data, error } = await digitalDb.rpc('digital_revoke_license', {
      p_provider: license.provider, p_provider_ref: license.provider_ref, p_status: 'revoked', p_reason: `Admin: ${reason}`,
    });
    if (error) throw error;
    if (!data) return res.status(409).json({ error: 'Licence already ended' });
    return res.status(200).json({ success: true });
  } catch (error) {
    console.error('admin/digital/revoke error:', error);
    return res.status(500).json({ error: 'Could not end the licence' });
  }
}
