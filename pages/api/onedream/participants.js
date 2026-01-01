import { getLeaderboard } from '../../../src/backend/supabase.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const limit = parseInt(req.query.limit, 10) || 50;

  try {
    const data = await getLeaderboard(limit);
    res.status(200).json({ participants: data });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}
