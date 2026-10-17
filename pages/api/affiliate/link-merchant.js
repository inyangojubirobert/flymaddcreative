// Links the caller's One Dream (participant) account to their existing
// merchant account, so one person sees every earning stream together.
//   POST { merchant_token }   the token from signing in as a merchant
// One merchant <-> one participant; links are not silently replaced.

import { earningsDb, must, requireParty, verifyMerchantToken } from '../../../lib/earnings';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const party = await requireParty(req, res);
  if (!party) return;
  if (party.party_type !== 'participant') return res.status(403).json({ error: 'Sign in with your One Dream account' });
  const merchant = verifyMerchantToken(req.body?.merchant_token);
  if (!merchant) return res.status(401).json({ error: 'Sign in to your merchant account first' });

  try {
    const existing = must(await earningsDb.from('merchant_participant_links').select('*')
      .or(`merchant_id.eq.${merchant.id},participant_id.eq.${party.party_id}`));
    if (existing.some((l) => l.merchant_id === merchant.id && l.participant_id === party.party_id)) {
      return res.status(200).json({ success: true, already_linked: true });
    }
    if (existing.length) return res.status(409).json({ error: 'One of these accounts is already linked to another account. Contact support to change it.' });
    must(await earningsDb.from('merchant_participant_links').insert({ merchant_id: merchant.id, participant_id: party.party_id }));
    return res.status(201).json({ success: true, already_linked: false });
  } catch (error) {
    console.error('affiliate/link-merchant error:', error);
    return res.status(500).json({ error: 'Could not link the accounts' });
  }
}
