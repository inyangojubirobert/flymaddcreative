// The calling participant's partner (affiliate) account.
//   GET    -> { partner, merchant_link, storefront_url }   partner is null before enrolment
//   POST   { handle, display_name, bio? }                   enrol
//   PATCH  { display_name?, bio?, avatar_url? }             edit
// Existing merchant accounts link separately (link-merchant.js); nobody
// registers twice.

import { earningsDb, must, partnerForParticipant, requireParty, siteUrl } from '../../../lib/earnings';

function clean(body) {
  const out = {};
  if (body.display_name !== undefined) out.display_name = String(body.display_name).trim().slice(0, 60);
  if (body.bio !== undefined) out.bio = body.bio ? String(body.bio).trim().slice(0, 500) : null;
  if (body.avatar_url !== undefined) out.avatar_url = /^https:\/\/\S+$/.test(body.avatar_url || '') ? body.avatar_url : null;
  return out;
}

export default async function handler(req, res) {
  const party = await requireParty(req, res);
  if (!party) return;
  if (party.party_type !== 'participant') return res.status(403).json({ error: 'Sign in with your One Dream account to manage a partner profile' });

  try {
    if (req.method === 'GET') {
      const partner = await partnerForParticipant(party.party_id);
      const merchant = party.merchant_id
        ? must(await earningsDb.from('referral_merchants').select('id, merchant_name, email').eq('id', party.merchant_id).maybeSingle())
        : null;
      return res.status(200).json({
        partner,
        merchant_link: merchant,
        storefront_url: partner ? `${siteUrl()}/m/${partner.handle}` : null,
      });
    }
    if (req.method === 'POST') {
      const handle = String(req.body?.handle || '').trim().toLowerCase();
      if (!/^[a-z0-9][a-z0-9_-]{2,29}$/.test(handle)) return res.status(400).json({ error: 'Handle: 3-30 letters, numbers, - or _' });
      const fields = clean(req.body || {});
      if (!fields.display_name || fields.display_name.length < 2) return res.status(400).json({ error: 'Enter a display name' });
      const { data, error } = await earningsDb.from('affiliate_partners')
        .insert({ participant_id: party.party_id, handle, ...fields }).select('*').single();
      if (error?.code === '23505') return res.status(409).json({ error: String(error.message).includes('handle') ? 'That handle is taken' : 'You are already a partner' });
      if (error) throw error;
      return res.status(201).json({ partner: data, storefront_url: `${siteUrl()}/m/${data.handle}` });
    }
    if (req.method === 'PATCH') {
      const fields = clean(req.body || {});
      if (fields.display_name !== undefined && fields.display_name.length < 2) return res.status(400).json({ error: 'Enter a display name' });
      const data = must(await earningsDb.from('affiliate_partners').update({ ...fields, updated_at: new Date().toISOString() })
        .eq('participant_id', party.party_id).select('*').maybeSingle());
      if (!data) return res.status(404).json({ error: 'Join the partner programme first' });
      return res.status(200).json({ partner: data });
    }
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (error) {
    console.error('affiliate/partner error:', error);
    return res.status(500).json({ error: 'Could not load your partner account' });
  }
}
