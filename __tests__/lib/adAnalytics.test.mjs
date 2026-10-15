// Run: node --test __tests__/lib/adAnalytics.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  addDays, campaignTimeLeft, exposureSummary, isValidTimeZone, loadCampaignAnalytics, localDay, rangeWindow, summarizeAdEvents,
} from '../../lib/adAnalytics.js';

const NOW = Date.parse('2026-10-15T12:00:00Z');
const ev = (kind, placement, created_at) => ({ kind, placement, created_at });

function reconciles(summary) {
  const daily = summary.daily.reduce((s, d) => ({ i: s.i + d.impressions, c: s.c + d.clicks }), { i: 0, c: 0 });
  const places = summary.placements.reduce((s, p) => ({ i: s.i + p.impressions, c: s.c + p.clicks }), { i: 0, c: 0 });
  assert.equal(daily.i, summary.totals.impressions, 'daily impressions = totals');
  assert.equal(daily.c, summary.totals.clicks, 'daily clicks = totals');
  assert.equal(places.i, summary.totals.impressions, 'placement impressions = totals');
  assert.equal(places.c, summary.totals.clicks, 'placement clicks = totals');
}

const EVENTS = [
  ev('impression', 'home', '2026-10-15T09:00:00Z'),
  ev('impression', 'shop', '2026-10-15T10:00:00Z'),
  ev('click', 'shop', '2026-10-15T10:05:00Z'),
  ev('impression', 'search', '2026-10-13T08:00:00Z'),
  ev('impression', 'category', '2026-10-10T08:00:00Z'),
  ev('click', 'category', '2026-10-10T08:10:00Z'),
  ev('impression', 'home', '2026-09-20T08:00:00Z'), // outside 7d and 30d? (25 days ago - inside 30d)
  ev('impression', 'shop', '2026-08-01T08:00:00Z'), // outside 30d, inside lifetime
];

test('totals, daily series and placement breakdown reconcile for every range', () => {
  for (const range of ['7d', '30d', 'lifetime']) {
    const s = summarizeAdEvents(EVENTS, { range, timeZone: 'UTC', now: NOW, startsAt: '2026-08-01T00:00:00Z' });
    reconciles(s);
  }
});

test('7-day range covers exactly the last 7 calendar days and excludes older events', () => {
  const s = summarizeAdEvents(EVENTS, { range: '7d', timeZone: 'UTC', now: NOW });
  assert.equal(s.daily.length, 7);
  assert.equal(s.from, '2026-10-09');
  assert.equal(s.to, '2026-10-15');
  assert.deepEqual({ i: s.totals.impressions, c: s.totals.clicks }, { i: 4, c: 2 });
  assert.equal(s.daily.find((d) => d.date === '2026-10-15').impressions, 2);
  assert.equal(s.daily.find((d) => d.date === '2026-10-11').impressions, 0, 'days without events are real zeros');
});

test('30-day range includes the 25-day-old event but not the August one', () => {
  const s = summarizeAdEvents(EVENTS, { range: '30d', timeZone: 'UTC', now: NOW });
  assert.equal(s.daily.length, 30);
  assert.equal(s.totals.impressions, 5);
});

test('lifetime totals equal every recorded event (the campaign card totals)', () => {
  const s = summarizeAdEvents(EVENTS, { range: 'lifetime', timeZone: 'UTC', now: NOW, startsAt: '2026-09-01T00:00:00Z' });
  assert.equal(s.totals.impressions, 6);
  assert.equal(s.totals.clicks, 2);
  assert.deepEqual({ i: s.lifetime.impressions, c: s.lifetime.clicks }, { i: 6, c: 2 });
  assert.equal(s.from, '2026-08-01', 'widened to the earliest event even if before starts_at');
  reconciles(s);
});

test('lifetime of an ended campaign stops on its last day', () => {
  const s = summarizeAdEvents([ev('impression', 'home', '2026-10-02T10:00:00Z')], {
    range: 'lifetime', timeZone: 'UTC', now: NOW, startsAt: '2026-10-01T00:00:00Z', endsAt: '2026-10-04T00:00:00Z',
  });
  assert.equal(s.from, '2026-10-01');
  assert.equal(s.to, '2026-10-03');
  assert.equal(s.daily.length, 3);
});

test('CTR is clicks / impressions, and null (not 0 or Infinity) without impressions', () => {
  const s = summarizeAdEvents(EVENTS, { range: '7d', timeZone: 'UTC', now: NOW });
  assert.equal(s.totals.ctr, 0.5);
  const home = s.placements.find((p) => p.placement === 'home');
  assert.equal(home.ctr, 0);
  const empty = summarizeAdEvents([], { range: '7d', timeZone: 'UTC', now: NOW });
  assert.equal(empty.totals.ctr, null);
  assert.equal(empty.totals.impressions, 0);
});

