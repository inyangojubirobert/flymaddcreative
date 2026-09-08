import type { NextApiRequest, NextApiResponse } from 'next';
import { createClient } from '@supabase/supabase-js';
import { verifyToken } from '../../../lib/jwtSecret';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

type ConversationSummary = {
  id: string;
  other_participant_id: string;
  last_message: string;
  last_message_time: string;
  unread_count: number;
};

type ResponseData = {
  conversations?: ConversationSummary[];
  error?: string;
};

/**
 * GET: Get list of recent conversations for current user
 */
export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<ResponseData>
) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Verify JWT token
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (!token) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const decoded = verifyToken(token);
    if (!decoded || !decoded.id) {
      return res.status(401).json({ error: 'Invalid token' });
    }

    const currentUserId = decoded.id as string;

    // Get all messages involving current user, grouped by conversation
    const { data, error } = await supabase
      .from('messages')
      .select('*')
      .or(
        `sender_id.eq.${currentUserId},receiver_id.eq.${currentUserId}`
      )
      .order('created_at', { ascending: false });

    if (error) throw error;

    // Process conversations
    const conversationMap = new Map<string, ConversationSummary>();

    data?.forEach((msg: any) => {
      const otherParticipantId = msg.sender_id === currentUserId ? msg.receiver_id : msg.sender_id;
      
      if (!conversationMap.has(otherParticipantId)) {
        conversationMap.set(otherParticipantId, {
          id: `conv-${otherParticipantId}`,
          other_participant_id: otherParticipantId,
          last_message: msg.content || '[Media]',
          last_message_time: msg.created_at,
          unread_count: 0,
        });
      }

      // Count unread messages for current user
      if (msg.receiver_id === currentUserId && !msg.is_read) {
        const conv = conversationMap.get(otherParticipantId);
        if (conv) {
          conv.unread_count += 1;
        }
      }
    });

    const conversations = Array.from(conversationMap.values());

    return res.status(200).json({ conversations });
  } catch (error) {
    console.error('Get conversations error:', error);
    return res
      .status(500)
      .json({ error: error instanceof Error ? error.message : 'Internal server error' });
  }
}
