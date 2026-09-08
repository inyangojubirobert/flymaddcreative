import type { NextApiRequest, NextApiResponse } from 'next';
import { createClient } from '@supabase/supabase-js';
import { verifyToken } from '../../../lib/jwtSecret';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

type ResponseData = {
  media?: any[];
  error?: string;
};

/**
 * POST: Save media records to database
 * This tracks uploaded media for organization and potential cleanup
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

    const participantId = decoded.id as string;
    const { urls } = req.body;

    if (!Array.isArray(urls) || urls.length === 0) {
      return res.status(400).json({ error: 'Invalid urls' });
    }

    // Extract public_id from Cloudinary URL
    const extractPublicId = (url: string): string => {
      const match = url.match(/\/([^/]+)\/image\/upload\/[^/]+\/(.+)$/);
      return match ? match[2] : url.split('/').pop() || 'unknown';
    };

    // Prepare media records
    const mediaRecords = urls.map(url => ({
      participant_id: participantId,
      cloudinary_url: url,
      cloudinary_public_id: extractPublicId(url),
      media_type: 'image',
    }));

    // Insert all records
    const { data, error } = await supabase
      .from('media')
      .insert(mediaRecords)
      .select();

    if (error) throw error;

    return res.status(201).json({ media: data });
  } catch (error) {
    console.error('Save media error:', error);
    return res
      .status(500)
      .json({ error: error instanceof Error ? error.message : 'Internal server error' });
  }
}
