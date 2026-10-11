// The buyer's library: every licence with its status (so the app can show
// owned items and wipe offline copies of refunded/revoked ones), plus creator
// subscriptions and the items they currently include.
//   GET

import { requireParticipant } from '../../../lib/participantAuth';
import { digitalDb, digitalSettings } from '../../../lib/digital';
import { listSubscriptions } from '../../../lib/digitalBilling';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const participant = await requireParticipant(req, res);
  if (!participant) return;
  try {
    const [{ data, error }, settings, subscriptions] = await Promise.all([
      digitalDb.from('digital_licenses')
        .select('id, item_id, status, is_paid, price_usd, order_id, provider, created_at, revoke_reason, digital_products(kind, seller_username, catalogue_items(title, images))')
        .eq('buyer_id', participant.id)
        .order('created_at', { ascending: false }),
      digitalSettings(),
      // Subscriptions arrive with phase 2; an older database simply has none.
      listSubscriptions(participant.id).catch((e) => { console.error('library: subscriptions unavailable:', e.message); return []; }),
    ]);
    if (error) throw error;

    const owned = new Set((data || []).filter((l) => l.status === 'active').map((l) => l.item_id));
    const creators = [...new Set(subscriptions.filter((s) => s.has_access).map((s) => s.creator_username))];
    let subscriptionItems = [];
    if (creators.length) {
      const { data: products } = await digitalDb.from('digital_products').select('item_id, kind, seller_username, catalogue_items(title, images)')
        .in('seller_username', creators).eq('status', 'published').eq('in_subscription', true).limit(500);
      subscriptionItems = (products || []).filter((p) => !owned.has(p.item_id)).map((p) => ({
        item_id: p.item_id,
        kind: p.kind,
        title: p.catalogue_items?.title || 'Untitled',
        image: p.catalogue_items?.images?.[0] || null,
        seller_username: p.seller_username,
        access_until: subscriptions.find((s) => s.has_access && s.creator_username === p.seller_username)?.current_period_end || null,
      }));
    }

    return res.status(200).json({
      offline_days: settings.offline_days,
      max_devices: settings.max_devices,
      items: (data || []).map((l) => ({
        license_id: l.id,
        item_id: l.item_id,
        status: l.status,
        kind: l.digital_products?.kind,
        title: l.digital_products?.catalogue_items?.title || 'Untitled',
        image: l.digital_products?.catalogue_items?.images?.[0] || null,
        seller_username: l.digital_products?.seller_username,
        is_paid: l.is_paid,
        price_usd: l.price_usd === null ? null : Number(l.price_usd),
        order_id: l.order_id,
        provider: l.provider,
        created_at: l.created_at,
        revoke_reason: l.revoke_reason,
      })),
      subscriptions,
      subscription_items: subscriptionItems,
    });
  } catch (error) {
    console.error('digital/library error:', error);
    return res.status(500).json({ error: 'Could not load your library' });
  }
}
