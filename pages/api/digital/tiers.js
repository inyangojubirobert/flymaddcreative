// Active Google Play price tiers and creator-subscription products (public).
// The app uses this to recognise and finish interrupted digital purchases.
//   GET

import { digitalDb } from '../../../lib/digital';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  try {
    const { data, error } = await digitalDb.from('digital_price_tiers').select('id, price_usd, google_play_product_id').eq('is_active', true).order('price_usd');
    if (error) throw error;
    // Phase 2 table; absent on an older database.
    const subs = await digitalDb.from('digital_sub_products').select('google_play_product_id').not('google_play_product_id', 'is', null);
    res.setHeader('Cache-Control', 'public, s-maxage=300');
    return res.status(200).json({
      tiers: (data || []).filter((t) => t.google_play_product_id).map((t) => ({ ...t, price_usd: Number(t.price_usd) })),
      subscription_products: subs.error ? [] : (subs.data || []).map((p) => p.google_play_product_id),
    });
  } catch (error) {
    console.error('digital/tiers error:', error);
    return res.status(500).json({ error: 'Could not load tiers' });
  }
}