test('events without a known placement are counted under "other" so totals still reconcile', () => {
  const s = summarizeAdEvents([ev('impression', null, '2026-10-15T09:00:00Z'), ev('impression', 'banner_x', '2026-10-15T09:00:00Z'), ev('impression', 'home', '2026-10-15T09:00:00Z')],
    { range: '7d', timeZone: 'UTC', now: NOW });
  assert.equal(s.placements.find((p) => p.placement === 'other').impressions, 2);
  reconciles(s);
  const clean = summarizeAdEvents(EVENTS, { range: '7d', timeZone: 'UTC', now: NOW });
  assert.equal(clean.placements.some((p) => p.placement === 'other'), false);
  assert.deepEqual(clean.placements.map((p) => p.placement), ['home', 'shop', 'search', 'category']);
});

test('days follow the viewer time zone (Lagos, New York, Kolkata half-hour offset)', () => {
  const late = ev('impression', 'home', '2026-10-14T23:30:00Z');
  const day = (tz) => summarizeAdEvents([late], { range: '7d', timeZone: tz, now: NOW }).daily.find((d) => d.impressions === 1).date;
  assert.equal(day('UTC'), '2026-10-14');
  assert.equal(day('Africa/Lagos'), '2026-10-15');
  assert.equal(day('America/New_York'), '2026-10-14');
  assert.equal(localDay('2026-10-14T18:45:00Z', 'Asia/Kolkata'), '2026-10-15', '18:45Z is 00:15 IST');
  assert.equal(localDay('2026-10-14T18:15:00Z', 'Asia/Kolkata'), '2026-10-14');
});

test('"today" depends on the time zone', () => {
  const justAfterMidnightLagos = Date.parse('2026-10-14T23:30:00Z');
  assert.equal(rangeWindow({ range: '7d', timeZone: 'Africa/Lagos', now: justAfterMidnightLagos }).to, '2026-10-15');
  assert.equal(rangeWindow({ range: '7d', timeZone: 'UTC', now: justAfterMidnightLagos }).to, '2026-10-14');
});

test('a daylight-saving change yields contiguous days with no duplicates or gaps', () => {
  const now = Date.parse('2026-11-05T12:00:00Z'); // US clocks went back on 2026-11-01
  const s = summarizeAdEvents([ev('impression', 'shop', '2026-11-01T05:30:00Z'), ev('impression', 'shop', '2026-11-01T06:30:00Z')],
    { range: '7d', timeZone: 'America/New_York', now });
  assert.deepEqual(s.daily.map((d) => d.date), ['2026-10-30', '2026-10-31', '2026-11-01', '2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05']);
  assert.equal(s.daily.find((d) => d.date === '2026-11-01').impressions, 2, '01:30 EDT and 01:30 EST are both Nov 1');
  assert.equal(addDays('2026-02-28', 1), '2026-03-01');
  assert.equal(addDays('2028-02-28', 1), '2028-02-29');
});

test('time zone validation', () => {
  assert.equal(isValidTimeZone('Africa/Lagos'), true);
  assert.equal(isValidTimeZone('Not/AZone'), false);
  assert.equal(isValidTimeZone(''), false);
  assert.equal(isValidTimeZone(undefined), false);
});

test('time left: live counts down, paused is frozen, unstarted shows the purchased duration, ended is zero', () => {
  assert.deepEqual(campaignTimeLeft({ status: 'active', starts_at: '2026-10-10T00:00:00Z', ends_at: '2026-10-16T13:30:00Z' }, 720, NOW),
    { remaining_ms: (25 * 60 + 30) * 60000, counting: true });
  assert.deepEqual(campaignTimeLeft({ status: 'paused', starts_at: '2026-10-10T00:00:00Z', ends_at: '2026-10-20T00:00:00Z', paused_at: '2026-10-14T00:00:00Z' }, 720, NOW),
    { remaining_ms: 6 * 86400000, counting: false });
  assert.deepEqual(campaignTimeLeft({ status: 'pending_review', starts_at: null, ends_at: null }, 72, NOW),
    { remaining_ms: 72 * 3600000, counting: false, not_started: true });
  assert.equal(campaignTimeLeft({ status: 'active', ends_at: '2026-10-15T11:00:00Z' }, 72, NOW).remaining_ms, 0);
  assert.equal(campaignTimeLeft({ status: 'rejected', starts_at: null }, 72, NOW).remaining_ms, 0);
});

test('relative exposure is priority over the entry package priority (Gold 80 vs Starter 10 = 8x weight)', () => {
  const ads = [10, 20, 30, 40, 50, 65, 80].map((priority) => ({ priority }));
  assert.deepEqual(exposureSummary(80, ads), { priority: 80, entry_priority: 10, top_priority: 80, relative_weight: 8 });
  assert.equal(exposureSummary(65, ads).relative_weight, 6.5);
  assert.equal(exposureSummary(10, ads).relative_weight, 1);
});

// ---------------------------------------------------------------------------
// Authorization: loadCampaignAnalytics with an in-memory Supabase stand-in
// ---------------------------------------------------------------------------

