// Brand network (our other apps' ads from the Book of Memes hub), with a
// mocked hub. node --test scripts/test-brand-network.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { brandPlatform, liveBrandAds, recordBrandEvent } from '../lib/brandNetwork.js';

const AD = {
  id: '11111111-2222-3333-4444-555555555555',
  brand: true,
  product_app: 'bookofmemes',
  name: 'Book of Memes',
  title: 'Create stories with AI',
  body: 'Books and videos',
  links: { android: 'https://play.google.com/x', ios: null, web: 'https://bookofmemes.cc' },
  destination: { type: 'external', url: 'https://play.google.com/x' },
  media: [{ type: 'video', url: 'https://res.cloudinary.com/a.mp4', poster: 'https://res.cloudinary.com/a.jpg' }],
};
const realFetch = globalThis.fetch;
const hub = (data) => {
  const calls = [];
  globalThis.fetch = async (url, init) => { calls.push({ url, init }); return { ok: true, status: 200, json: async () => ({ success: true, data }) }; };
  return calls;
};
test.afterEach(() => { globalThis.fetch = realFetch; });

test('hub ads become served house ads; bad rows dropped; cached per placement and platform', async () => {
  const calls = hub([AD, { ...AD, id: 'not-a-uuid' }, { ...AD, id: AD.id.replace('1', '9'), media: [] }]);
  const ads = await liveBrandAds('shop', 'android');
  assert.match(calls[0].url, /app=onedream&placement=explore&limit=3&platform=android/);
  assert.equal(ads.length, 1);
  assert.equal(ads[0].house, true);
  assert.equal(ads[0].title, 'Book of Memes: Create stories with AI');
  assert.deepEqual(ads[0].destination, { type: 'external', url: 'https://play.google.com/x', listing_id: null, username: null });
  assert.equal(ads[0].cta_label, 'Download');
  assert.equal(ads[0].mode, 'fill');
  await liveBrandAds('shop', 'android');
  assert.equal(calls.length, 1, 'second call served from cache');
});

test('web gets the website link and a Visit button; unknown placement asks nothing', async () => {
  const calls = hub([AD]);
  const [ad] = await liveBrandAds('home', 'web');
  assert.equal(ad.destination.url, 'https://bookofmemes.cc');
  assert.equal(ad.cta_label, 'Visit');
  assert.deepEqual(await liveBrandAds('sidebar', 'web'), []);
  assert.equal(calls.length, 1);
});

test('a hub that is down means no brand ads and no error', async () => {
  globalThis.fetch = async () => { throw new Error('down'); };
  assert.deepEqual(await liveBrandAds('search', 'ios'), []);
  assert.equal(await recordBrandEvent(AD.id, 'click'), false);
});

test('events go to the hub as app=onedream', async () => {
  const calls = hub([]);
  assert.equal(await recordBrandEvent(AD.id, 'impression'), true);
  assert.match(calls[0].url, /\/api\/brand\/event$/);
  assert.deepEqual(JSON.parse(calls[0].init.body), { id: AD.id, app: 'onedream', kind: 'impression' });
});

test('platform from ?platform= or the user agent', () => {
  assert.equal(brandPlatform({ query: { platform: 'ios' }, headers: {} }), 'ios');
  assert.equal(brandPlatform({ query: {}, headers: { 'user-agent': 'okhttp/4.12.0' } }), 'android');
  assert.equal(brandPlatform({ query: {}, headers: { 'user-agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0)' } }), 'ios');
  assert.equal(brandPlatform({ query: {}, headers: { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0)' } }), 'web');
});
