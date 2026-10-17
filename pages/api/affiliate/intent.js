// Records an attribution intent for a payment, sent by the buyer's device
// BEFORE paying (Paystack: as soon as the payment reference exists) or with
// the USDT transaction hash. A server job later matches it to the verified
// order (affiliate_match_intents), so a buyer closing the app after paying
// doesn't lose the partner's commission.
//   POST { payment_ref, method: 'paystack' | 'usdt', buyer_email?, tokens: [string] }
// Never blocks or changes checkout: the client fires this and moves on.

import { recordIntentFromTokens } from '../../../lib/earnings';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const ref = String(req.body?.payment_ref || '').trim();
  const method = req.body?.method === 'usdt' ? 'usdt' : 'paystack';
  const tokens = Array.isArray(req.body?.tokens) ? req.body.tokens.slice(0, 20) : [];
  if (!/^[A-Za-z0-9_.:-]{6,140}$/.test(ref) || !tokens.length) return res.status(400).json({ error: 'payment_ref and tokens are required' });
  const email = String(req.body?.buyer_email || '').trim();
  if (method === 'usdt' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'buyer_email is required for USDT' });

  try {
    return res.status(200).json(await recordIntentFromTokens({ paymentRef: ref, method, buyerEmail: email || null, tokens }));
  } catch (error) {
    console.error('affiliate/intent error:', error);
    return res.status(500).json({ error: 'Could not record attribution' });
  }
}
