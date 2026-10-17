// Admin management of virtual gifts - no app release needed.
//   POST  { id, name, coin_cost, ... }  create
//   PATCH { id, ...fields }             edit, price, activate / deactivate
// Gifts already sent keep the snapshot they were sent with.

import { requireActiveAdmin } from '../../../../lib/adminAuth';
import { auditAdmin, giftsDb } from '../../../../lib/dreamCoins';

function fieldsFrom(body, creating) {
  const out = {};
  const errors = [];
  const set = (key, value, ok, message) => { if (value === undefined) return; if (!ok) errors.push(message); else out[key] = value; };
  const text = (v, max) => (v === null || v === '' ? null : typeof v === 'string' ? v.trim().slice(0, max) : v);
  const url = (v) => v === null || v === '' || (typeof v === 'string' && /^https:\/\/\S+$/.test(v.trim()));

  if (creating) set('id', body.id, /^[a-z0-9_]{2,40}$/.test(body.id || ''), 'id: lowercase letters, digits and _');
  set('name', typeof body.name === 'string' ? body.name.trim() : body.name, typeof body.name === 'string' && body.name.trim().length >= 2 && body.name.trim().length <= 40, 'name: 2-40 characters');
  set('description', text(body.description, 200), body.description === null || typeof body.description === 'string', 'description: text');
  set('emoji', text(body.emoji, 8), body.emoji === null || typeof body.emoji === 'string', 'emoji: text');
  set('image_url', text(body.image_url, 500), url(body.image_url), 'image_url: an https:// link');
  set('animation_url', text(body.animation_url, 500), url(body.animation_url), 'animation_url: an https:// link');
  set('coin_cost', body.coin_cost === undefined ? undefined : Number(body.coin_cost), Number.isInteger(Number(body.coin_cost)) && Number(body.coin_cost) >= 1 && Number(body.coin_cost) <= 1000000, 'coin_cost: whole number 1 - 1,000,000');
  set('category', typeof body.category === 'string' ? body.category.trim() : body.category, typeof body.category === 'string' && body.category.trim().length >= 2 && body.category.trim().length <= 40, 'category: 2-40 characters');
  set('is_active', body.is_active, typeof body.is_active === 'boolean', 'is_active: true/false');
  set('display_priority', body.display_priority === undefined ? undefined : Number(body.display_priority), Number.isInteger(Number(body.display_priority)), 'display_priority: whole number');
  return { out, errors };
}

export default async function handler(req, res) {
  const admin = await requireActiveAdmin(req, res, giftsDb);
  if (!admin) return;
  try {
    if (req.method === 'POST') {
      const { out, errors } = fieldsFrom(req.body || {}, true);
      const missing = ['id', 'name', 'coin_cost'].filter((k) => out[k] === undefined);
      if (errors.length || missing.length) return res.status(400).json({ error: [...errors, ...missing.map((k) => `${k} is required`)].join('; ') });
      const { data, error } = await giftsDb.from('virtual_gift_catalogue').insert(out).select('*').single();
      if (error) return res.status(400).json({ error: error.code === '23505' ? 'A gift with that id already exists' : error.message });
      await auditAdmin(admin.id, 'create_gift', 'gift_catalogue', data.id, out);
      return res.status(201).json({ gift: data });
    }
    if (req.method === 'PATCH') {
      const id = String(req.body?.id || '');
      const { out, errors } = fieldsFrom({ ...(req.body || {}), id: undefined }, false);
      if (errors.length) return res.status(400).json({ error: errors.join('; ') });
      const { data, error } = await giftsDb.from('virtual_gift_catalogue').update({ ...out, updated_at: new Date().toISOString() }).eq('id', id).select('*').maybeSingle();
      if (error) return res.status(400).json({ error: error.message });
      if (!data) return res.status(404).json({ error: 'Gift not found' });
      await auditAdmin(admin.id, 'edit_gift', 'gift_catalogue', id, out);
      return res.status(200).json({ gift: data });
    }
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (error) {
    console.error('admin/gifts/catalogue error:', error);
    return res.status(500).json({ error: 'Gift update failed' });
  }
}
