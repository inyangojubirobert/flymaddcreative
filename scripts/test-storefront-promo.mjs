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
const fix = await fs.readFile(new URL('../supabase/fix_storefront_promotion_review.sql', import.meta.url), 'utf8');

test('migration applies, verifies and is idempotent', async () => {
  await db.exec(sql);
  await db.exec(sql);
  assert.deepEqual((await db.query(sql.slice(sql.lastIndexOf('with checks(')))).rows.filter((r) => !r.ok), []);
  await db.exec(fix);
  await db.exec(fix);
  assert.deepEqual((await db.query(fix.slice(fix.lastIndexOf('with checks(')))).rows.filter((r) => !r.ok), []);
  const t = await one(`select * from promo_programme_terms where is_current`);
  assert.equal(t.version, 2, 'v2 replaces v1 as the current terms');
  assert.equal(Number(t.max_ad_spend_usd), 10);
  assert.equal(Number(t.programme_budget_usd), 1000);
  assert.equal(t.max_selected_per_seller, 3);
  assert.match(t.body, /for a chance to be featured/);
  assert.match(t.body, /does not mean the full US\$10 will be spent/);
});

test('terms are immutable; new wording is a new version', async () => {
  await assert.rejects(db.query(`update promo_programme_terms set body = 'changed', body_sha256 = encode(sha256(convert_to('changed', 'UTF8')), 'hex') where version = 2`), /promo_terms_immutable/);
  await assert.rejects(db.query(`select promo_publish_terms(2, 't', 'b', 10, 10, 1000, 3)`), /promo_terms_version_exists/);
});

test('consent is recorded per video, immutable, and can be withdrawn', async () => {
  await db.exec(`
    insert into participants (id, username, email) values ('${id(1)}', 'shop', 's@example.com');
    insert into catalogue_items (id, seller_username, title, price_usd) values ('${id(2)}', 'shop', 'Bag', 10), ('${id(3)}', 'shop', 'Shoe', 12);
  `);
  const t = await one(`select * from promo_programme_terms where is_current`);
  const submit = (item, url) => one(`insert into promo_video_submissions (participant_id, seller_username, item_id, video_url, terms_version, terms_sha256, consent_text)
    values ($1, 'shop', $2, $3, 2, $4, 'I agree') returning id`, [id(1), item, url, t.body_sha256]);
  const a = await submit(id(2), 'https://v/bag.mp4');
  const b = await submit(id(3), 'https://v/shoe.mp4');
  assert.ok(a.id && b.id, 'a seller can submit several videos');
  await assert.rejects(submit(id(2), 'https://v/bag.mp4'), /duplicate key/, 'the same video once at a time');
  await assert.rejects(db.query(`update promo_video_submissions set video_url = 'x' where id = $1`, [a.id]), /promo_consent_immutable/);
  await db.query(`update promo_video_submissions set status = 'withdrawn', withdrawn_at = now() where id = $1`, [b.id]);
  await assert.rejects(db.query(`update promo_video_submissions set status = 'selected', withdrawn_at = null where id = $1`, [b.id]), /promo_consent_withdrawn/);
  await submit(id(3), 'https://v/shoe.mp4');
  await assert.rejects(db.query(`delete from promo_programme_terms where version = 2`), /promo_terms_in_use/, 'accepted terms are kept');
});

test('spend: selected only, $10 per video, append-only, noted corrections', async () => {
  const [a] = (await db.query(`select id from promo_video_submissions where item_id = $1 and status = 'submitted'`, [id(2)])).rows;
  const spend = (sub, amount, notes = null) => db.query(`insert into promo_campaign_spend (submission_id, platform, amount_usd, notes) values ($1, 'tiktok', $2, $3) returning id`, [sub, amount, notes]);
  await assert.rejects(spend(a.id, 5), /promo_not_selected/);
  await db.query(`update promo_video_submissions set status = 'selected' where id = $1`, [a.id]);
  const first = (await spend(a.id, 6)).rows[0];
  await spend(a.id, 4);
  await assert.rejects(spend(a.id, 0.01), /promo_spend_over_limit/, '$10 per video');
  await assert.rejects(db.query(`update promo_campaign_spend set amount_usd = 1 where id = $1`, [first.id]), /promo_spend_append_only/);
  await assert.rejects(db.query(`delete from promo_campaign_spend where id = $1`, [first.id]), /promo_spend_append_only/);
  await assert.rejects(spend(a.id, -2), /promo_spend_amount/, 'a correction needs a note');
  await spend(a.id, -2, 'Duplicate entry for the TikTok post');
  await assert.rejects(spend(a.id, -9, 'Too much'), /promo_correction_too_large/);
  assert.equal(Number((await one(`select sum(amount_usd) s from promo_campaign_spend where submission_id = $1`, [a.id])).s), 8);
});

test('budget is reserved at selection; at most 3 funded videos per seller', async () => {
  const newSubmission = async (n, seller) => {
    const item = id(1000 + n);
    await db.query(`insert into catalogue_items (id, seller_username, title, price_usd) values ($1, $2, 'x', 1)`, [item, seller.username]);
    return (await one(`insert into promo_video_submissions (participant_id, seller_username, item_id, video_url, terms_version, terms_sha256, consent_text)
      select $1, $2, $3::uuid, 'https://v/' || $3::text, 2, body_sha256, 'I agree' from promo_programme_terms where version = 2 returning id`, [seller.id, seller.username, item])).id;
  };
  const select = (sid) => db.query(`update promo_video_submissions set status = 'selected' where id = $1`, [sid]);

  // 'shop' already has 1 selected video; 2 more are allowed, a 4th is not.
  const shop = { id: id(1), username: 'shop' };
  await select(await newSubmission(1, shop));
  await select(await newSubmission(2, shop));
  await assert.rejects(select(await newSubmission(3, shop)), /promo_seller_limit/, '3 funded videos per seller');

  // Other sellers until the $1,000 is committed ($10 reserved per selected video).
  let n = 10;
  for (;;) {
    const committed = Number((await one(`select promo_committed_usd(2) c`)).c);
    if (committed + 10 > 1000) break;
    const sellerId = id(5000 + n);
    await db.query(`insert into participants (id, username, email) values ($1, $2, $3)`, [sellerId, `s${n}`, `s${n}@example.com`]);
    await select(await newSubmission(n, { id: sellerId, username: `s${n}` }));
    n += 1;
  }
  assert.ok(Number((await one(`select promo_committed_usd(2) c`)).c) <= 1000);
  const lastId = id(5000 + n);
  await db.query(`insert into participants (id, username, email) values ($1, $2, $3)`, [lastId, `s${n}`, `s${n}@example.com`]);
  await assert.rejects(select(await newSubmission(n, { id: lastId, username: `s${n}` })), /promo_budget_committed/, 'no selection beyond the uncommitted budget');
});
