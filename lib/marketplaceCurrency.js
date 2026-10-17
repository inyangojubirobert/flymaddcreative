// Multi-currency marketplace I/O: currencies, timestamped exchange rates,
// checkout quotes. Maths: lib/currencyRules.js. Schema:
// supabase/add_multicurrency_listings.sql.
//
// Rates come from open.er-api.com (the same source the existing Paystack
// conversion uses), with the provider's own publication time. A rate older
// than currency_settings.max_rate_age_seconds, or one that jumps more than
// max_rate_jump_percent from the last stored value, is never used for a
// payment quote - the quote fails instead (no hardcoded fallback rate).
//
// This module does not touch checkout. Quotes are stored in checkout_quotes;
// the protected checkout routes start honouring them only once P7 is applied
// (docs/protected-patches/P7_multicurrency_checkout.diff).

import { createClient } from '@supabase/supabase-js';
import { buyerFeePolicy, toCents } from './marketplaceFees';
import { digitalItemIds } from './digitalGuard';
import { buildQuote, parseRate, rateJumpTooLarge, rateProblem } from './currencyRules';

export const currencyDb = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

const RATES_API = 'https://open.er-api.com/v6/latest/USD';
const SOURCE = 'open.er-api.com';

const must = ({ data, error }) => {
  if (error) throw error;
  return data;
};

export async function getCurrencySettings() {
  return must(await currencyDb.from('currency_settings').select('*').eq('id', true).single());
}

export async function loadCurrencies({ enabledOnly = false } = {}) {
  let query = currencyDb.from('marketplace_currencies').select('*').order('sort_order');
  if (enabledOnly) query = query.eq('is_enabled', true);
  const rows = must(await query) || [];
  return new Map(rows.map((c) => [c.code, c]));
}

async function latestStored(code) {
  return must(await currencyDb.from('currency_rates').select('id, quote, rate, source, source_published_at, fetched_at')
    .eq('quote', code).order('source_published_at', { ascending: false }).limit(1).maybeSingle());
}

/**
 * Fetches the provider's current rates and stores any new publication for the
 * enabled currencies. Refuses (does not store) a rate that jumped too far.
 * Returns { stored, refused, published_at }.
 */
export async function refreshRates(settings) {
  const response = await fetch(RATES_API);
  if (!response.ok) throw new Error(`rates_provider_${response.status}`);
  const data = await response.json();
  if (data?.result !== 'success' || !data.rates || !data.time_last_update_unix) throw new Error('rates_provider_invalid');
  const publishedAt = new Date(data.time_last_update_unix * 1000).toISOString();
  const currencies = await loadCurrencies({ enabledOnly: true });
  const stored = [];
  const refused = [];
  for (const code of currencies.keys()) {
    if (code === 'USD') continue;
    const value = data.rates[code];
    if (typeof value !== 'number' || !parseRate(value)) { refused.push({ code, reason: 'missing' }); continue; }
    const previous = await latestStored(code);
    if (previous && new Date(previous.source_published_at).getTime() >= new Date(publishedAt).getTime()) continue;
    if (rateJumpTooLarge(previous?.rate, value, settings.max_rate_jump_percent)) {
      refused.push({ code, reason: 'jump', previous: Number(previous.rate), next: value });
      console.error(`[currency] refused ${code} rate ${value} (previous ${previous.rate}): moved more than ${settings.max_rate_jump_percent}%`);
      continue;
    }
    const { error } = await currencyDb.from('currency_rates').insert({
      quote: code, rate: value.toFixed(12), source: SOURCE, source_published_at: publishedAt,
    });
    if (error && error.code !== '23505') throw error;
    stored.push(code);
  }
  return { stored, refused, published_at: publishedAt };
}

/**
 * Current usable rates for the given currencies (Map code -> row). Refreshes
 * from the provider when the stored rate is too old; throws `rate_unavailable`
 * / `rate_stale` rather than returning a rate that must not be used.
 */
export async function usableRates(codes, settings) {
  const needed = [...new Set(codes)].filter((c) => c !== 'USD');
  const out = new Map();
  let refreshed = false;
  for (const code of needed) {
    let row = await latestStored(code);
    if (rateProblem(row, settings.max_rate_age_seconds) && !refreshed) {
      refreshed = true;
      await refreshRates(settings).catch((error) => console.error('[currency] refresh failed:', error.message));
      row = await latestStored(code);
    }
    const problem = rateProblem(row, settings.max_rate_age_seconds);
    if (problem) { const err = new Error(`${problem}:${code}`); err.code = problem; throw err; }
    out.set(code, row);
  }
  return out;
}

/** Latest stored rates for display only (may be older than the payment limit). */
export async function displayRates() {
  const currencies = await loadCurrencies({ enabledOnly: true });
  const out = {};
  for (const code of currencies.keys()) {
    if (code === 'USD') continue;
    const row = await latestStored(code);
    if (row) out[code] = { rate: String(row.rate), published_at: row.source_published_at, source: row.source };
  }
  return out;
}

