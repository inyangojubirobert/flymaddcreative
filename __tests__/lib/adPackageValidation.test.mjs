// Run: node --test __tests__/lib/adPackageValidation.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyExceptions, validatePackageLadder, warningKey } from '../../lib/adPackageValidation.js';

const ALL = ['home', 'shop', 'search', 'category'];
const pkg = (id, kind, price_usd, duration_hours, max_creatives, priority, placements, is_active = true) => ({
  id, kind, name: id, price_usd, duration_hours, max_creatives, priority, placements, is_active,
});

// The live packages as of 2026-10-15.
const LIVE = [
  pkg('starter_ads', 'ad', 10, 72, 1, 10, ['shop', 'category']),
  pkg('growth_ads', 'ad', 20, 168, 2, 20, ['home', 'shop', 'category']),
  pkg('premium_ads', 'ad', 40, 360, 3, 30, ALL),
  pkg('business_ads', 'ad', 75, 720, 5, 40, ALL),
  pkg('bronze_ads', 'ad', 100, 720, 6, 50, ALL),
  pkg('silver_ads', 'ad', 200, 720, 7, 65, ALL),
  pkg('gold_ads', 'ad', 400, 720, 8, 80, ALL),
  pkg('quick_boost', 'boost', 3, 24, 0, 10, ['shop', 'category']),
  pkg('seller_boost', 'boost', 10, 168, 0, 20, ['shop', 'search', 'category']),
  pkg('power_boost', 'boost', 25, 720, 0, 30, ['shop', 'search', 'category']),
  pkg('pro_boost', 'boost', 100, 720, 0, 40, ['shop', 'search', 'category']),
  pkg('prime_boost', 'boost', 200, 720, 0, 50, ['shop', 'search', 'category']),
  pkg('star_boost', 'boost', 300, 720, 0, 60, ['shop', 'search', 'category']),
  pkg('elite_boost', 'boost', 400, 720, 0, 70, ['shop', 'search', 'category']),
  pkg('premier_boost', 'boost', 1500, 720, 0, 85, ['shop', 'search', 'category']),
  pkg('ultimate_boost', 'boost', 4000, 720, 0, 100, ['shop', 'search', 'category']),
];

test('the current live ladder has no warnings', () => {
  assert.deepEqual(validatePackageLadder(LIVE), []);
});

test('flags fewer creatives, shorter duration and lower priority, naming both packages', () => {
  const w = validatePackageLadder([
    pkg('a', 'ad', 50, 720, 5, 40, ALL),
    pkg('b', 'ad', 100, 360, 4, 30, ALL),
  ]);
  assert.deepEqual(w.map((x) => x.rule).sort(), ['creatives', 'duration', 'priority']);
  assert.ok(w.every((x) => x.package_id === 'b' && x.compared_package_id === 'a'));
  assert.match(w.find((x) => x.rule === 'creatives').message, /b \(\$100\) allows 4 creatives, fewer than a \(\$50\) with 5/);
  assert.match(w.find((x) => x.rule === 'duration').message, /15 days, shorter than a \(\$50\) at 30 days/);
});

test('compares placement sets, not counts', () => {
  const w = validatePackageLadder([
    pkg('a', 'ad', 10, 72, 1, 10, ['home', 'shop']),
    pkg('b', 'ad', 20, 72, 1, 10, ['shop', 'search']), // same count, different set
  ]);
  assert.equal(w.length, 1);
  assert.equal(w[0].rule, 'placements');
  assert.deepEqual(w[0].missing_placements, ['home']);
  assert.match(w[0].message, /can't appear in Home, which a \(\$10\) includes/);
});

test('a superset of placements is fine even with more placements on the cheaper side elsewhere', () => {
  assert.deepEqual(validatePackageLadder([
    pkg('a', 'ad', 10, 72, 1, 10, ['shop']),
    pkg('b', 'ad', 20, 72, 1, 10, ['shop', 'home']),
  ]), []);
});

test('compares against every cheaper package, not only the neighbour', () => {
  const w = validatePackageLadder([
    pkg('a', 'ad', 10, 72, 1, 50, ALL),
    pkg('b', 'ad', 20, 72, 1, 60, ALL),
    pkg('c', 'ad', 30, 72, 1, 55, ALL), // below b and above a
  ]);
  assert.equal(w.length, 1);
  assert.equal(w[0].package_id, 'c');
  assert.equal(w[0].compared_package_id, 'b');
});

test('equal prices are not compared; inactive packages are ignored unless asked', () => {
  assert.deepEqual(validatePackageLadder([pkg('a', 'ad', 10, 720, 5, 50, ALL), pkg('b', 'ad', 10, 72, 1, 10, ['shop'])]), []);
  const withRetired = [pkg('old', 'ad', 10, 720, 9, 90, ALL, false), pkg('b', 'ad', 20, 72, 1, 10, ALL)];
  assert.deepEqual(validatePackageLadder(withRetired), []);
  assert.equal(validatePackageLadder(withRetired, { includeInactive: true }).length, 3);
});

test('ads and boosts are separate ladders, and boosts are not compared on creatives', () => {
  assert.deepEqual(validatePackageLadder([pkg('ad1', 'ad', 10, 720, 5, 90, ALL), pkg('boost1', 'boost', 400, 24, 0, 10, ['shop'])]), []);
  assert.deepEqual(validatePackageLadder([pkg('x', 'boost', 10, 72, 3, 10, ['shop']), pkg('y', 'boost', 20, 72, 0, 10, ['shop'])]), []);
});

test('an exception marks the warning, and lapses when the compared values change', () => {
  const packages = [pkg('a', 'ad', 50, 720, 5, 40, ALL), pkg('b', 'ad', 100, 720, 4, 40, ALL)];
  const [warning] = validatePackageLadder(packages);
  const exception = { package_id: 'b', compared_package_id: 'a', rule: 'creatives', signature: warning.signature, note: 'Video-only tier', acknowledged_by_email: 'admin@x', created_at: '2026-10-15' };
  const marked = applyExceptions([warning], [exception]);
  assert.equal(marked[0].exception.note, 'Video-only tier');
  assert.equal(warningKey(marked[0]), 'b|a|creatives');

  const changed = validatePackageLadder([pkg('a', 'ad', 50, 720, 6, 40, ALL), pkg('b', 'ad', 100, 720, 4, 40, ALL)]);
  assert.equal(applyExceptions(changed, [exception])[0].exception, null, 'cheaper package now has 6 creatives: review again');

  // Any other change to either package also lapses it - here only the prices move.
  const repriced = validatePackageLadder([pkg('a', 'ad', 60, 720, 5, 40, ALL), pkg('b', 'ad', 100, 720, 4, 40, ALL)]);
  assert.equal(repriced[0].rule, 'creatives');
  assert.equal(applyExceptions(repriced, [exception])[0].exception, null, 'cheaper package price changed: review again');
  const placesChanged = validatePackageLadder([pkg('a', 'ad', 50, 720, 5, 40, ALL), pkg('b', 'ad', 100, 720, 4, 40, ['home', 'shop', 'search', 'category'].reverse())]);
  assert.ok(applyExceptions(placesChanged, [exception])[0].exception, 'same placements in another order is not a change');
});

test('never mutates the packages it checks', () => {
  const input = JSON.parse(JSON.stringify(LIVE));
  validatePackageLadder(input);
  assert.deepEqual(input, LIVE);
});
