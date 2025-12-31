import { supabase } from '../../../src/backend/supabase.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const limit = parseInt(req.query.limit, 10) || 50;

  const { data, error } = await supabase
    .from('participants')
    .select('id, name, username, user_code, total_votes, total_amount, current_stage, achievement_badges, created_at, updated_at')
    .order('total_votes', { ascending: false })
    .limit(limit);

  if (error) {
    return res.status(500).json({ error: error.message });
  }

  res.status(200).json({ participants: data });
}
