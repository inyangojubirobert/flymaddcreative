// A seller's own catalogue orders (participant login), including the buyer's
// private contact and delivery details needed to fulfil each order, plus the
// commission/net figures for the earnings ledger. Never returns buyer_token:
// that token authorises the buyer's confirm/dispute actions.
// Only rows for this seller are returned, so in a multi-seller cart each
// seller sees only their own order.

import { createClient } from '@supabase/supabase-js';
import { requireParticipant } from '../../../lib/participantAuth';
import { SELLER_ORDER_FIELDS } from '../../../lib/sellerEarnings';

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
      .select(`${SELLER_ORDER_FIELDS}, catalogue_items(title, images)`)
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
