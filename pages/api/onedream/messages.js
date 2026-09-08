import { createClient } from '@supabase/supabase-js';
import { requireParticipant } from '../../../lib/participantAuth';

const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

function cleanMessage(value) {
  return typeof value === 'string' ? value.trim().slice(0, 2000) : '';
}

export default async function handler(req, res) {
  const participant = await requireParticipant(req, res);
  if (!participant) return;

  if (req.method === 'GET') {
    try {
      const { data, error } = await supabase
        .from('support_messages')
        .select('id, withdrawal_id, sender_type, message_type, body, read_at, created_at')
        .eq('participant_id', participant.id)
        .order('created_at', { ascending: true });
      if (error) throw error;

      // A message is considered read when the participant opens this thread.
      await supabase
        .from('support_messages')
        .update({ read_at: new Date().toISOString() })
        .eq('participant_id', participant.id)
        .in('sender_type', ['admin', 'system'])
        .is('read_at', null);

      return res.status(200).json({ messages: data || [] });
    } catch (error) {
      console.error('Participant messages fetch error:', error);
      return res.status(500).json({ error: 'Unable to load messages' });
    }
  }

  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const body = cleanMessage(req.body?.body);
  const withdrawalId = req.body?.withdrawal_id ? String(req.body.withdrawal_id) : null;
  if (!body) return res.status(400).json({ error: 'Message cannot be empty' });

  try {
    if (withdrawalId) {
      const { data: withdrawal, error: withdrawalError } = await supabase
        .from('participant_withdrawals')
        .select('id')
        .eq('id', withdrawalId)
        .eq('username', participant.username)
        .maybeSingle();
      if (withdrawalError) throw withdrawalError;
      if (!withdrawal) return res.status(403).json({ error: 'This withdrawal does not belong to you' });
    }

    const { data, error } = await supabase
      .from('support_messages')
      .insert({
        participant_id: participant.id,
        withdrawal_id: withdrawalId,
        sender_type: 'participant',
        message_type: 'enquiry',
        body
      })
      .select('id, withdrawal_id, sender_type, message_type, body, read_at, created_at')
      .single();
    if (error) throw error;
    return res.status(201).json({ success: true, message: data });
  } catch (error) {
    console.error('Participant message send error:', error);
    return res.status(500).json({ error: 'Unable to send message' });
  }
}
