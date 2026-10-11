// Admin grant of a package to a user - for testing before Google Play
// products exist, compensation, or partnerships. Grants are recorded as
// unpaid (is_paid = false, provider = admin_grant) so they never appear as
// revenue.
//   POST { username, package_id, note }

import crypto from 'crypto';
import { requireActiveAdmin } from '../../../../lib/adminAuth';
import { adsDb, packageSnapshot } from '../../../../lib/ads';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const admin = await requireActiveAdmin(req, res, adsDb);
  if (!admin) return;

  const username = String(req.body?.username || '').trim().replace(/^@/, '');
  const note = typeof req.body?.note === 'string' ? req.body.note.trim().slice(0, 500) : '';
  if (!username || !note) return res.status(400).json({ error: 'username and a note (reason) are required' });

  try {
    const [{ data: participant }, { data: pkg }] = await Promise.all([
      adsDb.from('participants').select('id').eq('username', username).maybeSingle(),
      adsDb.from('advertising_packages').select('*').eq('id', String(req.body?.package_id || '')).maybeSingle(),
    ]);
    if (!participant) return res.status(404).json({ error: 'User not found' });
    if (!pkg) return res.status(404).json({ error: 'Package not found' });

    const { data, error } = await adsDb.from('advertising_entitlements').insert({
      participant_id: participant.id,
      package_id: pkg.id,
      package_snapshot: packageSnapshot(pkg),
      provider: 'admin_grant',
      provider_ref: `grant_${crypto.randomUUID()}`,
      price_usd: 0,
      is_paid: false,
      status: 'available',
      note,
      granted_by: admin.id,
    }).select('id').single();
    if (error) throw error;
    await adsDb.from('advertising_moderation').insert({ entitlement_id: data.id, action: 'granted', actor: 'admin', actor_id: admin.id, note });
    return res.status(201).json({ success: true, entitlement_id: data.id });
  } catch (error) {
    console.error('admin/ads/grant error:', error);
    return res.status(500).json({ error: 'Grant failed' });
  }
}
