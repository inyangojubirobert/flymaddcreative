// Creator monthly subscriptions: subscribers get every published digital
// product the creator includes (default: all) while the subscription is paid.
//   GET ?username=      public plan (price, included items, Google Play products) + viewer's subscription
//   GET ?mine=1         own plan, price tiers, subscriber count, included products
//   POST { tier_id, description?, is_active }   create / change / turn off own plan
// Price changes apply to new subscribers; existing ones keep their price.
// Turning the plan off stops renewals (website: no further charges; Google
// Play: auto-renew cancelled) - subscribers keep access to the end of the
// month they paid for.

import { requireParticipant } from '../../../lib/participantAuth';
import { digitalDb } from '../../../lib/digital';
import { cancelCreatorSubscription } from '../../../lib/digitalSubscriptions';

const live = (q) => q.in('status', ['active', 'past_due']).gt('current_period_end', new Date().toISOString());

async function includedItems(username) {
  const { data } = await digitalDb.from('digital_products').select('item_id, kind, catalogue_items(title, images)')
    .eq('seller_username', username).eq('status', 'published').eq('in_subscription', true).limit(200);
  return (data || []).map((p) => ({ item_id: p.item_id, kind: p.kind, title: p.catalogue_items?.title || 'Untitled', image: p.catalogue_items?.images?.[0] || null }));
}

export default async function handler(req, res) {
  try {
    if (req.method === 'GET' && req.query.username) {
      let viewer = null;
      if (req.headers.authorization) {
        viewer = await requireParticipant(req, res);
        if (!viewer) return;
      }
      const username = String(req.query.username).replace(/^@/, '');
      const { data: plan } = await digitalDb.from('digital_creator_plans').select('*, digital_sub_tiers(*)').eq('creator_username', username).maybeSingle();
      const items = plan?.is_active ? await includedItems(username) : [];
      if (!plan || !plan.is_active || !plan.digital_sub_tiers?.is_active || !items.length) return res.status(200).json({ plan: null });
      const { data: slots } = await digitalDb.from('digital_sub_products').select('google_play_product_id, slot')
        .eq('tier_id', plan.tier_id).eq('is_active', true).not('google_play_product_id', 'is', null).order('slot');
      let subscription = null;
      if (viewer) {
        const { data } = await live(digitalDb.from('digital_subscriptions').select('id, provider, status, auto_renew, current_period_end, product_id')
          .eq('subscriber_id', viewer.id).eq('creator_username', username)).maybeSingle();
        subscription = data;
      }
      return res.status(200).json({
        plan: {
          creator_username: plan.creator_username,
          creator_id: plan.creator_id,
          tier_id: plan.tier_id,
          price_usd: Number(plan.digital_sub_tiers.price_usd),
          description: plan.description,
          items,
          google_play_products: (slots || []).map((s) => s.google_play_product_id),
        },
        subscription,
        is_creator: viewer?.username === username,
      });
    }

    const participant = await requireParticipant(req, res);
    if (!participant) return;

    if (req.method === 'GET') {
      const [{ data: plan }, { data: tiers }, { count }, items] = await Promise.all([
        digitalDb.from('digital_creator_plans').select('*').eq('creator_username', participant.username).maybeSingle(),
        digitalDb.from('digital_sub_tiers').select('id, price_usd').eq('is_active', true).order('price_usd'),
        live(digitalDb.from('digital_subscriptions').select('id', { count: 'exact', head: true }).eq('creator_username', participant.username)),
        includedItems(participant.username),
      ]);
      return res.status(200).json({ plan, tiers: (tiers || []).map((t) => ({ ...t, price_usd: Number(t.price_usd) })), subscribers: count || 0, items });
    }

    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
    const { data: existing } = await digitalDb.from('digital_creator_plans').select('*').eq('creator_username', participant.username).maybeSingle();
    const tierId = String(req.body?.tier_id ?? existing?.tier_id ?? '');
    const { data: tier } = await digitalDb.from('digital_sub_tiers').select('id, is_active').eq('id', tierId).maybeSingle();
    if (!tier || !tier.is_active) return res.status(400).json({ error: 'Choose a monthly price' });
    const isActive = req.body?.is_active === undefined ? existing?.is_active ?? true : req.body.is_active === true;
    const description = req.body?.description === undefined ? existing?.description ?? null
      : (typeof req.body.description === 'string' ? req.body.description.trim().slice(0, 500) || null : null);

    const { data: saved, error } = await digitalDb.from('digital_creator_plans').upsert({
      creator_username: participant.username, creator_id: participant.id, tier_id: tier.id, description, is_active: isActive,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'creator_username' }).select('*').single();
    if (error) throw error;

    let renewalsStopped = 0;
    if (existing?.is_active && !isActive) {
      const { data: subs } = await live(digitalDb.from('digital_subscriptions').select('id, provider, provider_ref, product_id')
        .eq('creator_username', participant.username).eq('auto_renew', true));
      for (const sub of subs || []) {
        try {
          if (sub.provider === 'google_play' && sub.product_id) await cancelCreatorSubscription(sub.product_id, sub.provider_ref);
          await digitalDb.from('digital_subscriptions').update({ auto_renew: false, end_reason: 'creator ended the plan', updated_at: new Date().toISOString() }).eq('id', sub.id);
          renewalsStopped += 1;
        } catch (e) {
          console.error('creator plan off: could not stop renewal', sub.id, e.message);
        }
      }
    }
    return res.status(200).json({ plan: saved, renewals_stopped: renewalsStopped });
  } catch (error) {
    console.error('digital/creator-plan error:', error.message || error);
    return res.status(500).json({ error: 'Could not load or save the subscription plan' });
  }
}
