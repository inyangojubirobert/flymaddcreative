// Participant withdrawal requests, balance-checked server-side.
// Replaces public/js/supabase-config.js's requestWithdrawal(), which
// inserted directly into participant_withdrawals from the browser with a
// client-supplied amount_usd - the only balance checks were in
// user-dashboard.html's JavaScript, which were trivially
// bypassable by calling window.SupabaseAPI.requestWithdrawal(...) directly.

import { createClient } from '@supabase/supabase-js';
import { requireParticipant } from '../../../lib/participantAuth';

const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

const REWARD_RATE_USD = 1.00; // must match REWARD_RATE_USD in public/js/supabase-config.js

export default async function handler(req, res) {
  if (req.method === 'GET') {
    return handleGet(req, res);
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const participant = await requireParticipant(req, res);
  if (!participant) return; // response already sent

  const { amount, method, details } = req.body;

  if (!amount || amount <= 0) {
    return res.status(400).json({ error: 'Invalid amount' });
  }
  if (!method || !details) {
    return res.status(400).json({ error: 'Missing payment method or details' });
  }

  try {
    const { data, error } = await supabase.rpc('request_participant_withdrawal', {
      p_participant_id: participant.id,
      p_amount: amount,
      p_method: method,
      p_details: details
    });

    if (error) {
      if (error.message?.includes('insufficient_balance')) {
        return res.status(400).json({ error: 'Amount exceeds your available balance' });
      }
      if (error.message?.includes('participant_not_found')) {
        return res.status(404).json({ error: 'Participant not found' });
      }
      throw error;
    }

    const result = Array.isArray(data) ? data[0] : data;

    return res.status(200).json({
      success: true,
      withdrawal_id: result?.withdrawal_id,
      available_balance: result?.available_balance
    });
  } catch (error) {
    console.error('Withdrawal request error:', error);
    return res.status(500).json({ error: 'Withdrawal request failed' });
  }
}

// Scoped withdrawal history + server-computed balance, for the mobile app's
// Wallet screen. Reuses the exact same formula the request_participant_withdrawal
// RPC enforces server-side (see supabase/fix_participant_withdrawals_schema.sql),
// rather than having a client re-derive calcEarnings/calcTotalWithdrawn in
// TypeScript and risk drifting from what the server actually allows.
async function handleGet(req, res) {
  const participant = await requireParticipant(req, res);
  if (!participant) return; // response already sent

  try {
    const { data: participantRow, error: participantError } = await supabase
      .from('participants')
      .select('total_votes')
      .eq('id', participant.id)
      .single();

    if (participantError || !participantRow) {
      return res.status(404).json({ error: 'Participant not found' });
    }

    const { data: withdrawals, error: withdrawalsError } = await supabase
      .from('participant_withdrawals')
      .select('*')
      .eq('username', participant.username)
      .order('created_at', { ascending: false });

    if (withdrawalsError) {
      console.error('Withdrawals fetch error:', withdrawalsError);
      return res.status(500).json({ error: 'Failed to fetch withdrawals' });
    }

    const earned = (participantRow.total_votes || 0) * REWARD_RATE_USD;
    const withdrawn = (withdrawals || [])
      .filter(w => w.status !== 'rejected')
      .reduce((sum, w) => sum + parseFloat(w.amount_usd || 0), 0);
    const availableBalance = Math.max(0, Math.round((earned - withdrawn) * 100) / 100);

    return res.status(200).json({
      earned,
      withdrawn,
      available_balance: availableBalance,
      withdrawals: withdrawals || []
    });
  } catch (error) {
    console.error('Withdrawal history error:', error);
    return res.status(500).json({ error: 'Failed to fetch withdrawal history' });
  }
}
