// Records a click on a partner link for one listing and returns a signed
// attribution token for the buyer's device to keep with the cart line.
//   POST { code, item_id, visitor } -> { token, item_id, expires_in_days }
// The click itself is stored on the server; the token only proves which
// click this device holds, so it can't be forged or edited.

import { getEarningsSettings, recordAffiliateClick } from '../../../lib/earnings';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const code = String(req.body?.code || '');
  const itemId = req.body?.item_id ? String(req.body.item_id) : null;
  if (!/^[A-Za-z0-9]{6,16}$/.test(code) || (itemId && !/^[0-9a-f-]{36}$/i.test(itemId))) return res.status(400).json({ error: 'Invalid link' });
  try {
    const result = await recordAffiliateClick(code, itemId, String(req.body?.visitor || '').slice(0, 80));
    if (result.reply) return res.status(result.reply.status).json(result.reply.body);
    const settings = await getEarningsSettings();
    return res.status(200).json({ token: result.token, item_id: result.click.item_id, expires_in_days: settings.affiliate_attribution_days });
  } catch (error) {
    console.error('affiliate/click error:', error);
    return res.status(500).json({ error: 'Could not record the click' });
  }
}
