// Brand network: ads for our other products (Book of Memes, Bascardo
// TaskMaster, Bascardo Oxygen, marketplace products), served from the Book of
// Memes hub. The hub already leaves One Dream's own products out (app=onedream).
//
// They are mixed into /api/ads/serve as house ads (house: true), so every app
// version and the website show them labelled "From One Dream" with no client
// change. Impressions and clicks reach /api/ads/event like any other ad, which
// forwards ids it does not own to the hub (recordBrandEvent).
//
// Serving needs no key. Managing the list does: BRAND_NETWORK_KEY is server-only
// and used by pages/api/admin/brand/[...path].js.

export const BRAND_HUB = 'https://api.bookofmemes.cc/api/brand';
export const BRAND_APP = 'onedream';

const HUB_TIMEOUT_MS = 1500;
const CACHE_MS = 60e3;
const FETCH_LIMIT = 3;

// One Dream slot -> hub placement.
const HUB_PLACEMENT = { home: 'home', shop: 'explore', search: 'search', category: 'explore' };

const cache = new Map(); // `${placement}|${platform}` -> { at, ads }

async function hubFetch(path, init = {}, timeoutMs = HUB_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(`${BRAND_HUB}${path}`, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/** android | ios | web, from ?platform= (new app versions) or the User-Agent. */
export function brandPlatform(req) {
  const explicit = String(req.query?.platform || '').toLowerCase();
  if (['android', 'ios', 'web'].includes(explicit)) return explicit;
  const ua = String(req.headers['user-agent'] || '');
  if (/okhttp|android/i.test(ua)) return 'android'; // RN fetch on Android sends okhttp/x
  if (/iphone|ipad|ipod|cfnetwork|darwin/i.test(ua)) return 'ios';
  return 'web';
}

const https = (u) => (typeof u === 'string' && /^https:\/\//i.test(u) ? u : null);

/** Hub ad -> the shape /api/ads/serve returns (see servedHouseAd in lib/houseAds.js). */
function toServed(a, platform) {
  const links = a.links || {};
  const url = https(links[platform]) || https(a.destination?.url) || https(links.web) || https(links.android) || https(links.ios);
  const media = (Array.isArray(a.media) ? a.media : [])
    .filter((m) => m && ['image', 'video'].includes(m.type) && https(m.url))
    .map((m) => ({ type: m.type, url: m.url, poster: https(m.poster), width: m.width ?? null, height: m.height ?? null }));
  if (!url || !media.length || !/^[0-9a-f-]{36}$/i.test(String(a.id || ''))) return null;
  const isStore = url !== https(links.web);
  return {
    id: a.id,
    house: true,
    brand: true,
    product_app: a.product_app || null,
    title: [a.name, a.title].filter(Boolean).join(': ').slice(0, 120) || 'Our apps',
    body: a.body || null,
    cta_label: a.cta_label || (isStore ? 'Download' : 'Visit'),
    destination: { type: 'external', url, listing_id: null, username: null },
    media,
    mode: a.mode === 'rotate' ? 'rotate' : 'fill',
    weight: Math.min(Math.max(Math.round(Number(a.weight) || 10), 1), 100),
  };
}

/**
 * Live brand-network ads for a One Dream placement. Never throws; an
 * unreachable hub means no brand ads, never a broken or slow page.
 */
export async function liveBrandAds(placement, platform) {
  if (process.env.BRAND_NETWORK_ENABLED === 'false') return [];
  const hubPlacement = HUB_PLACEMENT[placement];
  if (!hubPlacement) return [];
  const key = `${placement}|${platform}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.ads;
  let ads = [];
  try {
    const qs = new URLSearchParams({ app: BRAND_APP, placement: hubPlacement, limit: String(FETCH_LIMIT), platform });
    const r = await hubFetch(`/serve?${qs}`);
    const j = await r.json().catch(() => ({}));
    if (r.ok && j?.success && Array.isArray(j.data)) ads = j.data.map((a) => toServed(a, platform)).filter(Boolean);
  } catch (error) {
    if (error?.name !== 'AbortError') console.error('brand network unavailable:', error.message || error);
  }
  cache.set(key, { at: Date.now(), ads });
  return ads;
}

/** Forward an impression/click for a brand-network ad to the hub. Never throws. */
export async function recordBrandEvent(id, kind) {
  try {
    const r = await hubFetch('/event', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, app: BRAND_APP, kind }),
    });
    return r.ok;
  } catch {
    return false;
  }
}

/** Admin pass-through to the hub's product list (needs BRAND_NETWORK_KEY). */
export function brandAdminFetch(path, method, body) {
  return hubFetch(path, {
    method,
    headers: { 'Content-Type': 'application/json', 'X-Brand-Key': process.env.BRAND_NETWORK_KEY },
    body: method === 'GET' ? undefined : JSON.stringify(body || {}),
  }, 10e3);
}
