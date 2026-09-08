// Order-scoped chat between a catalogue buyer and seller, available only for
// orders that already exist in catalogue_orders - i.e. only after payment
// has been verified server-side (see verify-order.js). There is deliberately
// no way to message about an order that hasn't been paid for.
import { createClient } from '@supabase/supabase-js';
import { requireParticipant } from '../../../lib/participantAuth';

const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

function cleanBody(value) {
  return typeof value === 'string' ? value.trim().slice(0, 2000) : '';
}

// Resolves whether the caller is the buyer (proven via buyer_token) or the
// seller (proven via participant JWT matching order.seller_username).
// Writes an error response and returns null if neither checks out.
async function resolveSenderRole(req, res, order) {
  const authHeader = req.headers.authorization || '';
  if (authHeader.startsWith('Bearer ')) {
    const participant = await requireParticipant(req, res);
    if (!participant) return null; // response already sent
    if (participant.username !== order.seller_username) {
      res.status(403).json({ error: 'Not authorized for this order' });
      return null;
    }
    return 'seller';
  }

  const buyerToken = String(req.body?.buyer_token || req.query.buyer_token || '');
  if (buyerToken && buyerToken === order.buyer_token) return 'buyer';

  res.status(401).json({ error: 'Missing or invalid authorization' });
  return null;
}

export default async function handler(req, res) {
  const orderId = String(req.query.order_id || req.body?.order_id || '');
  if (!orderId) return res.status(400).json({ error: 'order_id is required' });

  try {
    const { data: order, error: orderError } = await supabase
      .from('catalogue_orders')
      .select('id, buyer_token, seller_username')
      .eq('id', orderId)
      .maybeSingle();
    if (orderError) throw orderError;
    if (!order) return res.status(404).json({ error: 'Order not found' });

    if (req.method === 'GET') {
      const role = await resolveSenderRole(req, res, order);
      if (!role) return;

      const { data, error } = await supabase
        .from('order_messages')
        .select('id, sender_role, body, media_url, created_at')
        .eq('order_id', orderId)
        .order('created_at', { ascending: true });
      if (error) throw error;
      return res.status(200).json({ messages: data || [] });
    }

    if (req.method === 'POST') {
      const role = await resolveSenderRole(req, res, order);
      if (!role) return;

      const body = cleanBody(req.body?.body);
      const mediaUrl = typeof req.body?.media_url === 'string' ? req.body.media_url.slice(0, 2000) : null;
      if (!body && !mediaUrl) return res.status(400).json({ error: 'Message cannot be empty' });

      const { data, error } = await supabase
        .from('order_messages')
        .insert({ order_id: orderId, sender_role: role, body: body || '📎 Attachment', media_url: mediaUrl })
        .select('id, sender_role, body, media_url, created_at')
        .single();
      if (error) throw error;
      return res.status(201).json({ success: true, message: data });
    }

    if (req.method === 'DELETE') {
      const role = await resolveSenderRole(req, res, order);
      if (!role) return;

      const messageId = String(req.query.id || req.body?.id || '');
      if (!messageId) return res.status(400).json({ error: 'Message id is required' });

      const { data: existing, error: fetchError } = await supabase
        .from('order_messages')
        .select('id, order_id, sender_role')
        .eq('id', messageId)
        .maybeSingle();
      if (fetchError) throw fetchError;
      if (!existing || existing.order_id !== orderId) return res.status(404).json({ error: 'Message not found' });
      if (existing.sender_role !== role) return res.status(403).json({ error: 'Only your own messages can be deleted' });

      const { error: deleteError } = await supabase.from('order_messages').delete().eq('id', messageId);
      if (deleteError) throw deleteError;
      return res.status(200).json({ success: true });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (error) {
    console.error('order-messages error:', error);
    return res.status(500).json({ error: 'Request failed' });
  }
}
