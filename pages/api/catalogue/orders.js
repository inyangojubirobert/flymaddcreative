// Ownership-checked read of a seller's own catalogue orders. catalogue_orders
// has a blanket "select using (true)" RLS policy (see
// supabase/lockdown_catalogue_orders_rls.sql) - it has to stay open because
// the buyer-confirmation-link flow only has an anon key and a buyer_token,
// no login. That same openness means anyone with the anon key can currently
// list every seller's orders, not just their own, if they read the table
// directly. This route gives the mobile app (and any future website update)
// a properly scoped alternative to public/js/supabase-config.js's
// getOrdersBySellerUsername(), which reads the wide-open table unscoped.

import { createClient } from '@supabase/supabase-js';
import { requireParticipant } from '../../../lib/participantAuth';

const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const participant = await requireParticipant(req, res);
  if (!participant) return; // response already sent

  try {
    const { data, error } = await supabase
      .from('catalogue_orders')
      .select('*, catalogue_items(title)')
      .eq('seller_username', participant.username)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Orders fetch error:', error);
      return res.status(500).json({ error: 'Failed to fetch orders' });
    }

    return res.status(200).json({ orders: data || [] });
  } catch (error) {
    console.error('catalogue/orders error:', error);
    return res.status(500).json({ error: 'Request failed', details: error.message });
  }
}
