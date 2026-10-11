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
        buyer_name,
        buyer_email,
        buyer_whatsapp,
        delivery_address,
        item_id,
        checkout_id,
        quantity,
        commission_percent,
        commission_usd,
        seller_net_usd,
        buyer_confirmed_at,
        disputed_at,
        released_at,
        status,
        amount_usd,
        amount_ngn,
        exchange_rate,
        currency,
        payment_method,
        payment_ref,
        tx_hash,
        notes,
        created_at,
        updated_at,
        catalogue_items(title)
      `)
      .order('created_at', { ascending: false });

    // Filter by status if specified
    if (status !== 'all') {
      query = query.eq('status', status);
    }

    const { data: orders, error } = await query;
    if (error) throw error;

    // Sellers' private contacts, for dispute resolution and delivery follow-up.
    const sellers = [...new Set((orders || []).map((order) => order.seller_username).filter(Boolean))];
    let contactBySeller = new Map();
    if (sellers.length) {
      const { data: people } = await supabase.from('participants').select('id, username, email').in('username', sellers);
      const { data: contacts } = await supabase
        .from('participant_private_contacts')
        .select('participant_id, phone, whatsapp')
        .in('participant_id', (people || []).map((p) => p.id));
      const contactById = new Map((contacts || []).map((c) => [c.participant_id, c]));
      contactBySeller = new Map((people || []).map((p) => [p.username, {
        email: p.email,
        phone: contactById.get(p.id)?.phone || null,
        whatsapp: contactById.get(p.id)?.whatsapp || null,
      }]));
    }

    return res.status(200).json({
      orders: (orders || []).map((order) => ({ ...order, seller_contact: contactBySeller.get(order.seller_username) || null })),
      total: orders?.length || 0,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Admin orders fetch error:', error);
    return res.status(500).json({ error: 'Unable to load orders' });
  }
}
