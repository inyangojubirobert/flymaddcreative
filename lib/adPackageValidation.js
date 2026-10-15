// Ascending package value: a more expensive package should never offer less
// than a cheaper one of the same kind (ads vs boosts are compared separately).
// Compares every cheaper package, not just the neighbour, and compares
// placement SETS (a package can have as many placements but not the same ones).
//
// Only warns - never changes packages, prices or entitlements. An admin can
// mark a warning as intentional; the exception is tied to both packages' full
// terms (signature), so it lapses as soon as either package changes at all.
//
// Dependency-free so it runs under `node --test` (see __tests__/lib).

const PLACEMENT_NAMES = { home: 'Home', shop: 'Shop', search: 'Search', category: 'Category' };
const money = (value) => `$${Number(value).toLocaleString('en-US', { minimumFractionDigits: Number(value) % 1 ? 2 : 0, maximumFractionDigits: 2 })}`;
const hours = (h) => (h % 24 === 0 ? `${h / 24} day${h === 24 ? '' : 's'}` : `${h} hours`);
const placementList = (list) => list.map((p) => PLACEMENT_NAMES[p] || p).join(', ');
const label = (p) => `${p.name} (${money(p.price_usd)})`;
const terms = (p) => [Number(p.price_usd), p.duration_hours, p.max_creatives, p.priority, [...(p.placements || [])].sort().join('+')].join('/');

export function warningKey(w) {
  return `${w.package_id}|${w.compared_package_id}|${w.rule}`;
}

/** packages: rows of advertising_packages. Returns warnings, most expensive first. */
export function validatePackageLadder(packages, { includeInactive = false } = {}) {
  const warnings = [];
  const pool = (packages || []).filter((p) => includeInactive || p.is_active);
  for (const kind of ['ad', 'boost']) {
    const ladder = pool.filter((p) => p.kind === kind).sort((a, b) => Number(a.price_usd) - Number(b.price_usd));
    for (let j = ladder.length - 1; j > 0; j -= 1) {
      const dear = ladder[j];
      for (let i = 0; i < j; i += 1) {
        const cheap = ladder[i];
        if (!(Number(dear.price_usd) > Number(cheap.price_usd))) continue;
        const add = (rule, detail, message, extra = {}) => warnings.push({
          kind, rule, message,
          signature: `${detail}|${terms(dear)}|${terms(cheap)}`,
          package_id: dear.id, package_name: dear.name, price_usd: Number(dear.price_usd),
          compared_package_id: cheap.id, compared_package_name: cheap.name, compared_price_usd: Number(cheap.price_usd),
          ...extra,
        });

        if (kind === 'ad' && Number(dear.max_creatives) < Number(cheap.max_creatives)) {
          add('creatives', `${dear.max_creatives}<${cheap.max_creatives}`,
            `${label(dear)} allows ${dear.max_creatives} creative${dear.max_creatives === 1 ? '' : 's'}, fewer than ${label(cheap)} with ${cheap.max_creatives}.`);
        }
        if (Number(dear.duration_hours) < Number(cheap.duration_hours)) {
          add('duration', `${dear.duration_hours}<${cheap.duration_hours}`,
            `${label(dear)} runs ${hours(dear.duration_hours)}, shorter than ${label(cheap)} at ${hours(cheap.duration_hours)}.`);
        }
        if (Number(dear.priority) < Number(cheap.priority)) {
          add('priority', `${dear.priority}<${cheap.priority}`,
            `${label(dear)} has exposure priority ${dear.priority}, lower than ${label(cheap)} at ${cheap.priority}.`);
        }
        const dearSet = new Set(dear.placements || []);
        const missing = (cheap.placements || []).filter((p) => !dearSet.has(p)).sort();
        if (missing.length) {
          add('placements', `missing:${missing.join(',')}`,
            `${label(dear)} can't appear in ${placementList(missing)}, which ${label(cheap)} includes.`,
            { missing_placements: missing });
        }
      }
    }
  }
  return warnings;
}

/**
 * Marks each warning with its admin exception when the exception's signature
 * still matches the current values. exceptions: rows of
 * advertising_package_value_exceptions.
 */
export function applyExceptions(warnings, exceptions) {
  const byKey = new Map((exceptions || []).map((e) => [`${e.package_id}|${e.compared_package_id}|${e.rule}`, e]));
  return warnings.map((w) => {
    const e = byKey.get(warningKey(w));
    return e && e.signature === w.signature
      ? { ...w, exception: { note: e.note, acknowledged_by: e.acknowledged_by_email || null, created_at: e.created_at } }
      : { ...w, exception: null };
  });
}
