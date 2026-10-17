// Payout details and identity for one payee (participant or merchant).
//   GET  ?as=participant|merchant
//   POST { as?, legal_name, country, date_of_birth, payout_method, payout_details }
// Saving sends the details for verification again. Only the masked minimum
// is stored (bank name, last 4 digits); full account details belong with the
// payout provider. Payees must be 18 or older.

import { earningsDb, must, requireParty } from '../../../lib/earnings';

function target(party, as) {
  if (as === 'merchant' && party.merchant_id) return { type: 'merchant', id: party.merchant_id };
  if (as === 'participant' && party.party_type === 'merchant' && party.linked_participant_id) return { type: 'participant', id: party.linked_participant_id };
  return { type: party.party_type, id: party.party_id };
}

export default async function handler(req, res) {
  const party = await requireParty(req, res);
  if (!party) return;
  const who = target(party, String(req.query.as || req.body?.as || ''));

  try {
    if (req.method === 'GET') {
      const payee = must(await earningsDb.from('payee_profiles').select('legal_name, country, date_of_birth, payout_method, payout_details, kyc_status, kyc_note, updated_at')
        .eq('party_type', who.type).eq('party_id', who.id).maybeSingle());
      return res.status(200).json({ payee, party_type: who.type });
    }
    if (req.method === 'POST') {
      const b = req.body || {};
      const legalName = String(b.legal_name || '').trim();
      const country = String(b.country || '').trim().toUpperCase();
      const dob = String(b.date_of_birth || '');
      const method = String(b.payout_method || '').trim();
      const details = b.payout_details && typeof b.payout_details === 'object' ? b.payout_details : {};
      const errors = [];
      if (legalName.length < 2 || legalName.length > 120) errors.push('Enter your full legal name');
      if (!/^[A-Z]{2}$/.test(country)) errors.push('Choose your country');
      const born = new Date(`${dob}T00:00:00Z`);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(dob) || Number.isNaN(born.getTime())) errors.push('Enter your date of birth (YYYY-MM-DD)');
      else {
        const adult = new Date(born); adult.setUTCFullYear(adult.getUTCFullYear() + 18);
        if (adult > new Date()) errors.push('You must be 18 or older to receive payouts');
      }
      if (method.length < 2 || method.length > 40) errors.push('Choose a payout method');
      // Masked only: refuse anything that looks like a full account or card number.
      const masked = {};
      for (const [k, v] of Object.entries(details).slice(0, 6)) {
        const value = String(v ?? '').slice(0, 60);
        if (/\d{7,}/.test(value.replace(/\s/g, ''))) { errors.push('Enter only the last 4 digits of account numbers'); break; }
        masked[String(k).slice(0, 30)] = value;
      }
      if (errors.length) return res.status(400).json({ error: errors.join('; ') });
      const row = {
        party_type: who.type, party_id: who.id, legal_name: legalName, country, date_of_birth: dob,
        payout_method: method, payout_details: masked, kyc_status: 'submitted', kyc_note: null, verified_by: null, verified_at: null,
        updated_at: new Date().toISOString(),
      };
      const data = must(await earningsDb.from('payee_profiles').upsert(row, { onConflict: 'party_type,party_id' })
        .select('legal_name, country, date_of_birth, payout_method, payout_details, kyc_status').single());
      return res.status(200).json({ payee: data });
    }
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (error) {
    console.error('earnings/payee error:', error);
    return res.status(500).json({ error: 'Could not save your payout details' });
  }
}
