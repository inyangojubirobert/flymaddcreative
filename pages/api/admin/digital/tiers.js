// Admin: Google Play price tiers for digital products.
//   GET               -> tiers with live Play Console status (exists / active / price)
//   PATCH { id, google_play_product_id?, is_active? } -> replace a placeholder id, enable/disable a tier
// Prices are fixed per tier (the tier id encodes it); add a tier for a new price point.

import { requireActiveAdmin } from '../../../../lib/adminAuth';
import { digitalDb } from '../../../../lib/digital';
import { getPlayProductStatus } from '../../../../lib/adsGooglePlay';

export default async function handler(req, res) {
  const admin = await requireActiveAdmin(req, res, digitalDb);
  if (!admin) return;
  try {
    if (req.method === 'GET') {
      const { data, error } = await digitalDb.from('digital_price_tiers').select('*').order('price_usd');
      if (error) throw error;
      const rows = await Promise.all((data || []).map(async (tier) => {
        if (!tier.google_play_product_id) return { ...tier, state: 'unconfigured' };
        const status = await getPlayProductStatus(tier.google_play_product_id);
        return {
          ...tier,
          state: status.state,
          play_price: status.price,
          price_matches: status.price?.currency === 'USD' ? Math.round(status.price.amount * 100) === Math.round(Number(tier.price_usd) * 100) : null,
          detail: status.detail,
        };
      }));
      return res.status(200).json({ tiers: rows });
    }
    if (req.method === 'PATCH') {
      const update = {};
      if (req.body?.google_play_product_id !== undefined) {
        const value = String(req.body.google_play_product_id || '').trim();
        if (value && !/^[a-z0-9][a-z0-9._]{0,138}$/.test(value)) return res.status(400).json({ error: 'Product id must match Play Console (lowercase letters, digits, . and _)' });
        update.google_play_product_id = value || null;
      }
      if (typeof req.body?.is_active === 'boolean') update.is_active = req.body.is_active;
      const { data, error } = await digitalDb.from('digital_price_tiers').update(update).eq('id', String(req.body?.id || '')).select('*').maybeSingle();
      if (error) return res.status(400).json({ error: error.code === '23505' ? 'That product id is already used by another tier' : error.message });
      if (!data) return res.status(404).json({ error: 'Tier not found' });
      return res.status(200).json({ tier: data });
    }
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (error) {
    console.error('admin/digital/tiers error:', error);
    return res.status(500).json({ error: 'Tier request failed' });
  }
}
