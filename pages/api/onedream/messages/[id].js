import { createClient } from '@supabase/supabase-js';
import { requireParticipant } from '../../../../lib/participantAuth';

const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

export default async function handler(req, res) {
  if (req.method !== 'DELETE') return res.status(405).json({ error: 'Method not allowed' });

  const participant = await requireParticipant(req, res);
  if (!participant) return;

  const id = String(req.query.id || '');
  if (!id) return res.status(400).json({ error: 'Message id is required' });

  try {
    // Only the participant's own sent messages can be deleted - never
    // support/admin/system/AI replies, and never another participant's data.
    const { data: existing, error: fetchError } = await supabase
      .from('support_messages')
      .select('id, participant_id, sender_type')
      .eq('id', id)
      .maybeSingle();
    if (fetchError) throw fetchError;
    if (!existing || existing.participant_id !== participant.id) {
      return res.status(404).json({ error: 'Message not found' });
    }
    if (existing.sender_type !== 'participant') {
      return res.status(403).json({ error: 'Only your own messages can be deleted' });
    }

    const { error: deleteError } = await supabase.from('support_messages').delete().eq('id', id);
    if (deleteError) throw deleteError;

    return res.status(200).json({ success: true });
  } catch (error) {
    console.error('Participant message delete error:', error);
    return res.status(500).json({ error: 'Unable to delete message' });
  }
}
