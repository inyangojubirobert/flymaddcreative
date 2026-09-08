import { createClient } from '@supabase/supabase-js';
import { requireActiveAdmin } from '../../../lib/adminAuth';

const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

function cleanMessage(value) {
  return typeof value === 'string' ? value.trim().slice(0, 2000) : '';
}

export default async function handler(req, res) {
  const admin = await requireActiveAdmin(req, res, supabase);
  if (!admin) return;

  if (req.method === 'GET') {
    const participantId = String(req.query.participant_id || '');

    // No participant_id: return the full inbox so admins see every participant
    // who has messaged, not only ones tied to a withdrawal request.
    if (!participantId) {
      try {
        const { data: messages, error } = await supabase
          .from('support_messages')
          .select('id, participant_id, withdrawal_id, sender_type, message_type, body, read_at, created_at')
          .order('created_at', { ascending: false })
          .limit(300);
        if (error) throw error;

        const participantIds = [...new Set((messages || []).map(m => m.participant_id).filter(Boolean))];
        let participantsById = new Map();
        if (participantIds.length) {
          const { data: participants, error: participantsError } = await supabase
            .from('participants')
            .select('id, name, username, email')
            .in('id', participantIds);
          if (participantsError) throw participantsError;
          participantsById = new Map((participants || []).map(row => [row.id, row]));
        }

        const enriched = (messages || []).map(m => ({ ...m, participants: participantsById.get(m.participant_id) || null }));
        return res.status(200).json({ messages: enriched });
      } catch (error) {
        console.error('Admin inbox fetch error:', error);
        return res.status(500).json({ error: 'Unable to load messages' });
      }
    }

    try {
      const [{ data: participant, error: participantError }, { data: messages, error: messagesError }] = await Promise.all([
        supabase.from('participants').select('id, name, username, email').eq('id', participantId).maybeSingle(),
        supabase
          .from('support_messages')
          .select('id, withdrawal_id, sender_type, message_type, body, read_at, created_at')
          .eq('participant_id', participantId)
          .order('created_at', { ascending: true })
      ]);
      if (participantError) throw participantError;
      if (messagesError) throw messagesError;
      if (!participant) return res.status(404).json({ error: 'Participant not found' });

      await supabase
        .from('support_messages')
        .update({ read_at: new Date().toISOString() })
        .eq('participant_id', participantId)
        .eq('sender_type', 'participant')
        .is('read_at', null);

      return res.status(200).json({ participant, messages: messages || [] });
    } catch (error) {
      console.error('Admin messages fetch error:', error);
      return res.status(500).json({ error: 'Unable to load messages' });
    }
  }

  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const participantId = String(req.body?.participant_id || '');
  const withdrawalId = req.body?.withdrawal_id ? String(req.body.withdrawal_id) : null;
  const body = cleanMessage(req.body?.body);
  const messageType = req.body?.message_type === 'payout_notification' ? 'payout_notification' : 'general';
  if (!participantId || !body) return res.status(400).json({ error: 'participant_id and message are required' });

  try {
    const { data: participant, error: participantError } = await supabase
      .from('participants')
      .select('id, username')
      .eq('id', participantId)
      .maybeSingle();
    if (participantError) throw participantError;
    if (!participant) return res.status(404).json({ error: 'Participant not found' });

    if (withdrawalId) {
      const { data: withdrawal, error: withdrawalError } = await supabase
        .from('participant_withdrawals')
        .select('id')
        .eq('id', withdrawalId)
        .eq('username', participant.username)
        .maybeSingle();
      if (withdrawalError) throw withdrawalError;
      if (!withdrawal) return res.status(400).json({ error: 'Withdrawal does not belong to this participant' });
    }

    const { data, error } = await supabase
      .from('support_messages')
      .insert({
        participant_id: participantId,
        admin_id: admin.id,
        withdrawal_id: withdrawalId,
        sender_type: 'admin',
        message_type: messageType,
        body
      })
      .select('id, withdrawal_id, sender_type, message_type, body, read_at, created_at')
      .single();
    if (error) throw error;
    return res.status(201).json({ success: true, message: data });
  } catch (error) {
    console.error('Admin message send error:', error);
    return res.status(500).json({ error: 'Unable to send message' });
  }
}
