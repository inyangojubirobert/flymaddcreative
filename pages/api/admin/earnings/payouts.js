// Admin: payout queue and payee verification (all audited).
//   POST { target: 'payout', request_id, action: 'approve' | 'reject' | 'mark_paid' | 'mark_failed', reference?, reason? }
//   POST { target: 'payee', party_type, party_id, decision: 'verified' | 'rejected', note? }
// There is no automated disbursement: the transfer is made through the
// approved payout provider and its reference is recorded here.

import { requireActiveAdmin } from '../../../../lib/adminAuth';
import { auditEarnings, earningsDb, must } from '../../../../lib/earnings';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const admin = await requireActiveAdmin(req, res, earningsDb);
  if (!admin) return;
  const body = req.body || {};

  try {
    if (body.target === 'payout') {
      const action = String(body.action || '');
      if (!['approve', 'reject', 'mark_paid', 'mark_failed'].includes(action)) return res.status(400).json({ error: 'Unknown action' });
      if (['reject', 'mark_failed'].includes(action) && String(body.reason || '').trim().length < 3) return res.status(400).json({ error: 'Give a reason' });
      const { data, error } = await earningsDb.rpc('payout_request_decide', {
        p_request_id: String(body.request_id || ''), p_action: action, p_admin: admin.id,
        p_reference: body.reference ? String(body.reference).slice(0, 120) : null, p_reason: body.reason ? String(body.reason).slice(0, 500) : null,
      });
      if (error) return res.status(400).json({ error: String(error.message).replace(/^.*?(invalid_transition|reference_required|payout_not_found)/, '$1') });
      await auditEarnings(admin.id, `payout_${action}`, 'payout_request', body.request_id, { reference: body.reference || null, reason: body.reason || null });
      return res.status(200).json(data);
    }
    if (body.target === 'payee') {
      const decision = body.decision === 'verified' ? 'verified' : body.decision === 'rejected' ? 'rejected' : null;
      if (!decision) return res.status(400).json({ error: 'decision: verified or rejected' });
      const data = must(await earningsDb.from('payee_profiles').update({
        kyc_status: decision, kyc_note: body.note ? String(body.note).slice(0, 300) : null,
        verified_by: admin.id, verified_at: new Date().toISOString(), updated_at: new Date().toISOString(),
      }).eq('party_type', String(body.party_type || '')).eq('party_id', String(body.party_id || '')).select('party_type, party_id, kyc_status').maybeSingle());
      if (!data) return res.status(404).json({ error: 'Payee not found' });
      await auditEarnings(admin.id, `payee_${decision}`, 'payee', `${data.party_type}:${data.party_id}`, { note: body.note || null });
      return res.status(200).json({ payee: data });
    }
    return res.status(400).json({ error: 'target must be payout or payee' });
  } catch (error) {
    console.error('admin/earnings/payouts error:', error);
    return res.status(500).json({ error: 'Action failed' });
  }
}
