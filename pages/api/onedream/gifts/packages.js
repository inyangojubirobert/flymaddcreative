// Public Dream Coin packages: product id + coins per unit. No prices here -
// the app shows the localized price Google Play returns for each product.
// `purchasable` is false for every package while DREAM_COINS_ENABLED is off.

import { dreamCoinsEnabled, giftsDb, publicPackage } from '../../../../lib/dreamCoins';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  try {
    const { data, error } = await giftsDb.from('dream_coin_packages').select('*').eq('is_active', true)
      .order('sort_order', { ascending: true });
    if (error) throw error;
    res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=300');
    return res.status(200).json({ billing_enabled: dreamCoinsEnabled(), packages: (data || []).map(publicPackage) });
  } catch (error) {
    console.error('gifts/packages error:', error);
    return res.status(500).json({ error: 'Could not load coin packages' });
  }
}
