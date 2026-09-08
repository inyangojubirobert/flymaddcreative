import { createClient } from '@supabase/supabase-js';
import { requireParticipant } from '../../../lib/participantAuth';

const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

export default async function handler(req, res) {
  const participant = await requireParticipant(req, res);
  if (!participant) return;

  try {
    if (req.method === 'GET') {
      const { data, error } = await supabase
        .from('ai_conversations')
        .select('id, title, created_at, updated_at')
        .eq('participant_id', participant.id)
        .order('updated_at', { ascending: false })
        .limit(50);
      if (error) throw error;
      return res.status(200).json({ conversations: data || [] });
    }

    if (req.method === 'POST') {
      const { data, error } = await supabase
        .from('ai_conversations')
        .insert({ participant_id: participant.id, title: 'New conversation' })
        .select('id, title, created_at, updated_at')
        .single();
      if (error) throw error;
      return res.status(201).json({ conversation: data });
    }

    if (req.method === 'DELETE') {
      const { error } = await supabase
        .from('ai_conversations')
        .delete()
        .eq('participant_id', participant.id);
      if (error) throw error;
      return res.status(200).json({ success: true });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (error) {
    console.error('AI conversations error:', error);
    const migrationMissing = error?.code === '42P01';
    return res.status(migrationMissing ? 503 : 500).json({
      error: migrationMissing ? 'AI chat storage is being set up. Please try again later.' : 'Unable to update AI conversations',
    });
  }
}

