// Live USD -> NGN conversion for Paystack (NGN-only) payments.
// Paystack deposits are always charged in Naira; every USD-denominated price
// in the app must be converted through this module instead of a hardcoded rate.
//
// Caching: an in-memory cache survives within one warm serverless instance,
// and a Supabase-backed cache (`exchange_rates` table) survives cold starts
// so we don't hammer the free open.er-api.com endpoint on every request.

import { createClient } from '@supabase/supabase-js';

const EXCHANGE_RATE_API = 'https://open.er-api.com/v6/latest/USD';
const FALLBACK_NGN_RATE = 1600; // last-resort value if live + cached rates are both unavailable
const CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes

let memCache = { rate: null, fetchedAt: 0 };

function getSupabase() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key);
}

async function fetchLiveRate() {
  const res = await fetch(EXCHANGE_RATE_API);
  if (!res.ok) throw new Error(`Exchange rate API responded ${res.status}`);
  const data = await res.json();
  const rate = data?.rates?.NGN;
  if (!rate || typeof rate !== 'number') throw new Error('NGN rate missing from exchange rate response');
  return rate;
}

async function getCachedDbRate(supabase) {
  const { data, error } = await supabase
    .from('exchange_rates')
    .select('rate, fetched_at')
    .eq('base', 'USD')
    .eq('target', 'NGN')
    .order('fetched_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error('[currency] failed to read cached rate:', error.message);
    return null;
  }
  return data;
}

/**
 * Returns the current USD -> NGN rate, live from open.er-api.com when the
 * cache (memory or DB) is older than CACHE_TTL_MS, falling back to the most
 * recent value available (DB cache, memory cache, then a hardcoded rate).
 */
export async function getUsdToNgnRate() {
  const now = Date.now();
  if (memCache.rate && (now - memCache.fetchedAt) < CACHE_TTL_MS) {
    return memCache.rate;
  }

  const supabase = getSupabase();
  const dbRate = supabase ? await getCachedDbRate(supabase) : null;

  if (dbRate && (now - new Date(dbRate.fetched_at).getTime()) < CACHE_TTL_MS) {
    memCache = { rate: dbRate.rate, fetchedAt: now };
    return dbRate.rate;
  }

  try {
    const rate = await fetchLiveRate();
    memCache = { rate, fetchedAt: now };
    if (supabase) {
      supabase.from('exchange_rates').insert({ base: 'USD', target: 'NGN', rate, fetched_at: new Date().toISOString() })
        .then(({ error }) => { if (error) console.error('[currency] failed to persist rate:', error.message); });
    }
    return rate;
  } catch (error) {
    console.error('[currency] live rate fetch failed, using fallback:', error.message);
    if (dbRate) return dbRate.rate; // stale-but-real rate beats a hardcoded guess
    if (memCache.rate) return memCache.rate;
    return FALLBACK_NGN_RATE;
  }
}

export function usdToNgn(usdAmount, rate) {
  return Math.round(usdAmount * rate * 100) / 100;
}

export function usdToKobo(usdAmount, rate) {
  return Math.round(usdAmount * rate * 100);
}

export function ngnKoboToUsd(kobo, rate) {
  return (kobo / 100) / rate;
}
