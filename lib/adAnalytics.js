// Advertiser analytics for one campaign, from the real advertising_events rows
// (impressions and clicks, already de-duplicated per viewer per hour by
// ads_record_event). Nothing is estimated or generated.
//
// Counting rule: an event belongs to the calendar day of its created_at in the
// viewer's time zone. The range totals, the daily series and the placement
// breakdown are all built from the same events, so they always reconcile:
// sum(daily) = sum(placements) = totals.
//
// Dependency-free so it runs under `node --test` (see __tests__/lib).

export const AD_PLACEMENTS = ['home', 'shop', 'search', 'category'];
export const ANALYTICS_RANGES = ['7d', '30d', 'lifetime'];
const DAY_MS = 86400000;
const MAX_LIFETIME_DAYS = 400;
const EVENT_PAGE = 1000;
const MAX_EVENT_PAGES = 200;

export function isValidTimeZone(timeZone) {
  if (typeof timeZone !== 'string' || !timeZone || timeZone.length > 64) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone });
    return true;
  } catch {
    return false;
  }
}

/** 'YYYY-MM-DD' of an instant in a time zone. */
export function localDay(instant, timeZone) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(new Date(instant));
  const get = (type) => parts.find((p) => p.type === type).value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

/** Calendar arithmetic on 'YYYY-MM-DD' strings (time-zone free). */
export function addDays(day, days) {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d) + days * DAY_MS).toISOString().slice(0, 10);
}

function daysBetween(from, to) {
  const out = [];
  for (let day = from; day <= to && out.length <= MAX_LIFETIME_DAYS; day = addDays(day, 1)) out.push(day);
  return out;
}

const ms = (value) => (value ? new Date(value).getTime() : null);
const ctrOf = (impressions, clicks) => (impressions > 0 ? clicks / impressions : null);
const minDay = (a, b) => (!a ? b : !b ? a : a < b ? a : b);
const maxDay = (a, b) => (!a ? b : !b ? a : a > b ? a : b);

/**
 * The calendar days a range covers. 7d / 30d end today (in the time zone);
 * lifetime runs from the campaign's first day (or first event) to its end
 * (or today, if still running), widened to include every recorded event so
 * lifetime totals always equal the campaign's all-time totals.
 */
export function rangeWindow({ range, timeZone, now, startsAt, endsAt, firstEventAt, lastEventAt }) {
  const today = localDay(now, timeZone);
  if (range === '7d') return { from: addDays(today, -6), to: today };
  if (range === '30d') return { from: addDays(today, -29), to: today };
  const end = ms(endsAt) && ms(endsAt) < now ? localDay(ms(endsAt) - 1, timeZone) : today;
  const from = minDay(startsAt ? localDay(startsAt, timeZone) : null, firstEventAt ? localDay(firstEventAt, timeZone) : null) || today;
  const to = maxDay(end, lastEventAt ? localDay(lastEventAt, timeZone) : null);
  return { from: from > to ? to : from, to };
}

/**
 * events: [{ kind: 'impression'|'click', placement, created_at }]
 * Returns { range, time_zone, from, to, totals, lifetime, daily, placements }.
 */
export function summarizeAdEvents(events, { range = '7d', timeZone = 'UTC', now = Date.now(), startsAt = null, endsAt = null } = {}) {
  const rows = (events || []).filter((e) => e && (e.kind === 'impression' || e.kind === 'click') && e.created_at);
  let firstEventAt = null;
  let lastEventAt = null;
  const lifetime = { impressions: 0, clicks: 0 };
  for (const e of rows) {
    const t = ms(e.created_at);
    if (firstEventAt === null || t < firstEventAt) firstEventAt = t;
    if (lastEventAt === null || t > lastEventAt) lastEventAt = t;
    lifetime[e.kind === 'impression' ? 'impressions' : 'clicks'] += 1;
  }

  const { from, to } = rangeWindow({ range, timeZone, now, startsAt, endsAt, firstEventAt, lastEventAt });
  const daily = new Map(daysBetween(from, to).map((day) => [day, { date: day, impressions: 0, clicks: 0 }]));
  const byPlacement = new Map([...AD_PLACEMENTS, 'other'].map((p) => [p, { placement: p, impressions: 0, clicks: 0 }]));
  const totals = { impressions: 0, clicks: 0 };

  for (const e of rows) {
    const day = localDay(e.created_at, timeZone);
    if (day < from || day > to) continue;
    const field = e.kind === 'impression' ? 'impressions' : 'clicks';
    const bucket = daily.get(day);
    if (!bucket) continue; // beyond the lifetime day cap; never happens for real campaigns
    bucket[field] += 1;
    byPlacement.get(AD_PLACEMENTS.includes(e.placement) ? e.placement : 'other')[field] += 1;
    totals[field] += 1;
  }

  const withCtr = (row) => ({ ...row, ctr: ctrOf(row.impressions, row.clicks) });
  return {
    range,
    time_zone: timeZone,
    from,
    to,
    totals: withCtr(totals),
    lifetime: withCtr(lifetime),
    daily: [...daily.values()],
    // "other" only appears if events were recorded without a known placement.
    placements: [...byPlacement.values()].filter((p) => p.placement !== 'other' || p.impressions || p.clicks).map(withCtr),
  };
}

