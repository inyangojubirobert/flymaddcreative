// One Dream Storefront Promotion: consent records and the ad-spend limits,
// on the real migration in an in-memory Postgres (PGlite).
//   node --test scripts/test-storefront-promo.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { earningsTestDb } from './lib/earnings-test-db.mjs';

const { db } = await earningsTestDb();
test.after(() => db.close());
const one = async (sql, params) => (await db.query(sql, params)).rows[0];
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const sql = await fs.readFile(new URL('../supabase/add_storefront_promotion.sql', import.meta.url), 'utf8');

test('migration applies, verifies and is idempotent', async () => {
  await db.exec(sql);
  await db.exec(sql);
  assert.deepEqual((await db.query(sql.slice(sql.lastIndexOf('with checks(')))).rows.filter((r) => !r.ok), []);
  const t = await one(`select * from promo_programme_terms where is_current`);
  assert.equal(Number(t.max_ad_spend_usd), 10);
  assert.equal(Number(t.programme_budget_usd), 1000);
  assert.match(t.body, /up to US\$10 of external advertising/);
  assert.match(t.body, /total advertising budget of US\$1,000/);
});

test('consent is recorded per video, immutable, and can be withdrawn', async () => {
  await db.exec(`
    insert into participants (id, username, email) values ('${id(1)}', 'shop', 's@example.com');
    insert into catalogue_items (id, seller_username, title, price_usd) values ('${id(2)}', 'shop', 'Bag', 10), ('${id(3)}', 'shop', 'Shoe', 12);
  `);
  const t = await one(`select * from promo_programme_terms where is_current`);
  const submit = (item, url) => one(`insert into promo_video_submissions (participant_id, seller_username, item_id, video_url, terms_version, terms_sha256, consent_text)
    values ($1, 'shop', $2, $3, 1, $4, 'I agree') returning id`, [id(1), item, url, t.body_sha256]);
  const a = await submit(id(2), 'https://v/bag.mp4');
  const b = await submit(id(3), 'https://v/shoe.mp4');
  assert.ok(a.id && b.id, 'a seller can submit several videos');
  await assert.rejects(submit(id(2), 'https://v/bag.mp4'), /duplicate key/, 'the same video once at a time');
  await assert.rejects(db.query(`update promo_video_submissions set video_url = 'x' where id = $1`, [a.id]), /promo_consent_immutable/);
  await db.query(`update promo_video_submissions set status = 'withdrawn', withdrawn_at = now() where id = $1`, [b.id]);
  await assert.rejects(db.query(`update promo_video_submissions set status = 'selected', withdrawn_at = null where id = $1`, [b.id]), /promo_consent_withdrawn/);
  await submit(id(3), 'https://v/shoe.mp4');
});

test('spend: only selected videos, at most $10 each, $1,000 in total', async () => {
  const [a] = (await db.query(`select id from promo_video_submissions where item_id = $1 and status = 'submitted'`, [id(2)])).rows;
  const spend = (sub, amount) => db.query(`insert into promo_campaign_spend (submission_id, platform, amount_usd) values ($1, 'tiktok', $2)`, [sub, amount]);
  await assert.rejects(spend(a.id, 5), /promo_not_selected/);
  await db.query(`update promo_video_submissions set status = 'selected' where id = $1`, [a.id]);
  await spend(a.id, 6);
  await spend(a.id, 4);
  await assert.rejects(spend(a.id, 0.01), /promo_spend_over_limit/, '$10 per video');

  // Fill the programme budget with other selected videos: 99 more x $10 = $990, total $1,000.
  for (let n = 0; n < 99; n += 1) {
    const item = id(100 + n);
    await db.query(`insert into catalogue_items (id, seller_username, title, price_usd) values ($1, 'shop', 'x', 1)`, [item]);
    const s = await one(`insert into promo_video_submissions (participant_id, seller_username, item_id, video_url, terms_version, terms_sha256, consent_text, status)
      select $1, 'shop', $2::uuid, 'https://v/' || $2::text, 1, body_sha256, 'I agree', 'selected' from promo_programme_terms where version = 1 returning id`, [id(1), item]);
    await spend(s.id, 10);
  }
  assert.equal(Number((await one(`select sum(amount_usd) s from promo_campaign_spend`)).s), 1000);
  const [b] = (await db.query(`select id from promo_video_submissions where item_id = $1 and status = 'submitted'`, [id(3)])).rows;
  await db.query(`update promo_video_submissions set status = 'selected' where id = $1`, [b.id]);
  await assert.rejects(spend(b.id, 1), /promo_budget_exhausted/, 'the $1,000 programme cap');
});
