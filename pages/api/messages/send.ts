import type { NextApiRequest, NextApiResponse } from 'next';
import { createClient } from '@supabase/supabase-js';
import { verifyToken } from '../../../lib/jwtSecret';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

type ResponseData = {
  message?: any;
  error?: string;
};

/**
 * POST: Send a new message
 */
export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<ResponseData>
) {
  if (req.method !== 'POST') {
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

    const senderId = decoded.id as string;
    const { receiver_id, content, media_urls } = req.body;

    // Validation
    if (!receiver_id || !content?.trim()) {
      return res.status(400).json({ error: 'Missing receiver_id or content' });
    }

    // Insert message
    const { data, error } = await supabase
      .from('messages')
      .insert({
        sender_id: senderId,
        receiver_id,
        content,
        media_urls: media_urls && Array.isArray(media_urls) ? media_urls : null,
        is_read: false,
      })
      .select()
      .single();

    if (error) throw error;

    return res.status(201).json({ message: data });
  } catch (error) {
    console.error('Send message error:', error);
    return res
      .status(500)
      .json({ error: error instanceof Error ? error.message : 'Internal server error' });
  }
}
