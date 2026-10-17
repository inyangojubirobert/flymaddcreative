// Checkout quote: the exact amount, currency and payment route for a cart or
// a single listing, with the exchange rate fixed until the quote expires.
//   POST { lines: [{ item_id, quantity }], client_key } -> { quote }
// One quote is one currency. A cart mixing naira listings with listings in
// other currencies is refused with the groups to check out separately.
// Prices are read from the listings on the server. The quote is stored; the
// protected checkout routes start charging from it once P7 is applied.

import { createQuote, quoteErrorReply } from '../../../lib/marketplaceCurrency';
import { normalizeCartLines } from '../../../lib/catalogueCart';
import { publicQuote } from '../../../lib/quoteCheckout';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const normalized = normalizeCartLines(req.body?.lines);
  if (normalized.error) return res.status(400).json({ error: normalized.error });
  const clientKey = String(req.body?.client_key || '');
  if (!/^[A-Za-z0-9_-]{8,80}$/.test(clientKey)) return res.status(400).json({ error: 'client_key is required' });
  try {
    const { quote, reused } = await createQuote({ lines: normalized.lines, clientKey });
    return res.status(200).json({ quote: publicQuote(quote), reused });
  } catch (error) {
    const reply = quoteErrorReply(error);
    if (reply) return res.status(reply.status).json(reply.body);
    console.error('marketplace/quote error:', error);
    return res.status(500).json({ error: 'Could not price this checkout' });
  }
}