function fakeDb(tables, { ignoreOwnerFilter = false, maxRows = Infinity } = {}) {
  return {
    from(name) {
      const filters = [];
      let order = null;
      let span = null;
      const rows = () => {
        let out = (tables[name] || []).filter((row) => filters.every(([k, v]) => (ignoreOwnerFilter && k === 'owner_id') || row[k] === v));
        if (order) out = [...out].sort((a, b) => (a[order] > b[order] ? 1 : -1));
        if (span) out = out.slice(span[0], Math.min(span[1] + 1, span[0] + maxRows));
        return out;
      };
      const q = {
        select() { return q; },
        eq(k, v) { filters.push([k, v]); return q; },
        order(k) { order = k; return q; },
        range(a, b) { span = [a, b]; return q; },
        maybeSingle: async () => ({ data: rows()[0] || null, error: null }),
        then: (resolve) => resolve({ data: rows(), error: null }),
      };
      return q;
    },
  };
}

const OWNER = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const CAMPAIGN = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const TABLES = {
  advertising_campaigns: [{
    id: CAMPAIGN, owner_id: OWNER, kind: 'ad', package_id: 'gold_ads', entitlement_id: 'e1', title: 'Big sale',
    placements: ['home', 'shop', 'search', 'category'], priority: 80, status: 'active',
    starts_at: '2026-10-10T00:00:00Z', ends_at: '2026-11-09T00:00:00Z', paused_at: null, review_note: null,
  }],
  advertising_entitlements: [{ id: 'e1', package_snapshot: { name: 'Gold Ads', duration_hours: 720, max_creatives: 8, placements: ['home', 'shop', 'search', 'category'], priority: 80 } }],
  advertising_packages: [10, 20, 30, 40, 50, 65, 80].map((priority, i) => ({ id: `p${i}`, kind: 'ad', priority, is_active: true })),
  advertising_events: EVENTS.map((e, i) => ({ id: i + 1, campaign_id: CAMPAIGN, ...e })),
};

test('the owner gets their analytics with package exposure details', async () => {
  const r = await loadCampaignAnalytics(fakeDb(TABLES), { campaignId: CAMPAIGN, ownerId: OWNER, range: 'lifetime', now: NOW });
  assert.equal(r.campaign.title, 'Big sale');
  assert.equal(r.campaign.state, 'active');
  assert.equal(r.campaign.counting, true);
  assert.equal(r.package.name, 'Gold Ads');
  assert.equal(r.package.relative_weight, 8);
  assert.equal(r.analytics.totals.impressions, 6);
  reconciles(r.analytics);
});

test("another advertiser's campaign is indistinguishable from a missing one", async () => {
  assert.equal(await loadCampaignAnalytics(fakeDb(TABLES), { campaignId: CAMPAIGN, ownerId: OTHER, now: NOW }), null);
  assert.equal(await loadCampaignAnalytics(fakeDb(TABLES), { campaignId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', ownerId: OWNER, now: NOW }), null);
  assert.equal(await loadCampaignAnalytics(fakeDb(TABLES), { campaignId: CAMPAIGN, ownerId: '', now: NOW }), null);
});

test('ownership is re-checked even if the query filter were dropped (defence in depth)', async () => {
  const leaky = fakeDb(TABLES, { ignoreOwnerFilter: true });
  assert.equal(await loadCampaignAnalytics(leaky, { campaignId: CAMPAIGN, ownerId: OTHER, now: NOW }), null);
});

test('events are read in pages, so large campaigns are counted in full', async () => {
  const many = Array.from({ length: 2500 }, (_, i) => ({ id: i + 1, campaign_id: CAMPAIGN, kind: i % 10 ? 'impression' : 'click', placement: 'shop', created_at: '2026-10-15T09:00:00Z' }));
  const r = await loadCampaignAnalytics(fakeDb({ ...TABLES, advertising_events: many }), { campaignId: CAMPAIGN, ownerId: OWNER, range: '7d', now: NOW });
  assert.equal(r.analytics.totals.impressions + r.analytics.totals.clicks, 2500);
  assert.equal(r.analytics.totals.clicks, 250);
});

test('a server row cap below 1000 per request still counts every event', async () => {
  const many = Array.from({ length: 1234 }, (_, i) => ({ id: i + 1, campaign_id: CAMPAIGN, kind: 'impression', placement: 'home', created_at: '2026-10-15T09:00:00Z' }));
  const db = fakeDb({ ...TABLES, advertising_events: many }, { maxRows: 300 });
  const r = await loadCampaignAnalytics(db, { campaignId: CAMPAIGN, ownerId: OWNER, range: 'lifetime', now: NOW });
  assert.equal(r.analytics.totals.impressions, 1234);
  assert.equal(r.analytics.lifetime.impressions, 1234);
});

test('a campaign past its end date reports completed with no time left', async () => {
  const ended = { ...TABLES, advertising_campaigns: [{ ...TABLES.advertising_campaigns[0], ends_at: '2026-10-12T00:00:00Z' }] };
  const r = await loadCampaignAnalytics(fakeDb(ended), { campaignId: CAMPAIGN, ownerId: OWNER, now: NOW });
  assert.equal(r.campaign.state, 'completed');
  assert.equal(r.campaign.remaining_ms, 0);
});
