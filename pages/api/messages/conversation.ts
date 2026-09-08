import type { NextApiRequest, NextApiResponse } from 'next';
import { createClient } from '@supabase/supabase-js';
import { verifyToken } from '../../../lib/jwtSecret';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

type ResponseData = {
  success?: boolean;
  message?: any;
  messages?: any[];
  error?: string;
};

/**
 * GET: Fetch messages in conversation with another participant
 * POST: Create a new message
 */
export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<ResponseData>
) {
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

    const senderId = decoded.id as string;

    if (req.method === 'GET') {
      // Get conversation with a specific user
      const receiverId = req.headers['x-receiver-id'] as string;
      if (!receiverId) {
        return res.status(400).json({ error: 'Missing receiverId' });
      }

      const { data, error } = await supabase
        .from('messages')
        .select('*')
        .or(
          `and(sender_id.eq.${senderId},receiver_id.eq.${receiverId}),and(sender_id.eq.${receiverId},receiver_id.eq.${senderId})`
        )
        .order('created_at', { ascending: true })
        .limit(100);

      if (error) throw error;

      return res.status(200).json({ messages: data || [] });
    }

    if (req.method === 'POST') {
      // Send a new message
      const { receiver_id, content, media_urls } = req.body;

      if (!receiver_id || !content) {
        return res.status(400).json({ error: 'Missing required fields' });
      }

      const { data, error } = await supabase
        .from('messages')
        .insert({
          sender_id: senderId,
          receiver_id,
          content,
          media_urls: media_urls || null,
        })
        .select()
        .single();

      if (error) throw error;

      return res.status(201).json({ message: data });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (error) {
    console.error('Message error:', error);
    return res
      .status(500)
      .json({ error: error instanceof Error ? error.message : 'Internal server error' });
  }
}
