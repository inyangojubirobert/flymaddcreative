// Offer discovery for partners: active offers on other sellers' listings,
// what a sale would earn, and the caller's membership if any.
//   GET ?q=&limit=
// Any listing type or category can carry an offer; nothing is hard-coded.

import { earningsDb, getEarningsSettings, must, partnerForParticipant, requireParty } from '../../../lib/earnings';
import { sellerCommissionPercent } from '../../../lib/sellerEarnings';
import { toMicro } from '../../../lib/earningsRules';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const party = await requireParty(req, res);
  if (!party) return;

  try {
    const [settings, platformPercent, partner] = await Promise.all([
      getEarningsSettings(),
      sellerCommissionPercent(earningsDb),
      party.party_type === 'participant' ? partnerForParticipant(party.party_id) : null,
    ]);
    const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 100);
    let query = earningsDb.from('affiliate_offers')
      .select('*, item:catalogue_items(id, title, price_usd, images, status, seller_username, listing_type)')
      .eq('status', 'active').order('updated_at', { ascending: false }).limit(limit);
    const offers = must(await query) || [];
    const ownUsername = party.participant?.username?.toLowerCase();
    const memberships = partner
      ? must(await earningsDb.from('affiliate_memberships').select('id, offer_id, model, status, resale_price_usd').eq('partner_id', partner.id))
      : [];
    const byOffer = new Map(memberships.map((m) => [m.offer_id, m]));
    const q = String(req.query.q || '').trim().toLowerCase();

    const rows = offers
      .filter((o) => o.item && o.item.status === 'active')
      .filter((o) => o.funding === 'platform' || o.seller_accepted_terms_version === o.terms_version)
      .filter((o) => !q || o.item.title.toLowerCase().includes(q))
      .map((o) => {
        const gross = toMicro(o.item.price_usd);
        const platform = Math.round(gross * platformPercent / 100);
        const commission = o.funding === 'seller'
          ? Math.min(Math.floor(gross * o.commission_percent / 100), gross - platform)
          : Math.min(Math.floor(gross * o.commission_percent / 100), Math.floor(platform * settings.platform_share_max_percent / 100));
        return {
          id: o.id,
          item: { id: o.item.id, title: o.item.title, price_usd: Number(o.item.price_usd), image: Array.isArray(o.item.images) ? o.item.images[0] : null,
                  seller_username: o.item.seller_username, listing_type: o.item.listing_type },
          own_listing: ownUsername && o.item.seller_username?.toLowerCase() === ownUsername,
          allow_referral: o.allow_referral,
          allow_storefront: o.allow_storefront,
          allow_resale: o.allow_resale,
          funding: o.funding,
          commission_percent: Number(o.commission_percent),
          estimated_commission_micro: commission,
          // The floor is never shown to buyers; partners see it only to choose a resale price.
          resale_floor_usd: o.allow_resale ? Number(o.resale_floor_usd) : null,
          resale_ceiling_usd: o.allow_resale && o.resale_ceiling_usd ? Number(o.resale_ceiling_usd) : null,
          fulfilment: o.fulfilment,
          approval: o.approval,
          creative_rules: o.creative_rules,
          seller_funded_payable: o.funding === 'platform' || settings.seller_funded_settlement_enabled,
          resale_checkout_live: settings.resale_checkout_enabled,
          membership: byOffer.get(o.id) || null,
        };
      });
    return res.status(200).json({ offers: rows, attribution_days: settings.affiliate_attribution_days, partner: !!partner });
  } catch (error) {
    console.error('affiliate/offers error:', error);
    return res.status(500).json({ error: 'Could not load offers' });
  }
}
