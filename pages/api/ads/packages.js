// Public catalogue of advertising and listing boost packages (USD), with
// whether each can be bought right now. Prices/durations come from the
// database (advertising_packages), never from the app.

import { adsDb, billingStatus, publicPackage } from '../../../lib/ads';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  try {
    const { data, error } = await adsDb
      .from('advertising_packages')
      .select('*')
      .eq('is_active', true)
      .order('sort_order', { ascending: true });
    if (error) throw error;
    res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=300');
    return res.status(200).json({ billing: billingStatus(), packages: (data || []).map(publicPackage) });
  } catch (error) {
    console.error('ads/packages error:', error);
    return res.status(500).json({ error: 'Could not load packages' });
  }
}
