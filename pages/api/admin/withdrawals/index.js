import { createClient } from '@supabase/supabase-js';
import { requireActiveAdmin } from '../../../../lib/adminAuth';

const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

const VALID_STATUSES = new Set(['pending', 'processing', 'claimed', 'rejected', 'paid', 'all']);

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const admin = await requireActiveAdmin(req, res, supabase);
  if (!admin) return;

  const requestedStatus = String(req.query.status || 'all').toLowerCase();
  if (!VALID_STATUSES.has(requestedStatus)) {
    return res.status(400).json({ error: 'Invalid withdrawal status filter' });
  }

  const parsedLimit = Number.parseInt(String(req.query.limit || '100'), 10);
  const limit = Number.isFinite(parsedLimit) ? Math.min(Math.max(parsedLimit, 1), 250) : 100;

  try {
    let query = supabase
      .from('participant_withdrawals')
      .select([
        'id', 'username', 'amount_usd', 'payment_method', 'payment_details', 'status', 'created_at',
        'payout_type', 'payout_currency', 'payout_network', 'payout_reference', 'payout_amount',
        'payout_confirmed_at', 'claimed_at', 'claimed_by', 'admin_note'
      ].join(','))
      .order('created_at', { ascending: false })
      .limit(limit);

    if (requestedStatus !== 'all') query = query.eq('status', requestedStatus);

    const { data: withdrawals, error: withdrawalsError } = await query;
    if (withdrawalsError) throw withdrawalsError;

    const usernames = [...new Set((withdrawals || []).map(row => row.username).filter(Boolean))];
    let participantsByUsername = new Map();
    if (usernames.length) {
      const { data: participants, error: participantsError } = await supabase
        .from('participants')
        .select('id, name, username, email')
        .in('username', usernames);
      if (participantsError) throw participantsError;
      participantsByUsername = new Map((participants || []).map(row => [row.username, row]));
    }

    const rows = (withdrawals || []).map(withdrawal => ({
      ...withdrawal,
      participant: participantsByUsername.get(withdrawal.username) || null
    }));
    const summary = rows.reduce((totals, row) => {
      totals[row.status] = (totals[row.status] || 0) + 1;
      return totals;
    }, {});

    return res.status(200).json({ admin, withdrawals: rows, summary });
  } catch (error) {
    console.error('Admin withdrawals list error:', error);
    return res.status(500).json({ error: 'Unable to load withdrawal requests' });
  }
}