/**
 * Time left on a campaign. Live: until ends_at. Paused for re-review: frozen
 * at the moment it paused (that time is given back on re-approval). Not yet
 * started: the full purchased duration. Ended: 0.
 */
export function campaignTimeLeft(campaign, durationHours, now = Date.now()) {
  const ends = ms(campaign?.ends_at);
  const status = campaign?.status;
  if (status === 'active' && ends) return { remaining_ms: Math.max(0, ends - now), counting: ends > now };
  if (status === 'paused' && ends) return { remaining_ms: Math.max(0, ends - (ms(campaign.paused_at) || now)), counting: false };
  if (['draft', 'pending_review'].includes(status) && !campaign?.starts_at) {
    return { remaining_ms: Math.max(0, Number(durationHours) || 0) * 3600000, counting: false, not_started: true };
  }
  return { remaining_ms: 0, counting: false };
}

/**
 * The relative selection weight of a package among packages of the same kind.
 * Priority sets the chance of being picked when campaigns compete for the
 * same placement - it is not a guarantee of views.
 */
export function exposureSummary(priority, sameKindPackages) {
  const priorities = (sameKindPackages || []).map((p) => Number(p.priority)).filter((p) => p > 0);
  const entry = priorities.length ? Math.min(...priorities) : Number(priority);
  const top = priorities.length ? Math.max(...priorities) : Number(priority);
  return {
    priority: Number(priority),
    entry_priority: entry,
    top_priority: top,
    relative_weight: entry > 0 ? Math.round((Number(priority) / entry) * 10) / 10 : null,
  };
}

/**
 * Loads one campaign's analytics for its owner. Returns null when the campaign
 * doesn't exist OR belongs to someone else (callers answer 404 either way, so
 * other advertisers' campaigns can't even be detected).
 * db: a Supabase client (adsDb in production, a fake in tests).
 */
export async function loadCampaignAnalytics(db, { campaignId, ownerId, range = '7d', timeZone = 'UTC', now = Date.now() }) {
  if (!campaignId || !ownerId) return null;
  const { data: campaign, error } = await db.from('advertising_campaigns')
    .select('id, owner_id, kind, package_id, entitlement_id, title, placements, priority, status, starts_at, ends_at, paused_at, submitted_at, review_note, created_at')
    .eq('id', campaignId)
    .eq('owner_id', ownerId)
    .maybeSingle();
  if (error) throw error;
  if (!campaign || campaign.owner_id !== ownerId) return null;

  const [entitlement, packages] = await Promise.all([
    db.from('advertising_entitlements').select('package_snapshot').eq('id', campaign.entitlement_id).maybeSingle(),
    db.from('advertising_packages').select('id, priority').eq('kind', campaign.kind).eq('is_active', true),
  ]);
  if (entitlement.error) throw entitlement.error;
  if (packages.error) throw packages.error;

  // Advance by the rows actually returned and stop only on an empty page, so a
  // server row cap below EVENT_PAGE can never cut the count short.
  const events = [];
  for (let page = 0, offset = 0; page < MAX_EVENT_PAGES; page += 1) {
    const { data, error: eventsError } = await db.from('advertising_events')
      .select('kind, placement, created_at')
      .eq('campaign_id', campaign.id)
      .order('id', { ascending: true })
      .range(offset, offset + EVENT_PAGE - 1);
    if (eventsError) throw eventsError;
    if (!data?.length) break;
    events.push(...data);
    offset += data.length;
  }

  const snapshot = entitlement.data?.package_snapshot || {};
  const status = campaign.status === 'active' && ms(campaign.ends_at) && ms(campaign.ends_at) <= now ? 'completed' : campaign.status;
  return {
    campaign: {
      id: campaign.id,
      kind: campaign.kind,
      title: campaign.title,
      state: status,
      review_note: campaign.review_note,
      submitted_at: campaign.submitted_at,
      starts_at: campaign.starts_at,
      ends_at: campaign.ends_at,
      ...campaignTimeLeft(campaign, snapshot.duration_hours, now),
    },
    package: {
      id: campaign.package_id,
      name: snapshot.name || campaign.package_id,
      duration_hours: snapshot.duration_hours ?? null,
      max_creatives: snapshot.max_creatives ?? null,
      placements: campaign.placements?.length ? campaign.placements : snapshot.placements || [],
      ...exposureSummary(campaign.priority ?? snapshot.priority, packages.data),
    },
    analytics: summarizeAdEvents(events, { range, timeZone, now, startsAt: campaign.starts_at, endsAt: campaign.ends_at }),
    server_now: new Date(now).toISOString(),
  };
}
