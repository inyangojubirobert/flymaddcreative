import { createClient } from '@supabase/supabase-js';
import { requireParticipant } from '../../../../lib/participantAuth';

const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

export default async function handler(req, res) {
  const participant = await requireParticipant(req, res);
  if (!participant) return;

  const id = String(req.query.id || '');
  if (!id) return res.status(400).json({ error: 'Conversation id is required' });

  try {
    const { data: conversation, error: conversationError } = await supabase
      .from('ai_conversations')
      .select('id, title, created_at, updated_at')
      .eq('id', id)
      .eq('participant_id', participant.id)
      .maybeSingle();
    if (conversationError) throw conversationError;
    if (!conversation) return res.status(404).json({ error: 'Conversation not found' });

    if (req.method === 'GET') {
      const { data, error } = await supabase
        .from('ai_messages')
        .select('id, conversation_id, role, kind, content, credits_charged, created_at')
        .eq('conversation_id', id)
        .eq('participant_id', participant.id)
        .order('created_at', { ascending: true });
      if (error) throw error;
      return res.status(200).json({ conversation, messages: data || [] });
    }

    if (req.method === 'DELETE') {
      const { error } = await supabase
        .from('ai_conversations')
        .delete()
        .eq('id', id)
        .eq('participant_id', participant.id);
      if (error) throw error;
      return res.status(200).json({ success: true });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (error) {
    console.error('AI conversation detail error:', error);
    return res.status(500).json({ error: 'Unable to load AI conversation' });
  }
}

