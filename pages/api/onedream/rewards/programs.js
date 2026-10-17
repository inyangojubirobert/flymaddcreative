// Public list of active recognition programmes (reward_programs). All are
// non-cash: badges, achievements, featured placement and similar benefits.

import { giftsDb, programFields } from '../../../../lib/dreamCoins';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  try {
    const { data, error } = await giftsDb.from('reward_programs').select(programFields).eq('is_active', true).order('sort_order');
    if (error) throw error;
    res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=300');
    return res.status(200).json({ programs: data || [] });
  } catch (error) {
    console.error('rewards/programs error:', error);
    return res.status(500).json({ error: 'Could not load programmes' });
  }
}
