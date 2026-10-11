// Admin: record a payout of a seller's CLEARED digital earnings (after
// reconciling with Google Play's payout). Marks those earnings paid_out with
// the payout reference and tells the seller. Money is sent outside the app;
// this is the ledger record. Separate from marketplace withdrawals.
//   POST { seller_username, reference, note? }

import { requireActiveAdmin } from '../../../../lib/adminAuth';
import { digitalDb } from '../../../../lib/digital';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const admin = await requireActiveAdmin(req, res, digitalDb);
  if (!admin) return;
  const seller = String(req.body?.seller_username || '').trim().replace(/^@/, '');
  const reference = typeof req.body?.reference === 'string' ? req.body.reference.trim().slice(0, 200) : '';
  if (!seller || !reference) return res.status(400).json({ error: 'seller_username and a payout reference are required' });
  try {
    const now = new Date().toISOString();
    const { data, error } = await digitalDb.from('digital_earnings')
      .update({ status: 'paid_out', paid_out_at: now, payout_reference: reference })
      .eq('seller_username', seller).eq('status', 'pending').lte('clears_at', now)
      .select('net_usd');
    if (error) throw error;
    const total = Math.round((data || []).reduce((sum, e) => sum + Number(e.net_usd), 0) * 100) / 100;
    if (!data?.length) return res.status(409).json({ error: 'No cleared earnings to pay out for this seller' });
    const { data: participant } = await digitalDb.from('participants').select('id').eq('username', seller).maybeSingle();
    if (participant) {
      await digitalDb.from('support_messages').insert({
        participant_id: participant.id, admin_id: admin.id, sender_type: 'system', message_type: 'payout_notification',
        body: `Digital sales payout of $${total.toFixed(2)} sent (${data.length} sale${data.length === 1 ? '' : 's'}). Reference: ${reference}.`,
      }).then(({ error: e }) => { if (e) console.error('digital payout notice failed:', e.message); });
    }
    return res.status(200).json({ success: true, sales: data.length, total_usd: total });
  } catch (error) {
    console.error('admin/digital/payouts error:', error);
    return res.status(500).json({ error: 'Payout record failed' });
  }
}
