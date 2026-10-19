// Seller: set a listing's currency and price.
//   PATCH { item_id, currency, amount }   e.g. { currency: 'NGN', amount: '18000' }
// The price is stored exactly as entered (minor units) and never changed by
// exchange rates. The listing's payment methods follow the currency's route
// (NGN -> Paystack; every other currency -> USDT).
// Until P7 (multi-currency checkout) is live, only USD can be chosen: the
// current checkout charges price_usd.
// Digital products keep their Google Play / USD tier pricing.

import { requireParticipant } from '../../../lib/participantAuth';
import { currencyDb, getCurrencySettings, loadCurrencies, usableRates } from '../../../lib/marketplaceCurrency';
import { convertToUsdCents, minorToDecimal, validateListingPrice } from '../../../lib/currencyRules';
import { digitalItemIds } from '../../../lib/digitalGuard';

export default async function handler(req, res) {
  if (req.method !== 'PATCH') return res.status(405).json({ error: 'Method not allowed' });
  const participant = await requireParticipant(req, res);
  if (!participant) return;

  try {
    const { data: item, error } = await currencyDb.from('catalogue_items').select('id, seller_username, listing_currency, price_usd')
      .eq('id', String(req.body?.item_id || '')).maybeSingle();
    if (error) throw error;
    if (!item || item.seller_username !== participant.username) return res.status(404).json({ error: 'Listing not found' });
    if ((await digitalItemIds(currencyDb, [item.id])).has(String(item.id))) {
      return res.status(400).json({ error: 'Digital products are priced with the digital price tiers' });
    }

    const [settings, currencies] = await Promise.all([getCurrencySettings(), loadCurrencies({ enabledOnly: true })]);
    const checked = validateListingPrice({ currency: req.body?.currency, amount: req.body?.amount }, currencies);
    if (!checked.ok) return res.status(400).json({ error: checked.error });
    const { currency, minor } = checked;
    if (currency.code !== 'USD' && !settings.listing_currencies_enabled) {
      return res.status(403).json({ error: 'Listing in other currencies opens soon. For now, list in US dollars.', code: 'listing_currencies_disabled' });
    }

    // price_usd stays the exact price for USD listings; for other currencies it is
    // only an indicative equivalent for search and sorting (never charged).
    let priceUsd;
    if (currency.code === 'USD') priceUsd = Number(minorToDecimal(minor, 2));
    else {
      const rates = await usableRates([currency.code], settings).catch(() => null);
      priceUsd = rates ? Number(minorToDecimal(convertToUsdCents(minor, currency.minor_units, rates.get(currency.code).rate), 2)) : Number(item.price_usd);
    }
    const update = {
      listing_currency: currency.code,
      listing_price_minor: Number(minor),
      price_usd: priceUsd > 0 ? priceUsd : item.price_usd,
      updated_at: new Date().toISOString(),
    };
    // The payment route follows the currency once multi-currency checkout is live.
    // USD listings keep card and USDT.
    if (settings.listing_currencies_enabled) update.payment_methods = currency.code === 'USD' ? ['paystack', 'usdt'] : [currency.checkout_route];
    const { data, error: updateError } = await currencyDb.from('catalogue_items').update(update).eq('id', item.id)
      .select('id, listing_currency, listing_price_minor, price_usd, payment_methods').single();
    if (updateError) throw updateError;
    return res.status(200).json({
      item: { ...data, listing_price: minorToDecimal(data.listing_price_minor, currency.minor_units) },
      settlement_currency: currency.settlement_currency,
      checkout_route: currency.checkout_route,
    });
  } catch (error) {
    console.error('marketplace/listing-price error:', error);
    return res.status(500).json({ error: 'Could not update the price' });
  }
}
