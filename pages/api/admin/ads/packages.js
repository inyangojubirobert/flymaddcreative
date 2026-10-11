// Admin management of advertising / boost packages (no code changes needed).
//   POST  { id, kind, name, ... }  create
//   PATCH { id, ...fields }        edit, activate/retire, set google_play_product_id
// Purchases keep the terms they were bought under (entitlement snapshot), so
// edits only affect future purchases. Remember: Google Play charges the price
// set in Play Console - keep it in line with price_usd.

import { requireActiveAdmin } from '../../../../lib/adminAuth';
import { adsDb } from '../../../../lib/ads';

const PLACEMENTS = ['home', 'shop', 'search', 'category'];

function fieldsFrom(body, creating) {
  const out = {};
  const errors = [];
  const set = (key, value, ok, message) => { if (value === undefined) return; if (!ok) errors.push(message); else out[key] = value; };

  if (creating) set('id', body.id, /^[a-z0-9_]{2,40}$/.test(body.id || ''), 'id: lowercase letters, digits and _');
  set('kind', body.kind, ['ad', 'boost'].includes(body.kind), 'kind: ad or boost');
  set('name', typeof body.name === 'string' ? body.name.trim() : body.name, typeof body.name === 'string' && body.name.trim().length >= 2 && body.name.trim().length <= 60, 'name: 2-60 characters');
  set('tagline', body.tagline === null ? null : typeof body.tagline === 'string' ? body.tagline.trim().slice(0, 120) : body.tagline, body.tagline === null || typeof body.tagline === 'string', 'tagline: text');
  set('price_usd', body.price_usd === undefined ? undefined : Math.round(Number(body.price_usd) * 100) / 100, Number(body.price_usd) > 0 && Number(body.price_usd) <= 10000, 'price_usd: 0.01 - 10000');
  set('duration_hours', body.duration_hours === undefined ? undefined : Number(body.duration_hours), Number.isInteger(Number(body.duration_hours)) && Number(body.duration_hours) >= 1 && Number(body.duration_hours) <= 8760, 'duration_hours: 1 - 8760');
  set('max_creatives', body.max_creatives === undefined ? undefined : Number(body.max_creatives), Number.isInteger(Number(body.max_creatives)) && Number(body.max_creatives) >= 0 && Number(body.max_creatives) <= 10, 'max_creatives: 0 - 10');
  set('priority', body.priority === undefined ? undefined : Number(body.priority), Number.isInteger(Number(body.priority)) && Number(body.priority) >= 1 && Number(body.priority) <= 100, 'priority: 1 - 100');
  set('placements', body.placements, Array.isArray(body.placements) && body.placements.length > 0 && body.placements.every((p) => PLACEMENTS.includes(p)), `placements: any of ${PLACEMENTS.join(', ')}`);
  set('allow_external_link', body.allow_external_link, typeof body.allow_external_link === 'boolean', 'allow_external_link: true/false');
  set('benefits', body.benefits, Array.isArray(body.benefits) && body.benefits.every((b) => typeof b === 'string' && b.length <= 120), 'benefits: list of short texts');
  set('highlight', body.highlight === '' ? null : body.highlight, body.highlight === null || body.highlight === '' || (typeof body.highlight === 'string' && body.highlight.length <= 20), 'highlight: up to 20 characters');
  set('google_play_product_id', body.google_play_product_id === '' ? null : body.google_play_product_id,
    body.google_play_product_id === null || body.google_play_product_id === '' || /^[a-z0-9][a-z0-9._]{0,138}$/.test(body.google_play_product_id || ''),
    'google_play_product_id: must match the Play Console product ID exactly (lowercase letters, digits, . and _)');
  set('is_active', body.is_active, typeof body.is_active === 'boolean', 'is_active: true/false');
  set('sort_order', body.sort_order === undefined ? undefined : Number(body.sort_order), Number.isInteger(Number(body.sort_order)), 'sort_order: whole number');
  return { out, errors };
}

export default async function handler(req, res) {
  const admin = await requireActiveAdmin(req, res, adsDb);
  if (!admin) return;
  try {
    if (req.method === 'POST') {
      const { out, errors } = fieldsFrom(req.body || {}, true);
      const missing = ['id', 'kind', 'name', 'price_usd', 'duration_hours', 'placements'].filter((k) => out[k] === undefined);
      if (errors.length || missing.length) return res.status(400).json({ error: [...errors, ...missing.map((k) => `${k} is required`)].join('; ') });
      const { data, error } = await adsDb.from('advertising_packages').insert(out).select('*').single();
      if (error) return res.status(400).json({ error: error.code === '23505' ? 'A package with that id or product id already exists' : error.message });
      return res.status(201).json({ package: data });
    }
    if (req.method === 'PATCH') {
      const id = String(req.body?.id || '');
      const { out, errors } = fieldsFrom({ ...(req.body || {}), id: undefined }, false);
      if (errors.length) return res.status(400).json({ error: errors.join('; ') });
      const { data, error } = await adsDb.from('advertising_packages').update({ ...out, updated_at: new Date().toISOString() }).eq('id', id).select('*').maybeSingle();
      if (error) return res.status(400).json({ error: error.code === '23505' ? 'That Google Play product id is already used by another package' : error.message });
      if (!data) return res.status(404).json({ error: 'Package not found' });
      return res.status(200).json({ package: data });
    }
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (error) {
    console.error('admin/ads/packages error:', error);
    return res.status(500).json({ error: 'Package update failed' });
  }
}
