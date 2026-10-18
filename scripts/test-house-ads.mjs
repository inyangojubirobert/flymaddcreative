// House ads (One Dream's own, admin-uploaded): the real migration in an
// in-memory Postgres (PGlite). node --test scripts/test-house-ads.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { earningsTestDb } from './lib/earnings-test-db.mjs';

const { db } = await earningsTestDb();
test.after(() => db.close());
const one = async (sql, params) => (await db.query(sql, params)).rows[0];
const sql = await fs.readFile(new URL('../supabase/add_house_ads.sql', import.meta.url), 'utf8');
const insert = (fields) => {
  const row = { title: 'Get the app', destination_type: 'external', destination_url: 'https://play.google.com/store/apps/details?id=x',
    resource_type: 'image', format: 'png', cloudinary_public_id: `onedream_house_ads/house_${Math.random()}`, ...fields };
  const cols = Object.keys(row);
  return db.query(`insert into house_ads (${cols.join(', ')}) values (${cols.map((_, i) => `$${i + 1}`).join(', ')}) returning *`, Object.values(row));
};

test('migration applies, verifies and is idempotent', async () => {
  await db.exec(sql);
  await db.exec(sql);
  assert.deepEqual((await db.query(sql.slice(sql.lastIndexOf('with checks(')))).rows.filter((r) => !r.ok), []);
});

test('links must be https, a listing or a storefront; placements are known ones', async () => {
  const ad = (await insert({})).rows[0];
  assert.deepEqual([ad.mode, ad.weight, ad.status, ad.placements.length], ['fill', 10, 'active', 4], 'defaults: fill empty slots, all placements');
  await assert.rejects(insert({ destination_url: 'http://example.com' }), /house_ads_destination/);
  await assert.rejects(insert({ destination_type: 'listing' }), /house_ads_destination/);
  await assert.rejects(insert({ placements: ['sidebar'] }), /house_ads_placements/);
  await assert.rejects(insert({ ends_at: '2000-01-01' }), /house_ads_window/);
  await assert.rejects(insert({ resource_type: 'audio' }), /resource_type/);
});

test('impressions and clicks count once per viewer per hour; paused ads are not counted', async () => {
  const ad = (await insert({ title: 'Counted' })).rows[0];
  const rec = (kind, viewer) => one(`select house_ads_record_event($1, $2, 'home', $3) r`, [ad.id, kind, viewer]).then((r) => r.r);
  assert.equal(await rec('impression', 'v1'), true);
  assert.equal(await rec('impression', 'v1'), false, 'same viewer, same hour');
  assert.equal(await rec('impression', 'v2'), true);
  assert.equal(await rec('click', 'v1'), true);
  assert.equal(await rec('bogus', 'v1'), false);
  await db.query(`update house_ads set status = 'paused' where id = $1`, [ad.id]);
  assert.equal(await rec('impression', 'v3'), false);
  assert.equal(Number((await one(`select count(*) n from house_ad_events where house_ad_id = $1`, [ad.id])).n), 3);
});
