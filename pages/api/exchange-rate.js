// Exposes the live USD -> NGN rate to browser code (catalogue-product.html,
// paystack-payments.js) without those pages calling open.er-api.com directly.
// Keeps the rate cached/consistent with what the server used to build the
// Paystack charge (see lib/currency.js).

import { getUsdToNgnRate } from '../../lib/currency';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const rate = await getUsdToNgnRate();
    res.setHeader('Cache-Control', 'public, max-age=300, stale-while-revalidate=1800');
    return res.status(200).json({
      base: 'USD',
      target: 'NGN',
      rate,
      source: 'open.er-api.com',
      fetched_at: new Date().toISOString()
    });
  } catch (error) {
    console.error('[exchange-rate] error:', error);
    return res.status(500).json({ error: 'Failed to fetch exchange rate' });
  }
}
