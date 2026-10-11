// READ-ONLY audit of listings and categories for the listing-engine review.
// Only SELECT queries and one GET of the PostgREST schema description.
// Prints aggregates; writes nothing anywhere.
require('dotenv').config({ path: '.env.local' });
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const db = createClient(url, key);

const PROPOSED_TABLES = [
  'catalogue_pricing_models', 'catalogue_checkout_model_approvals', 'catalogue_units',
  'catalogue_attribute_definitions', 'catalogue_item_attributes', 'catalogue_product_details',
  'catalogue_service_details', 'catalogue_listing_drafts', 'catalogue_pricing_options',
];
const PROPOSED_ITEM_COLUMNS = [
  'listing_type', 'pricing_model', 'price_unit', 'service_scope', 'service_terms',
  'service_scope_confirmed', 'needs_type_review', 'type_review_reason', 'type_reviewed_at',
];
const PROPOSED_CATEGORY_COLUMNS = ['listing_types', 'suggested_listing_type'];

function tally(rows, fn) {
  const out = {};
  for (const r of rows) { const k = String(fn(r)); out[k] = (out[k] || 0) + 1; }
  return out;
}

async function main() {
  // 1. Schema as exposed by PostgREST (columns, types, required, defaults)
  const spec = await fetch(`${url}/rest/v1/`, { headers: { apikey: key, Authorization: `Bearer ${key}` } }).then((r) => r.json());
  const defs = spec.definitions || {};
  for (const table of ['catalogue_items', 'catalogue_categories']) {
    const d = defs[table];
    console.log(`\n== ${table} columns ==`);
    if (!d) { console.log('  (not exposed)'); continue; }
    for (const [col, info] of Object.entries(d.properties)) {
      const req = (d.required || []).includes(col) ? 'NOT NULL' : 'null';
      console.log(`  ${col}: ${info.format}${info.default !== undefined ? ` default=${info.default}` : ''} ${req}${info.description ? ` | ${info.description.replace(/\s+/g, ' ').slice(0, 80)}` : ''}`);
    }
  }
  console.log('\n== Proposed tables already present? ==');
  for (const t of PROPOSED_TABLES) console.log(`  ${t}: ${defs[t] ? 'EXISTS' : 'absent'}`);
  const itemCols = Object.keys(defs.catalogue_items?.properties || {});
  const catCols = Object.keys(defs.catalogue_categories?.properties || {});
  console.log('  proposed item columns present:', PROPOSED_ITEM_COLUMNS.filter((c) => itemCols.includes(c)));
  console.log('  proposed category columns present:', PROPOSED_CATEGORY_COLUMNS.filter((c) => catCols.includes(c)));
  console.log('  other catalogue_* tables exposed:', Object.keys(defs).filter((t) => t.startsWith('catalogue_')));

  // 2. Categories
  const { data: cats, error: catErr } = await db.from('catalogue_categories').select('*');
  if (catErr) throw catErr;
  const byId = new Map(cats.map((c) => [c.id, c]));
  const departments = cats.filter((c) => !c.parent_id);
  const children = cats.filter((c) => c.parent_id);
  console.log('\n== Categories ==');
  console.log(`  total ${cats.length}, departments ${departments.length}, children ${children.length}`);
  console.log('  inactive:', cats.filter((c) => c.is_active === false).map((c) => c.slug));
  console.log('  non-selectable children:', children.filter((c) => c.is_selectable === false).map((c) => c.slug));
  console.log('  third-level (child of a child):', children.filter((c) => byId.get(c.parent_id)?.parent_id).map((c) => c.slug));
  console.log('  orphan parent_id:', children.filter((c) => !byId.has(c.parent_id)).map((c) => c.slug));
  const nameKeys = tally(cats, (c) => `${c.parent_id || 'root'}|${c.name.trim().toLowerCase()}`);
  console.log('  same-department duplicate names:', Object.entries(nameKeys).filter(([, n]) => n > 1));
  const slugKeys = tally(cats, (c) => c.slug);
  console.log('  duplicate slugs:', Object.entries(slugKeys).filter(([, n]) => n > 1));
  console.log('  departments with child counts:');
  for (const d of departments.sort((a, b) => a.sort_order - b.sort_order)) {
    console.log(`    ${d.slug}: ${children.filter((c) => c.parent_id === d.id).length}`);
  }

  // Slugs the migration seeds suggested_listing_type for - do they all exist?
  const fs = require('fs');
  const sql = fs.readFileSync('supabase/add_dynamic_listing_engine.sql', 'utf8');
  const seedBlocks = [...sql.matchAll(/set suggested_listing_type = '(\w+)'[\s\S]*?slug in \(([\s\S]*?)\);/g)];
  const slugSet = new Set(cats.map((c) => c.slug));
  for (const [, type, list] of seedBlocks) {
    const slugs = [...list.matchAll(/'([a-z0-9-]+)'/g)].map((m) => m[1]);
    console.log(`  seed '${type}': ${slugs.length} slugs, missing in DB:`, slugs.filter((s) => !slugSet.has(s)));
  }

  // 3. Listings
  const { data: items, error: itemErr } = await db.from('catalogue_items').select('*');
  if (itemErr) throw itemErr;
  console.log('\n== Listings ==');
  console.log(`  total ${items.length}`);
  console.log('  by status:', tally(items, (i) => i.status));
  const live = items.filter((i) => i.status !== 'deleted');
  const badPrice = live.filter((i) => {
    const p = Number(i.price_usd);
    return i.price_usd === null || !Number.isFinite(p) || p <= 0;
  });
  console.log('  non-deleted with invalid price:', badPrice.map((i) => ({ id: i.id, price: i.price_usd, status: i.status })));
  console.log('  non-deleted with >2 decimal places:', live.filter((i) => /\.\d{3,}/.test(String(i.price_usd))).length);
  console.log('  price range (non-deleted):', live.length ? [Math.min(...live.map((i) => Number(i.price_usd))), Math.max(...live.map((i) => Number(i.price_usd)))] : []);
  console.log('  null category_id:', items.filter((i) => !i.category_id).length);
  const catIssue = (i) => {
    const c = byId.get(i.category_id);
    if (!c) return 'missing category';
    if (!c.parent_id) return `department (${c.slug})`;
    if (c.is_active === false) return `inactive (${c.slug})`;
    if (c.is_selectable === false) return `non-selectable (${c.slug})`;
    return null;
  };
  console.log('  non-deleted in unsuitable category:', live.map((i) => [i.id, catIssue(i)]).filter(([, x]) => x));
  console.log('  non-deleted by category slug:', tally(live, (i) => byId.get(i.category_id)?.slug || 'none'));
  console.log('  status values seen:', [...new Set(items.map((i) => i.status))]);
  console.log('  payment_methods values:', tally(items, (i) => JSON.stringify(i.payment_methods)));
  console.log('  sellers with listings:', new Set(items.map((i) => i.seller_username)).size);
}

main().catch((e) => { console.error('AUDIT ERROR', e.message || e); process.exit(1); });
