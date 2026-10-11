// Digital product details for a listing: kind, price tier, contents and a
// free preview (never the full content), whether website card payment is
// available, and the creator's subscription if it includes this item. With a
// login, also says whether the viewer owns it or is subscribed.
//   GET ?item_id=

import { requireParticipant } from '../../../lib/participantAuth';
import { digitalDb, digitalSalesPaused, publicDigitalProduct } from '../../../lib/digital';

async function creatorSubscription(product, viewer) {
  if (product.status !== 'published' || product.in_subscription === false) return null;
  const { data: plan, error } = await digitalDb.from('digital_creator_plans').select('creator_username, creator_id, tier_id, description, is_active, digital_sub_tiers(price_usd, is_active)')
    .eq('creator_username', product.seller_username).maybeSingle();
  if (error || !plan?.is_active || !plan.digital_sub_tiers?.is_active) return null;
  let subscribed = false;
  if (viewer) {
    const { data } = await digitalDb.rpc('digital_subscription_access', { p_subscriber_id: viewer.id, p_item_id: product.item_id });
    subscribed = !!(Array.isArray(data) ? data[0] : data);
  }
  return { creator_username: plan.creator_username, price_usd: Number(plan.digital_sub_tiers.price_usd), description: plan.description, subscribed };
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const itemId = String(req.query.item_id || '');
  if (!/^[0-9a-f-]{36}$/i.test(itemId)) return res.status(400).json({ error: 'item_id is required' });

  let viewer = null;
  if (req.headers.authorization) {
    viewer = await requireParticipant(req, res);
    if (!viewer) return;
  }

  try {
    const { data: product, error } = await digitalDb.from('digital_products').select('*, digital_price_tiers(*)').eq('item_id', itemId).maybeSingle();
    if (error) throw error;
    const isSeller = viewer && product && viewer.username === product.seller_username;
    if (!product || (product.status !== 'published' && !isSeller)) return res.status(200).json({ product: null });

    const { data: assets } = await digitalDb.from('digital_assets').select('*').eq('item_id', itemId);
    let license = null;
    if (viewer) {
      const { data } = await digitalDb.from('digital_licenses').select('id').eq('buyer_id', viewer.id).eq('item_id', itemId).eq('status', 'active').maybeSingle();
      license = data;
    }
    return res.status(200).json({
      product: publicDigitalProduct(product, product.digital_price_tiers, assets || []),
      owned: !!license,
      license_id: license?.id || null,
      is_seller: !!isSeller,
      web_payment: !digitalSalesPaused() && !!process.env.PAYSTACK_SECRET_KEY && product.status === 'published',
      subscription: await creatorSubscription(product, viewer).catch(() => null),
    });
  } catch (error) {
    console.error('digital/product error:', error);
    return res.status(500).json({ error: 'Could not load product' });
  }
}
