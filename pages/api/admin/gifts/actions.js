// Admin interventions on Dream Coins & gifts. Every action is written to
// dream_gifting_admin_audit (inside the SQL function, same transaction).
//   POST { action: 'reverse_gift', gift_transaction_id, reason }
//   POST { action: 'suspend' | 'restore', username, reason }
//   POST { action: 'adjust_coins', username, coins, reason, request_key }
// Only the isolated gifting ledger changes - never marketplace, vote or
// withdrawal balances.

import crypto from 'crypto';
import { requireActiveAdmin } from '../../../../lib/adminAuth';
import { giftsDb, participantByUsername } from '../../../../lib/dreamCoins';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const admin = await requireActiveAdmin(req, res, giftsDb);
  if (!admin) return;

  const action = String(req.body?.action || '');
  const reason = String(req.body?.reason || '').trim().slice(0, 500);
  if (reason.length < 3) return res.status(400).json({ error: 'A reason is required' });

  try {
    if (action === 'reverse_gift') {
      const id = String(req.body?.gift_transaction_id || '');
      if (!/^[0-9a-f-]{36}$/i.test(id)) return res.status(400).json({ error: 'gift_transaction_id is required' });
      const { data, error } = await giftsDb.rpc('virtual_gift_reverse', { p_gift_transaction_id: id, p_admin_id: admin.id, p_reason: reason });
      if (error) return res.status(String(error.message).includes('gift_not_found') ? 404 : 500).json({ error: error.message });
      return res.status(200).json({ success: true, ...data });
    }

    const participant = await participantByUsername(String(req.body?.username || '').trim().replace(/^@/, ''));
    if (!participant) return res.status(404).json({ error: 'Participant not found' });

    if (action === 'suspend' || action === 'restore') {
      const { error } = await giftsDb.rpc('dream_coins_set_suspension', {
        p_participant_id: participant.id, p_suspended: action === 'suspend', p_reason: reason, p_admin_id: admin.id,
      });
      if (error) throw error;
      return res.status(200).json({ success: true });
    }

    if (action === 'adjust_coins') {
      const coins = Number(req.body?.coins);
      if (!Number.isInteger(coins) || coins === 0 || Math.abs(coins) > 1000000) return res.status(400).json({ error: 'coins: non-zero whole number' });
      const requestKey = /^[A-Za-z0-9_-]{8,80}$/.test(req.body?.request_key || '') ? req.body.request_key : crypto.randomUUID();
      const { data, error } = await giftsDb.rpc('dream_coins_admin_adjust', {
        p_participant_id: participant.id, p_coins: coins, p_reason: reason, p_admin_id: admin.id, p_request_key: requestKey,
      });
      if (error) throw error;
      return res.status(200).json({ success: true, ...data });
    }

    return res.status(400).json({ error: 'Unknown action' });
  } catch (error) {
    console.error('admin/gifts/actions error:', error);
    return res.status(500).json({ error: 'Action failed' });
  }
}
