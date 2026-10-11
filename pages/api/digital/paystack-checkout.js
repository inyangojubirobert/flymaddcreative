// Website checkout for a digital product or a creator's monthly subscription
// (Paystack, NGN at the live USD rate). Separate from the marketplace
// checkout: no escrow, no order - delivery is the buyer's Library.
//   POST { purpose: 'purchase', item_id, callback_url? }
//   POST { purpose: 'subscription', creator_username, callback_url? }
// -> { authorization_url, reference, amount_ngn, price_usd }
// After paying, the buyer returns to callback_url?reference=... and the page
// calls POST /api/digital/paystack-verify. The daily billing sync confirms any
// checkout the buyer did not return from.

import { requireParticipant } from '../../../lib/participantAuth';
import { paystackDeps } from '../../../lib/digitalBilling';
import { startDigitalCheckout } from '../../../lib/digitalPaystack';
import { resolveCallbackUrl } from '../../../lib/paystackCallbackUrl';

const SITE = () => process.env.NEXT_PUBLIC_SITE_URL || 'https://www.flymaddcreative.online';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const participant = await requireParticipant(req, res);
  if (!participant) return;

  const purpose = req.body?.purpose;
  const itemId = typeof req.body?.item_id === 'string' && /^[0-9a-f-]{36}$/i.test(req.body.item_id) ? req.body.item_id : null;
  const creatorUsername = typeof req.body?.creator_username === 'string' ? req.body.creator_username.trim().replace(/^@/, '').slice(0, 60) : '';
  if (purpose === 'purchase' && !itemId) return res.status(400).json({ error: 'item_id is required' });
  if (purpose === 'subscription' && !creatorUsername) return res.status(400).json({ error: 'creator_username is required' });

  const fallback = itemId ? `${SITE()}/catalogue-product.html?item=${itemId}` : `${SITE()}/app/library`;
  try {
    const result = await startDigitalCheckout({
      participant, purpose, itemId, creatorUsername,
      callbackUrl: resolveCallbackUrl(typeof req.body?.callback_url === 'string' ? req.body.callback_url : '', fallback),
    }, paystackDeps);
    return res.status(result.status).json(result.body);
  } catch (error) {
    console.error('digital/paystack-checkout error:', error.message || error);
    if (error.message === 'paystack_not_configured') return res.status(503).json({ error: 'Card payments are not available right now' });
    if (['42P01', 'PGRST205'].includes(error.code) || /digital_paystack_payments|digital_creator_plans/.test(String(error.message))) {
      return res.status(503).json({ error: 'Website purchases are being set up' });
    }
    return res.status(502).json({ error: 'Could not start the payment. Please try again.' });
  }
}
