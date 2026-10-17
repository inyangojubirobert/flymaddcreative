// Seller side: put your own listings on the affiliate marketplace.
//   GET  -> { listings: [{ item, offer, impact }], platform_percent, max_commission_percent }
//   POST { item_id, ...offer fields, accept_terms: true }   create or update the offer for one listing
// A seller-funded offer shows its financial impact and only goes live once
// the seller accepts it; any change to the money terms needs a new
// acceptance (terms_version), and partners keep the version they joined on.

import { earningsDb, getEarningsSettings, must, requireParty } from '../../../../lib/earnings';
import { sellerCommissionPercent } from '../../../../lib/sellerEarnings';
import { sellerFundedImpact, validateOffer } from '../../../../lib/earningsRules';

const MONEY_FIELDS = ['funding', 'commission_percent', 'allow_resale', 'resale_floor_usd', 'resale_ceiling_usd', 'fulfilment'];

export default async function handler(req, res) {
  const party = await requireParty(req, res);
  if (!party) return;
  if (party.party_type !== 'participant') return res.status(403).json({ error: 'Sign in with the account that owns the listings' });
  const username = party.participant.username;

  try {
    const [settings, platformPercent] = await Promise.all([getEarningsSettings(), sellerCommissionPercent(earningsDb)]);
    if (req.method === 'GET') {
      const items = must(await earningsDb.from('catalogue_items').select('id, title, price_usd, images, status, listing_type')
        .eq('seller_username', username).order('created_at', { ascending: false }).limit(200));
      const offers = items.length ? must(await earningsDb.from('affiliate_offers').select('*').in('item_id', items.map((i) => i.id))) : [];
      const byItem = new Map(offers.map((o) => [o.item_id, o]));
      return res.status(200).json({
        platform_percent: platformPercent,
        max_commission_percent: Number(settings.affiliate_max_commission_percent),
        seller_funded_payable: settings.seller_funded_settlement_enabled,
        resale_checkout_live: settings.resale_checkout_enabled,
        listings: items.map((item) => {
          const offer = byItem.get(item.id) || null;
          return {
            item: { ...item, price_usd: Number(item.price_usd), image: Array.isArray(item.images) ? item.images[0] : null },
            offer,
            impact: sellerFundedImpact(item.price_usd, offer ? Number(offer.commission_percent) : 10, platformPercent),
          };
        }),
      });
    }

    if (req.method === 'POST') {
      const item = must(await earningsDb.from('catalogue_items').select('id, seller_username, price_usd, status')
        .eq('id', String(req.body?.item_id || '')).maybeSingle());
      if (!item || item.seller_username !== username) return res.status(404).json({ error: 'Listing not found' });
      const checked = validateOffer(req.body || {}, { maxCommissionPercent: Number(settings.affiliate_max_commission_percent), itemPriceUsd: Number(item.price_usd) });
      if (!checked.ok) return res.status(400).json({ error: checked.error });
      const value = checked.value;
      if (value.funding === 'platform') {
        // Platform-funded campaigns are switched on by One Dream, not by sellers.
        return res.status(403).json({ error: 'Promotion bonuses paid by One Dream are set up by the One Dream team' });
      }
      if (value.allow_resale && value.resale_floor_usd > Number(item.price_usd)) {
        return res.status(400).json({ error: 'The resale floor cannot be above your own listing price' });
      }

      const existing = must(await earningsDb.from('affiliate_offers').select('*').eq('item_id', item.id).maybeSingle());
      const moneyChanged = !existing || MONEY_FIELDS.some((k) => String(existing[k] ?? '') !== String(value[k] ?? ''));
      const termsVersion = existing ? existing.terms_version + (moneyChanged ? 1 : 0) : 1;
      if (req.body?.accept_terms !== true && (moneyChanged || existing?.seller_accepted_terms_version !== termsVersion)) {
        return res.status(400).json({
          error: 'Confirm the commission before publishing',
          code: 'accept_terms_required',
          impact: sellerFundedImpact(item.price_usd, value.commission_percent, platformPercent),
        });
      }
      const row = {
        ...value,
        item_id: item.id,
        seller_username: username,
        terms_version: termsVersion,
        seller_accepted_terms_version: termsVersion,
        seller_accepted_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      const data = existing
        ? must(await earningsDb.from('affiliate_offers').update(row).eq('id', existing.id).select('*').single())
        : must(await earningsDb.from('affiliate_offers').insert(row).select('*').single());
      return res.status(existing ? 200 : 201).json({
        offer: data,
        impact: sellerFundedImpact(item.price_usd, value.commission_percent, platformPercent),
        note: settings.seller_funded_settlement_enabled ? null
          : 'Sales are tracked now. Seller-funded commission starts being deducted and paid once One Dream switches on seller-funded settlement.',
      });
    }
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (error) {
    console.error('affiliate/seller/offers error:', error);
    return res.status(500).json({ error: 'Could not update your affiliate offers' });
  }
}
