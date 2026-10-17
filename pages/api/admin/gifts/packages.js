// Admin management of Dream Coin packages.
//   POST  { id, google_play_product_id, name, coins_per_unit, ... }  create
//   PATCH { id, ...fields }                                          edit / activate / deactivate
// Purchases keep the coins_per_unit they were credited with, so edits only
// affect future purchases. Buyers always pay Google Play's price for the
// product id; reference_price_usd is for planning only.

import { requireActiveAdmin } from '../../../../lib/adminAuth';
import { auditAdmin, giftsDb } from '../../../../lib/dreamCoins';

function fieldsFrom(body, creating) {
  const out = {};
  const errors = [];
  const set = (key, value, ok, message) => { if (value === undefined) return; if (!ok) errors.push(message); else out[key] = value; };

  if (creating) {
    set('id', body.id, /^[a-z0-9_]{2,60}$/.test(body.id || ''), 'id: lowercase letters, digits and _');
    set('google_play_product_id', body.google_play_product_id, /^[a-z0-9][a-z0-9._]{0,138}$/.test(body.google_play_product_id || ''),
      'google_play_product_id: must match the Play Console product ID exactly');
  }
  set('name', typeof body.name === 'string' ? body.name.trim() : body.name, typeof body.name === 'string' && body.name.trim().length >= 2 && body.name.trim().length <= 40, 'name: 2-40 characters');
  set('coins_per_unit', body.coins_per_unit === undefined ? undefined : Number(body.coins_per_unit),
    Number.isInteger(Number(body.coins_per_unit)) && Number(body.coins_per_unit) >= 1 && Number(body.coins_per_unit) <= 1000000, 'coins_per_unit: whole number 1 - 1,000,000');
  set('reference_price_usd', body.reference_price_usd === '' || body.reference_price_usd === null ? null : body.reference_price_usd === undefined ? undefined : Math.round(Number(body.reference_price_usd) * 100) / 100,
    body.reference_price_usd === '' || body.reference_price_usd === null || Number(body.reference_price_usd) > 0, 'reference_price_usd: positive');
  set('highlight', body.highlight === '' ? null : body.highlight, body.highlight === null || body.highlight === '' || (typeof body.highlight === 'string' && body.highlight.length <= 20), 'highlight: up to 20 characters');
  set('is_active', body.is_active, typeof body.is_active === 'boolean', 'is_active: true/false');
  set('sort_order', body.sort_order === undefined ? undefined : Number(body.sort_order), Number.isInteger(Number(body.sort_order)), 'sort_order: whole number');
  return { out, errors };
}

export default async function handler(req, res) {
  const admin = await requireActiveAdmin(req, res, giftsDb);
  if (!admin) return;
  try {
    if (req.method === 'POST') {
      const { out, errors } = fieldsFrom(req.body || {}, true);
      const missing = ['id', 'google_play_product_id', 'name', 'coins_per_unit'].filter((k) => out[k] === undefined);
      if (errors.length || missing.length) return res.status(400).json({ error: [...errors, ...missing.map((k) => `${k} is required`)].join('; ') });
      const { data, error } = await giftsDb.from('dream_coin_packages').insert(out).select('*').single();
      if (error) return res.status(400).json({ error: error.code === '23505' ? 'A package with that id or product id already exists' : error.message });
      await auditAdmin(admin.id, 'create_coin_package', 'coin_package', data.id, out);
      return res.status(201).json({ package: data });
    }
    if (req.method === 'PATCH') {
      const id = String(req.body?.id || '');
      const { out, errors } = fieldsFrom({ ...(req.body || {}), id: undefined, google_play_product_id: undefined }, false);
      if (errors.length) return res.status(400).json({ error: errors.join('; ') });
      const { data, error } = await giftsDb.from('dream_coin_packages').update({ ...out, updated_at: new Date().toISOString() }).eq('id', id).select('*').maybeSingle();
      if (error) return res.status(400).json({ error: error.message });
      if (!data) return res.status(404).json({ error: 'Package not found' });
      await auditAdmin(admin.id, 'edit_coin_package', 'coin_package', id, out);
      return res.status(200).json({ package: data });
    }
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (error) {
    console.error('admin/gifts/packages error:', error);
    return res.status(500).json({ error: 'Package update failed' });
  }
}
