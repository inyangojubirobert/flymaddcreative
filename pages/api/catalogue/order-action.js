// Ownership-checked status transitions for catalogue_orders. Replaces direct
// calls to window.SupabaseAPI.updateOrderStatus(orderId, status) from the
// browser, which had no ownership check at all - any caller could release
// escrow funds on any order, not just their own.
//
// - confirm_delivery / raise_dispute: the buyer isn't a logged-in account,
//   so ownership is proven with the buyer_token from their confirmation
//   link (same token already used to gate the read-only order view).
// - release_funds: the seller must be an authenticated participant (the
//   same onedream_token used elsewhere on user-dashboard.html) whose
//   username matches the order's seller_username, and the order must
//   already be buyer_confirmed - a seller can't self-release before the
//   buyer has confirmed delivery.

import { createClient } from '@supabase/supabase-js';
import { requireParticipant } from '../../../lib/participantAuth';

const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

const BUYER_ACTIONS = {
  confirm_delivery: { from: ['paid', 'pending_verification'], to: 'buyer_confirmed' },
  raise_dispute: { from: ['paid', 'pending_verification'], to: 'disputed' }
};

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { order_id, action, buyer_token } = req.body;

    if (!order_id || !action) {
      return res.status(400).json({ error: 'Missing order_id or action' });
    }

    const { data: order, error: orderError } = await supabase
      .from('catalogue_orders')
      .select('id, status, buyer_token, seller_username')
      .eq('id', order_id)
      .single();

    if (orderError || !order) {
      return res.status(404).json({ error: 'Order not found' });
    }

    let newStatus;

    if (action === 'release_funds') {
      const participant = await requireParticipant(req, res);
      if (!participant) return; // response already sent

      if (participant.username !== order.seller_username) {
        return res.status(403).json({ error: 'Not authorized for this order' });
      }
      if (order.status !== 'buyer_confirmed') {
        return res.status(400).json({ error: `Cannot release funds from status "${order.status}"` });
      }
      newStatus = 'released';
    } else if (BUYER_ACTIONS[action]) {
      const rule = BUYER_ACTIONS[action];
      if (!buyer_token || buyer_token !== order.buyer_token) {
        return res.status(403).json({ error: 'Invalid buyer token' });
      }
      if (!rule.from.includes(order.status)) {
        return res.status(400).json({ error: `Cannot ${action} from status "${order.status}"` });
      }
      newStatus = rule.to;
    } else {
      return res.status(400).json({ error: 'Invalid action' });
    }

    const { data: updated, error: updateError } = await supabase
      .from('catalogue_orders')
      .update({ status: newStatus, updated_at: new Date().toISOString() })
      .eq('id', order_id)
      .select()
      .single();

    if (updateError) {
      console.error('Order status update error:', updateError);
      return res.status(500).json({ error: 'Failed to update order' });
    }

    return res.status(200).json({ success: true, order: updated });
  } catch (error) {
    console.error('order-action error:', error);
    return res.status(500).json({ error: 'Order action failed', details: error.message });
  }
}
