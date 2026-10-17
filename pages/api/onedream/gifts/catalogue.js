// Public virtual gift catalogue. Gifts, artwork and coin costs come from the
// database (virtual_gift_catalogue, admin-managed), never from the app.

import { giftsDb, publicGift } from '../../../../lib/dreamCoins';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  try {
    const { data, error } = await giftsDb.from('virtual_gift_catalogue').select('*').eq('is_active', true)
      .order('display_priority', { ascending: true }).order('coin_cost', { ascending: true });
    if (error) throw error;
    res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=300');
    return res.status(200).json({ gifts: (data || []).map(publicGift) });
  } catch (error) {
    console.error('gifts/catalogue error:', error);
    return res.status(500).json({ error: 'Could not load gifts' });
  }
}
