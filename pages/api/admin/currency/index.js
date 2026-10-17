// Admin: marketplace currencies, rates, settings and recent quotes/snapshots.
//   GET                                         overview
//   POST  { action: 'refresh_rates' }           fetch the provider now
//   POST  { action: 'save_currency', code, name, symbol, minor_units, is_enabled, sort_order }
//         (new currencies always check out in USDT and settle in USD; NGN is the only Paystack currency)
//   PATCH { listing_currencies_enabled?, quote_ttl_seconds?, usdt_quote_ttl_seconds?, max_rate_age_seconds?, max_rate_jump_percent? }
//   GET with Authorization: Bearer <CRON_SECRET>   daily rate refresh (vercel.json)
// listing_currencies_enabled must only be switched on together with P7 + P8:
// switching it on needs confirm: 'P7_P8_APPLIED' and refuses while P8's
// column is missing.

import { requireActiveAdmin } from '../../../../lib/adminAuth';
import { auditEarnings } from '../../../../lib/earnings';
import { currencyDb, displayRates, getCurrencySettings, loadCurrencies, refreshRates } from '../../../../lib/marketplaceCurrency';

const must = ({ data, error }) => {
  if (error) throw error;
  return data;
};

export default async function handler(req, res) {
  const cronSecret = process.env.CRON_SECRET;
  const isCron = cronSecret && req.headers.authorization === `Bearer ${cronSecret}`;
  try {
    if (isCron && req.method === 'GET') {
      return res.status(200).json(await refreshRates(await getCurrencySettings()));
    }
    const admin = await requireActiveAdmin(req, res, currencyDb);
    if (!admin) return;

    if (req.method === 'GET') {
      const [settings, currencies, rates, quotes, snapshots] = await Promise.all([
        getCurrencySettings(), loadCurrencies(), displayRates(),
        currencyDb.from('checkout_quotes').select('id, checkout_currency, checkout_route, total_minor, status, quoted_at, expires_at, payment_ref')
          .order('quoted_at', { ascending: false }).limit(50).then(must),
        currencyDb.from('order_financial_snapshots').select('*').order('created_at', { ascending: false }).limit(50).then(must),
      ]);
      const history = must(await currencyDb.from('currency_rates').select('quote, rate, source, source_published_at, fetched_at')
        .order('source_published_at', { ascending: false }).limit(60));
      return res.status(200).json({ settings, currencies: [...currencies.values()], rates, history, quotes, snapshots });
    }

    if (req.method === 'POST' && req.body?.action === 'refresh_rates') {
      const result = await refreshRates(await getCurrencySettings());
      await auditEarnings(admin.id, 'refresh_rates', 'currency_rates', null, result);
      return res.status(200).json(result);
    }

    if (req.method === 'POST' && req.body?.action === 'save_currency') {
      const b = req.body;
      const code = String(b.code || '').toUpperCase();
      if (!/^[A-Z]{3}$/.test(code)) return res.status(400).json({ error: 'code: 3 letters (ISO 4217)' });
      const row = {
        code,
        name: String(b.name || code).slice(0, 60),
        symbol: String(b.symbol || code).slice(0, 6),
        minor_units: Number.isInteger(Number(b.minor_units)) ? Number(b.minor_units) : 2,
        is_enabled: b.is_enabled !== false,
        sort_order: Number.isInteger(Number(b.sort_order)) ? Number(b.sort_order) : 100,
        // Only NGN goes through Paystack today; every other currency is paid in USDT.
        checkout_route: code === 'NGN' ? 'paystack' : 'usdt',
        settlement_currency: code === 'NGN' ? 'NGN' : 'USD',
      };
      const { data, error } = await currencyDb.from('marketplace_currencies').upsert(row, { onConflict: 'code' }).select('*').single();
      if (error) return res.status(400).json({ error: error.message });
      await auditEarnings(admin.id, 'save_currency', 'marketplace_currency', code, row);
      return res.status(200).json({ currency: data });
    }

    if (req.method === 'PATCH') {
      const b = req.body || {};
      const patch = {};
      if (typeof b.listing_currencies_enabled === 'boolean') patch.listing_currencies_enabled = b.listing_currencies_enabled;
      if (patch.listing_currencies_enabled) {
        // Switching on changes how buyers pay: only with P7 deployed and P8
        // (the USD wallet that leaves naira sales out) applied.
        if (b.confirm !== 'P7_P8_APPLIED') return res.status(400).json({ error: 'Confirm that protected patches P7 and P8 are applied' });
        const { error: p8Missing } = await currencyDb.from('participant_withdrawals').select('currency').limit(1);
        if (p8Missing) return res.status(409).json({ error: 'P8 is not applied: participant_withdrawals.currency is missing' });
      }
      for (const [key, min, max] of [['quote_ttl_seconds', 60, 86400], ['usdt_quote_ttl_seconds', 60, 86400], ['max_rate_age_seconds', 60, 604800]]) {
        if (b[key] !== undefined) {
          const v = Number(b[key]);
          if (!Number.isInteger(v) || v < min || v > max) return res.status(400).json({ error: `${key}: ${min}-${max}` });
          patch[key] = v;
        }
      }
      if (b.max_rate_jump_percent !== undefined) {
        const v = Number(b.max_rate_jump_percent);
        if (!(v >= 1 && v <= 100)) return res.status(400).json({ error: 'max_rate_jump_percent: 1-100' });
        patch.max_rate_jump_percent = v;
      }
      if (!Object.keys(patch).length) return res.status(400).json({ error: 'Nothing to change' });
      const data = must(await currencyDb.from('currency_settings').update({ ...patch, updated_at: new Date().toISOString(), updated_by: admin.id })
        .eq('id', true).select('*').single());
      await auditEarnings(admin.id, 'update_currency_settings', 'currency_settings', 'singleton', patch);
      return res.status(200).json({ settings: data });
    }
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (error) {
    console.error('admin/currency error:', error.message || error);
    return res.status(500).json({ error: 'Currency update failed' });
  }
}
