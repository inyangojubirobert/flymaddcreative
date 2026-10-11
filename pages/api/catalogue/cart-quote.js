// Prices a cart for the checkout page: live listing prices, buyer service
// charge, total in USD and the NGN amount Paystack would charge. Read-only -
// no payment is created here. Public, like the catalogue reads.

import { createClient } from '@supabase/supabase-js';
import { getUsdToNgnRate } from '../../../lib/currency';
import { cartCheckoutReady, normalizeCartLines, priceCart } from '../../../lib/catalogueCart';

const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const normalized = normalizeCartLines(req.body?.lines);
    if (normalized.error) return res.status(400).json({ error: normalized.error });

    const rate = await getUsdToNgnRate();
    const [quote, ready] = await Promise.all([
      priceCart(supabase, normalized.lines, rate),
      cartCheckoutReady(supabase),
    ]);
    return res.status(200).json({ ...quote, checkout_enabled: ready });
  } catch (error) {
    console.error('catalogue/cart-quote error:', error);
    return res.status(500).json({ error: 'Failed to price cart' });
  }
}
