// Admin management of recognition programmes and awards (non-cash only -
// reward_programs has a constraint that refuses monetary programmes).
//   POST  { target: 'program', id, name, ... }               create programme
//   PATCH { target: 'program', id, ...fields }               edit / activate
//   POST  { target: 'award', program_id, username, period, title }  award
//   PATCH { target: 'award', id, status: 'revoked' | 'awarded' }    revoke / restore

import { requireActiveAdmin } from '../../../../lib/adminAuth';
import { auditAdmin, giftsDb, participantByUsername } from '../../../../lib/dreamCoins';

function programFieldsFrom(body, creating) {
  const out = {};
  const errors = [];
  const set = (key, value, ok, message) => { if (value === undefined) return; if (!ok) errors.push(message); else out[key] = value; };
  const short = (v, min, max) => typeof v === 'string' && v.trim().length >= min && v.trim().length <= max;

  if (creating) set('id', body.id, /^[a-z0-9_]{2,40}$/.test(body.id || ''), 'id: lowercase letters, digits and _');
  set('name', body.name?.trim?.() ?? body.name, short(body.name, 2, 60), 'name: 2-60 characters');
  set('description', body.description === '' ? null : body.description, body.description === null || body.description === '' || short(body.description, 1, 500), 'description: up to 500 characters');
  set('audience', body.audience?.trim?.() ?? body.audience, short(body.audience, 2, 40), 'audience: 2-40 characters');
  set('criteria', body.criteria, body.criteria && typeof body.criteria === 'object' && !Array.isArray(body.criteria) && JSON.stringify(body.criteria).length <= 2000, 'criteria: an object');
  set('reward_type', body.reward_type?.trim?.() ?? body.reward_type, short(body.reward_type, 2, 40), 'reward_type: 2-40 characters');
  set('reward_label', body.reward_label === '' ? null : body.reward_label, body.reward_label === null || body.reward_label === '' || short(body.reward_label, 1, 60), 'reward_label: up to 60 characters');
  set('is_active', body.is_active, typeof body.is_active === 'boolean', 'is_active: true/false');
  set('sort_order', body.sort_order === undefined ? undefined : Number(body.sort_order), Number.isInteger(Number(body.sort_order)), 'sort_order: whole number');
  if (body.is_monetary) errors.push('Monetary rewards need a separate approval and compliance review - not available here');
  return { out, errors };
}

export default async function handler(req, res) {
  const admin = await requireActiveAdmin(req, res, giftsDb);
  if (!admin) return;
  const body = req.body || {};

  try {
    if (body.target === 'program') {
      if (req.method === 'POST') {
        const { out, errors } = programFieldsFrom(body, true);
        const missing = ['id', 'name'].filter((k) => out[k] === undefined);
        if (errors.length || missing.length) return res.status(400).json({ error: [...errors, ...missing.map((k) => `${k} is required`)].join('; ') });
        const { data, error } = await giftsDb.from('reward_programs').insert(out).select('*').single();
        if (error) return res.status(400).json({ error: error.code === '23505' ? 'A programme with that id already exists' : error.message });
        await auditAdmin(admin.id, 'create_program', 'reward_program', data.id, out);
        return res.status(201).json({ program: data });
      }
      if (req.method === 'PATCH') {
        const { out, errors } = programFieldsFrom({ ...body, id: undefined }, false);
        if (errors.length) return res.status(400).json({ error: errors.join('; ') });
        const { data, error } = await giftsDb.from('reward_programs').update({ ...out, updated_at: new Date().toISOString() }).eq('id', String(body.id || '')).select('*').maybeSingle();
        if (error) return res.status(400).json({ error: error.message });
        if (!data) return res.status(404).json({ error: 'Programme not found' });
        await auditAdmin(admin.id, 'edit_program', 'reward_program', data.id, out);
        return res.status(200).json({ program: data });
      }
    }

    if (body.target === 'award') {
      if (req.method === 'POST') {
        const participant = await participantByUsername(String(body.username || '').trim().replace(/^@/, ''));
        if (!participant) return res.status(404).json({ error: 'Participant not found' });
        const period = String(body.period || new Date().toISOString().slice(0, 7));
        const title = String(body.title || '').trim();
        if (!/^[0-9A-Za-z_-]{1,20}$/.test(period) || title.length < 2 || title.length > 80) return res.status(400).json({ error: 'period and a 2-80 character title are required' });
        const { data, error } = await giftsDb.from('reward_awards').insert({
          program_id: String(body.program_id || ''), participant_id: participant.id, period, title,
          details: { note: String(body.note || '').slice(0, 300) }, awarded_by: admin.id,
        }).select('*').single();
        if (error) return res.status(400).json({ error: error.code === '23505' ? 'Already awarded for this period' : error.message });
        await auditAdmin(admin.id, 'grant_award', 'reward_award', data.id, { program_id: data.program_id, username: participant.username, period, title });
        return res.status(201).json({ award: data });
      }
      if (req.method === 'PATCH') {
        const status = body.status === 'awarded' ? 'awarded' : 'revoked';
        const { data, error } = await giftsDb.from('reward_awards').update({ status, updated_at: new Date().toISOString() }).eq('id', String(body.id || '')).select('*').maybeSingle();
        if (error) return res.status(400).json({ error: error.message });
        if (!data) return res.status(404).json({ error: 'Award not found' });
        await auditAdmin(admin.id, status === 'revoked' ? 'revoke_award' : 'restore_award', 'reward_award', data.id, { note: String(body.note || '').slice(0, 300) });
        return res.status(200).json({ award: data });
      }
    }

    return res.status(400).json({ error: 'target must be program or award' });
  } catch (error) {
    console.error('admin/gifts/rewards error:', error);
    return res.status(500).json({ error: 'Update failed' });
  }
}
