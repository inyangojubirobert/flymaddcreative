// Admin: creator subscriptions and website payments for digital products.
//   GET ?check=1                    tiers, Google Play subscription products (with live Play status
//                                   when check=1), recent subscriptions and website payments
//   PATCH { id, google_play_product_id?, is_active? }   edit a subscription product (slot)
//   POST  { action: 'add_slot', tier_id }               one more product for a price (more creators per user)
//   POST  { action: 'end', subscription_id, reason }    end a subscription now (no refund is issued here)

import { requireActiveAdmin } from '../../../../lib/adminAuth';
import { digitalDb } from '../../../../lib/digital';
import { getPlaySubscriptionStatus } from '../../../../lib/digitalSubscriptions';

const PRODUCT_ID = /^[a-z0-9][a-z0-9._]{0,138}$/;

export default async function handler(req, res) {
  const admin = await requireActiveAdmin(req, res, digitalDb);
  if (!admin) return;
  try {
    if (req.method === 'GET') {
      const [tiers, products, subs, payments, plans] = await Promise.all([
        digitalDb.from('digital_sub_tiers').select('*').order('price_usd'),
        digitalDb.from('digital_sub_products').select('*').order('tier_id').order('slot'),
        digitalDb.from('digital_subscriptions').select('id, creator_username, provider, price_usd, status, auto_renew, current_period_end, last_renewal_error, end_reason, created_at, participants(username)')
          .order('created_at', { ascending: false }).limit(50),
        digitalDb.from('digital_paystack_payments').select('reference, purpose, item_id, creator_username, price_usd, amount_kobo, status, failure, created_at, participants(username)')
          .order('created_at', { ascending: false }).limit(50),
        digitalDb.from('digital_creator_plans').select('creator_username, tier_id, is_active'),
      ]);
      for (const r of [tiers, products, subs, payments, plans]) if (r.error) throw r.error;
      const priceOf = Object.fromEntries((tiers.data || []).map((t) => [t.id, Number(t.price_usd)]));
      let rows = products.data || [];
      if (req.query.check === '1') {
        rows = await Promise.all(rows.map(async (p) => {
          if (!p.google_play_product_id) return { ...p, state: 'unconfigured' };
          const status = await getPlaySubscriptionStatus(p.google_play_product_id);
          return { ...p, state: status.state, play_price: status.price, detail: status.detail,
            price_matches: status.price ? Math.abs(status.price.amount - priceOf[p.tier_id]) < 0.01 : null };
        }));
      }
      return res.status(200).json({
        tiers: tiers.data || [],
        products: rows.map((p) => ({ ...p, price_usd: priceOf[p.tier_id] })),
        subscriptions: subs.data || [],
        payments: payments.data || [],
        plans: plans.data || [],
        paystack_configured: !!process.env.PAYSTACK_SECRET_KEY,
      });
    }

    if (req.method === 'PATCH') {
      const update = {};
      if (req.body?.google_play_product_id !== undefined) {
        const value = String(req.body.google_play_product_id || '').trim();
        if (value && !PRODUCT_ID.test(value)) return res.status(400).json({ error: 'Product id must match Play Console (lowercase letters, digits, . and _)' });
        update.google_play_product_id = value || null;
      }
      if (typeof req.body?.is_active === 'boolean') update.is_active = req.body.is_active;
      const { data, error } = await digitalDb.from('digital_sub_products').update(update).eq('id', String(req.body?.id || '')).select('*').maybeSingle();
      if (error) return res.status(400).json({ error: error.code === '23505' ? 'That product id is already used' : error.message });
      if (!data) return res.status(404).json({ error: 'Product not found' });
      return res.status(200).json({ product: data });
    }

    if (req.method === 'POST' && req.body?.action === 'add_slot') {
      const tierId = String(req.body?.tier_id || '');
      const { data: existing } = await digitalDb.from('digital_sub_products').select('slot').eq('tier_id', tierId).order('slot', { ascending: false }).limit(1);
      const { data: tier } = await digitalDb.from('digital_sub_tiers').select('id').eq('id', tierId).maybeSingle();
      if (!tier) return res.status(404).json({ error: 'Tier not found' });
      const slot = (existing?.[0]?.slot || 0) + 1;
      if (slot > 20) return res.status(409).json({ error: 'At most 20 products per price' });
      const { data, error } = await digitalDb.from('digital_sub_products').insert({
        id: `${tierId}_s${slot}`, tier_id: tierId, slot, google_play_product_id: `onedream_creator_${tierId.slice(4)}_s${slot}`,
      }).select('*').single();
      if (error) return res.status(400).json({ error: error.message });
      return res.status(201).json({ product: data });
    }

    if (req.method === 'POST' && req.body?.action === 'end') {
      const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim().slice(0, 200) : '';
      if (!reason) return res.status(400).json({ error: 'A reason is required' });
      const { data, error } = await digitalDb.rpc('digital_end_subscription', {
        p_subscription_id: String(req.body?.subscription_id || ''), p_status: 'revoked', p_reason: `Admin: ${reason}`,
      });
      if (error) throw error;
      if (!data) return res.status(409).json({ error: 'Subscription not found or already ended' });
      return res.status(200).json({ success: true });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (error) {
    console.error('admin/digital/subscriptions error:', error);
    return res.status(500).json({ error: 'Subscription request failed' });
  }
}
