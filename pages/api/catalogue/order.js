// Buyer's view of one order, authorised by the order's buyer_token (from the
// confirmation link). Replaces the website reading catalogue_orders directly
// with the anon key, so the table no longer needs to be publicly readable
// (supabase/lockdown_catalogue_orders_read.sql).

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

const BUYER_FIELDS = 'id, item_id, seller_username, status, created_at, updated_at, buyer_name, quantity, unit_price_usd, amount_usd, amount_ngn, currency, payment_method, buyer_token, catalogue_items(title, images, price_usd, seller_username)';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const orderId = String(req.query.order_id || '');
  const buyerToken = String(req.query.buyer_token || '');
  if (!orderId || !buyerToken) return res.status(400).json({ error: 'order_id and buyer_token are required' });

  try {
    const { data: order, error } = await supabase.from('catalogue_orders').select(BUYER_FIELDS).eq('id', orderId).maybeSingle();
    if (error) throw error;
    if (!order || order.buyer_token !== buyerToken) return res.status(404).json({ error: 'Order not found' });
    return res.status(200).json({ order });
  } catch (error) {
    console.error('catalogue/order error:', error);
    return res.status(500).json({ error: 'Could not load order' });
  }
}
