import { createClient } from '@supabase/supabase-js';
import { requireActiveAdmin } from '../../../lib/adminAuth';

const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

export default async function handler(req, res) {
  const admin = await requireActiveAdmin(req, res, supabase);
  if (!admin) return;

  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const status = req.query.status || 'all';

  try {
    let query = supabase
      .from('catalogue_orders')
      .select(`
        id,
        seller_username,
        buyer_username,
        item_id,
        status,
        amount_usd,
        amount_ngn,
        exchange_rate,
        currency,
        payment_method,
        payment_reference,
        created_at,
        buyer_confirmed_at,
        seller_confirmed_at,
        buyer_id,
        seller_id
      `)
      .order('created_at', { ascending: false });

    // Filter by status if specified
    if (status !== 'all') {
      query = query.eq('status', status);
    }

    const { data: orders, error } = await query;
    if (error) throw error;

    // Get summary stats
    const { data: summaryData } = await supabase
      .from('catalogue_orders')
      .select('status, amount_usd')
      .select('status, count() as count, sum(amount_usd) as total_usd', { count: 'exact' });

    return res.status(200).json({
      orders: orders || [],
      total: orders?.length || 0,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Admin orders fetch error:', error);
    return res.status(500).json({ error: 'Unable to load orders' });
  }
}
