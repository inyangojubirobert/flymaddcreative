// Google Play configuration diagnostics for each Dream Coin package (admin only).
//   GET -> { billing_enabled, packages: [{ id, name, coins_per_unit, reference_price_usd,
//            google_play_product_id, state: not_found | inactive | active | check_failed,
//            play_price, detail }] }
// Reuses the read-only product status check from lib/adsGooglePlay.js.

import { requireActiveAdmin } from '../../../../lib/adminAuth';
import { dreamCoinsEnabled, giftsDb } from '../../../../lib/dreamCoins';
import { getPlayProductStatus } from '../../../../lib/adsGooglePlay';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const admin = await requireActiveAdmin(req, res, giftsDb);
  if (!admin) return;

  try {
    const { data: packages, error } = await giftsDb.from('dream_coin_packages')
      .select('id, name, coins_per_unit, reference_price_usd, google_play_product_id, is_active').order('sort_order');
    if (error) throw error;
    const rows = await Promise.all((packages || []).map(async (pkg) => {
      const status = await getPlayProductStatus(pkg.google_play_product_id);
      return { ...pkg, state: status.state, play_price: status.price, detail: status.detail };
    }));
    return res.status(200).json({ billing_enabled: dreamCoinsEnabled(), packages: rows });
  } catch (error) {
    console.error('admin/gifts/billing-status error:', error);
    return res.status(500).json({ error: 'Could not check Google Play' });
  }
}
