// Public: listing currencies, how each one is paid and settled, and the latest
// published rates for showing equivalents. Display only - a payment always
// uses a checkout quote (quote.js).
//   GET -> { currencies, rates, listing_currencies_enabled }

import { displayRates, getCurrencySettings, loadCurrencies } from '../../../lib/marketplaceCurrency';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  try {
    const [currencies, rates, settings] = await Promise.all([loadCurrencies({ enabledOnly: true }), displayRates(), getCurrencySettings()]);
    res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=900');
    return res.status(200).json({
      listing_currencies_enabled: settings.listing_currencies_enabled,
      currencies: [...currencies.values()].map((c) => ({
        code: c.code, name: c.name, symbol: c.symbol, minor_units: c.minor_units,
        checkout_route: c.checkout_route, settlement_currency: c.settlement_currency,
        // What a seller is told before choosing it.
        explanation: c.checkout_route === 'paystack'
          ? 'Buyers pay in naira by card or bank (Paystack). You are paid in naira.'
          : c.code === 'USD'
            ? 'Buyers pay in USDT. You are paid in US dollars.'
            : `Your price stays in ${c.code}. Buyers pay the US-dollar equivalent in USDT, converted once when they check out. You are paid in US dollars.`,
      })),
      rates,
    });
  } catch (error) {
    console.error('marketplace/currencies error:', error);
    return res.status(500).json({ error: 'Could not load currencies' });
  }
}
