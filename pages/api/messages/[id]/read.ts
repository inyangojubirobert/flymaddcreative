import type { NextApiRequest, NextApiResponse } from 'next';
import { createClient } from '@supabase/supabase-js';
import { requireParticipant } from '../../../../lib/participantAuth';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

type ResponseData = {
  message?: any;
  error?: string;
};

/**
 * PATCH: Mark a message as read
 */
export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<ResponseData>
) {
  if (req.method !== 'PATCH') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const participant = await requireParticipant(req, res);
    if (!participant) return;

    const { id } = req.query;

    if (typeof id !== 'string' || !id) {
      return res.status(400).json({ error: 'Missing message id' });
    }

    // Enforce recipient ownership in the update itself; this client bypasses RLS.
    const { data, error } = await supabase
      .from('messages')
      .update({
        is_read: true,
      })
      .eq('id', id)
      .eq('receiver_id', participant.id)
      .select()
      .maybeSingle();

    if (error) throw error;
    if (!data) return res.status(404).json({ error: 'Message not found' });

    return res.status(200).json({ message: data });
  } catch (error) {
    console.error('Mark read error:', error);
    return res
      .status(500)
      .json({ error: error instanceof Error ? error.message : 'Internal server error' });
  }
}
