// Google Play configuration diagnostics for each package (admin only).
// For every package: is a product id entered, does that product exist and is
// it active in Play Console, and does its USD price match the package price?
//   GET -> { paused, packages: [{ id, name, price_usd, google_play_product_id,
//            state: unconfigured | not_found | inactive | active | check_failed,
//            play_price, price_matches, detail }] }
// "active" here means Google has the product; the app still confirms the
// product loads on the buyer's device before enabling "Buy".

import { requireActiveAdmin } from '../../../../lib/adminAuth';
import { adsDb } from '../../../../lib/ads';
import { getPlayProductStatus, promotionalBillingPaused } from '../../../../lib/adsGooglePlay';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const admin = await requireActiveAdmin(req, res, adsDb);
  if (!admin) return;

  try {
    const { data: packages, error } = await adsDb.from('advertising_packages').select('id, name, price_usd, google_play_product_id, is_active').order('sort_order');
    if (error) throw error;
    const rows = await Promise.all((packages || []).map(async (pkg) => {
      const productId = String(pkg.google_play_product_id || '').trim();
      if (!productId) return { ...pkg, state: 'unconfigured', play_price: null, price_matches: null, detail: 'No product id entered' };
      const status = await getPlayProductStatus(productId);
      const priceMatches = status.price?.currency === 'USD' ? Math.abs(status.price.amount - Number(pkg.price_usd)) < 0.01 : null;
      return { ...pkg, state: status.state, play_price: status.price, price_matches: priceMatches, detail: status.detail };
    }));
    return res.status(200).json({ paused: promotionalBillingPaused(), packages: rows });
  } catch (error) {
    console.error('admin/ads/billing-status error:', error);
    return res.status(500).json({ error: 'Could not check Google Play' });
  }
}
