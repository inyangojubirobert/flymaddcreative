// Withdrawal requests for partner & creator earnings. A separate queue from
// every existing withdrawal (votes, marketplace, merchant tokens).
//   GET                                                      mine
//   POST   { as?, source, currency?, amount_usd, client_request_id }    request (moves available -> reserved);
//          amount_usd is the amount in that currency (NGN or USD)
//   DELETE ?id=                                              cancel a request not yet approved
// Closed unless earnings_settings.payouts_enabled AND PAYOUTS_PROVIDER_LIVE=true.
// Admins approve and record the transfer (pages/api/admin/earnings/payouts.js).

import { earningsDb, getEarningsSettings, must, payoutsLiveInDeployment, requireParty } from '../../../lib/earnings';
import { EARNING_SOURCES, payoutErrorReply, toMicro } from '../../../lib/earningsRules';

const MERCHANT_SOURCES = ['gift_referral', 'referral'];

function partyForSource(party, source, as) {
  // Gift referrals and referral rewards belong to the merchant account.
  if (MERCHANT_SOURCES.includes(source) || as === 'merchant') {
    return party.merchant_id ? { type: 'merchant', id: party.merchant_id } : null;
  }
  if (party.party_type === 'participant') return { type: 'participant', id: party.party_id };
  return party.linked_participant_id ? { type: 'participant', id: party.linked_participant_id } : null;
}

export default async function handler(req, res) {
  const party = await requireParty(req, res);
  if (!party) return;

  try {
    if (req.method === 'GET') {
      const parties = [{ type: party.party_type, id: party.party_id }];
      if (party.party_type === 'participant' && party.merchant_id) parties.push({ type: 'merchant', id: party.merchant_id });
      const rows = (await Promise.all(parties.map((p) => earningsDb.from('payout_requests').select('*').eq('party_type', p.type).eq('party_id', p.id)
        .order('created_at', { ascending: false }).limit(100).then(must)))).flat();
      return res.status(200).json({ payouts: rows });
    }

    if (req.method === 'POST') {
      const settings = await getEarningsSettings();
      if (!settings.payouts_enabled || !payoutsLiveInDeployment()) return res.status(503).json({ error: 'Withdrawals are not open yet', code: 'payouts_disabled' });
      const source = String(req.body?.source || '');
      if (!EARNING_SOURCES.includes(source)) return res.status(400).json({ error: 'Choose which earnings to withdraw' });
      const who = partyForSource(party, source, req.body?.as);
      if (!who) return res.status(403).json({ error: 'Link your merchant account to withdraw these earnings' });
      const amount = toMicro(req.body?.amount_usd);
      const key = String(req.body?.client_request_id || '');
      if (!/^[A-Za-z0-9_-]{8,80}$/.test(key)) return res.status(400).json({ error: 'client_request_id is required' });
      const { data, error } = await earningsDb.rpc('payout_request_create', {
        p_party_type: who.type, p_party_id: who.id, p_source: source, p_amount: amount, p_client_request_id: key,
        p_currency: req.body?.currency === 'NGN' ? 'NGN' : 'USD',
      });
      if (error) {
        const reply = payoutErrorReply(error.message);
        if (reply) return res.status(reply.status).json(reply.body);
        throw error;
      }
      return res.status(200).json(data);
    }

    if (req.method === 'DELETE') {
      const request = must(await earningsDb.from('payout_requests').select('id, party_type, party_id, status').eq('id', String(req.query.id || '')).maybeSingle());
      const mine = request && ((request.party_type === party.party_type && request.party_id === party.party_id)
        || (request.party_type === 'merchant' && request.party_id === party.merchant_id));
      if (!mine) return res.status(404).json({ error: 'Request not found' });
      const { error } = await earningsDb.rpc('payout_request_decide', {
        p_request_id: request.id, p_action: 'cancel', p_admin: null, p_reference: null, p_reason: 'cancelled by payee',
      });
      if (error) return res.status(400).json({ error: 'Only requests that have not been approved can be cancelled' });
      return res.status(200).json({ success: true });
    }
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (error) {
    console.error('earnings/payouts error:', error);
    return res.status(500).json({ error: 'Could not process the withdrawal request' });
  }
}