/** Commission and buyer fee policy from marketplace_fee_settings (read only). */
export async function quotePolicy() {
  const policy = await buyerFeePolicy(currencyDb);
  return {
    commission_percent: policy.sellerCommissionPercent,
    buyer_fee_percent: policy.percent,
    buyer_fee_cap_usd_cents: policy.capUsd === null || policy.capUsd === undefined ? null : toCents(policy.capUsd),
  };
}

/**
 * Prices cart lines into a stored, expiring quote (one checkout currency).
 * lines: [{ item_id, quantity }]. Listing currency and price are read from
 * catalogue_items on the server; nothing price-related comes from the client.
 * Idempotent per client_key: an open, unexpired quote is returned as-is.
 */
/**
 * Prices cart lines (one checkout currency) without storing anything.
 * lines: [{ item_id, quantity }]. Listing currency and price are read from
 * catalogue_items on the server; nothing price-related comes from the client.
 */
export async function previewQuote(lines) {
  const settings = await getCurrencySettings();
  const currencies = await loadCurrencies({ enabledOnly: true });
  const items = must(await currencyDb.from('catalogue_items').select('id, seller_username, status, listing_currency, listing_price_minor, price_usd')
    .in('id', lines.map((l) => l.item_id))) || [];
  const byId = new Map(items.map((i) => [i.id, i]));
  // Digital products are sold through Google Play / digital checkout, never here.
  const digital = await digitalItemIds(currencyDb, lines.map((l) => l.item_id));
  if (lines.some((l) => digital.has(String(l.item_id)))) { const err = new Error('digital_item'); err.code = 'digital_item'; throw err; }
  const priced = lines.map((l) => {
    const item = byId.get(l.item_id);
    if (!item || item.status !== 'active') { const err = new Error(`listing_unavailable:${l.item_id}`); err.code = 'listing_unavailable'; throw err; }
    const minor = item.listing_price_minor ?? (item.listing_currency === 'USD' ? Math.round(Number(item.price_usd) * 100) : null);
    if (!minor) { const err = new Error(`listing_unpriced:${l.item_id}`); err.code = 'listing_unpriced'; throw err; }
    return { item_id: item.id, quantity: l.quantity, listing_currency: item.listing_currency, listing_unit_minor: String(minor), seller_username: item.seller_username };
  });
  const needRates = priced.map((l) => l.listing_currency);
  if (priced.some((l) => currencies.get(l.listing_currency)?.settlement_currency === 'NGN')) needRates.push('NGN'); // fee cap and USD reporting
  const rates = await usableRates(needRates, settings);
  const body = buildQuote({ lines: priced, currencies, rates, policy: await quotePolicy() });
  const ttl = body.checkout_route === 'usdt' ? settings.usdt_quote_ttl_seconds : settings.quote_ttl_seconds;
  return { body, ttl };
}

/** Stores a quote with an expiry. Idempotent per client_key: an open, unexpired quote is returned as-is. */
export async function createQuote({ lines, clientKey }) {
  const existing = must(await currencyDb.from('checkout_quotes').select('*').eq('client_key', clientKey).maybeSingle());
  if (existing && existing.status === 'open' && new Date(existing.expires_at).getTime() > Date.now()) return { quote: existing, reused: true };
  if (existing) { const err = new Error('quote_key_used'); err.code = 'quote_key_used'; throw err; }
  const { body, ttl } = await previewQuote(lines);
  const row = must(await currencyDb.from('checkout_quotes').insert({
    client_key: clientKey,
    checkout_currency: body.checkout_currency,
    checkout_route: body.checkout_route,
    lines: body.lines,
    subtotal_minor: body.subtotal_minor,
    service_fee_minor: body.service_fee_minor,
    total_minor: body.total_minor,
    rates: body.rates,
    expires_at: new Date(Date.now() + ttl * 1000).toISOString(),
  }).select('*').single());
  return { quote: row, reused: false };
}

export const QUOTE_ERRORS = {
  mixed_checkout_currencies: [409, 'Naira listings and listings in other currencies are paid separately. Check out each group on its own.'],
  rate_unavailable: [503, 'Exchange rates are unavailable right now. Please try again shortly.'],
  rate_stale: [503, 'Exchange rates are being updated. Please try again shortly.'],
  rate_invalid: [503, 'Exchange rates are unavailable right now. Please try again shortly.'],
  listing_unavailable: [409, 'A listing in your cart is no longer available.'],
  listing_unpriced: [409, 'A listing in your cart has no price.'],
  quote_key_used: [409, 'This quote has expired. Refresh to get a new one.'],
  amount_too_small: [400, 'This amount is too small to convert.'],
  digital_item: [400, 'Digital products are bought from their own page.'],
};
export function quoteErrorReply(error) {
  const key = Object.keys(QUOTE_ERRORS).find((k) => String(error?.code || error?.message || '').startsWith(k));
  if (!key) return null;
  const [status, message] = QUOTE_ERRORS[key];
  return { status, body: { error: message, code: key, groups: error.groups } };
}
