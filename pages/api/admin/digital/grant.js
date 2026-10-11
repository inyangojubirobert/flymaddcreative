// Admin: give a user a digital product without payment (testing, review
// copies, compensation). Recorded as unpaid - no seller earning is created.
//   POST { username, item_id, note }

import crypto from 'crypto';
import { requireActiveAdmin } from '../../../../lib/adminAuth';
import { digitalDb } from '../../../../lib/digital';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const admin = await requireActiveAdmin(req, res, digitalDb);
  if (!admin) return;
  const username = String(req.body?.username || '').trim().replace(/^@/, '');
  const note = typeof req.body?.note === 'string' ? req.body.note.trim() : '';
  if (!username || !note) return res.status(400).json({ error: 'username and a note are required' });
  try {
    const { data: participant } = await digitalDb.from('participants').select('id').eq('username', username).maybeSingle();
    if (!participant) return res.status(404).json({ error: 'User not found' });
    const { data, error } = await digitalDb.rpc('digital_grant_license', {
      p_buyer_id: participant.id, p_item_id: String(req.body?.item_id || ''), p_paid_tier_id: null,
      p_provider: 'admin_grant', p_provider_ref: `grant_${crypto.randomUUID()}`, p_order_id: `admin:${admin.id}:${note.slice(0, 80)}`, p_is_paid: false,
    });
    if (error) {
      const known = ['product_not_available', 'already_owned', 'own_product'].find((k) => error.message.includes(k));
      return res.status(known ? 409 : 500).json({ error: known ? known.replace(/_/g, ' ') : 'Grant failed' });
    }
    return res.status(201).json({ success: true, license_id: data });
  } catch (error) {
    console.error('admin/digital/grant error:', error);
    return res.status(500).json({ error: 'Grant failed' });
  }
}
