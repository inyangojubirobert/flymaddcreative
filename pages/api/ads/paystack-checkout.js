// Website (web app) checkout for an advertising or boost package: Paystack,
// NGN at the live USD rate. Google Play stays the only way to pay in the
// Android app. Rules: lib/adsPaystack.js.
//   POST { package_id, callback_url? } -> { authorization_url, reference, amount_ngn, price_usd }
// After paying, the buyer returns to callback_url?reference=... and the page
// calls POST /api/ads/paystack-verify. The daily ads job confirms any checkout
// the buyer did not return from.

import { requireParticipant } from '../../../lib/participantAuth';
import { adPaystackDeps, startAdCheckout } from '../../../lib/adsPaystack';
import { resolveCallbackUrl } from '../../../lib/paystackCallbackUrl';

const SITE = () => process.env.NEXT_PUBLIC_SITE_URL || 'https://www.flymaddcreative.online';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const participant = await requireParticipant(req, res);
  if (!participant) return;

  const packageId = typeof req.body?.package_id === 'string' && /^[a-z0-9_]{2,40}$/.test(req.body.package_id) ? req.body.package_id : null;
  if (!packageId) return res.status(400).json({ error: 'package_id is required' });

  try {
    const result = await startAdCheckout({
      participant,
      packageId,
      callbackUrl: resolveCallbackUrl(typeof req.body?.callback_url === 'string' ? req.body.callback_url : '', `${SITE()}/app/promote`),
    }, adPaystackDeps);
    return res.status(result.status).json(result.body);
  } catch (error) {
    console.error('ads/paystack-checkout error:', error.message || error);
    if (error.message === 'paystack_not_configured') return res.status(503).json({ error: 'Card payments are not available right now' });
    if (['42P01', 'PGRST205'].includes(error.code) || /ad_paystack_payments/.test(String(error.message))) {
      return res.status(503).json({ error: 'Card payments for packages are being set up' });
    }
    return res.status(502).json({ error: 'Could not start the payment. Please try again.' });
  }
}
