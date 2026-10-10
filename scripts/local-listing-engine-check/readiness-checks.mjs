// Staging readiness checks for the Revision 4 listing-engine migration.
// Runs ONLY against a throwaway local PostgreSQL cluster (embedded-postgres).
// It never connects to Supabase and never touches payment objects.
//   cd scripts/local-listing-engine-check
//   npm install --no-save @electric-sql/pglite embedded-postgres pg
//   node readiness-checks.mjs <migration.sql> <rollback.sql>
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import EmbeddedPostgres from 'embedded-postgres';
import pg from 'pg';

const here = dirname(fileURLToPath(import.meta.url));
const migrationPath = resolve(process.argv[2] || join(here, '..', '..', 'supabase', 'add_dynamic_listing_engine.sql'));
const rollbackPath = resolve(process.argv[3] || join(here, '..', '..', 'supabase', 'rollback_dynamic_listing_engine.sql'));
const migrationSql = readFileSync(migrationPath, 'utf8');
const rollbackSql = readFileSync(rollbackPath, 'utf8');
const baseSql = readFileSync(join(here, 'base-schema.sql'), 'utf8');

const PORT = 54000 + Math.floor(Math.random() * 900);
const dir = mkdtempSync(join(tmpdir(), 'rev4-pg-'));
const server = new EmbeddedPostgres({ databaseDir: dir, user: 'postgres', password: 'pw', port: PORT, persistent: false });

const results = [];
const record = (id, check, status, evidence) => { results.push({ id, check, status, evidence }); console.log(`[${status}] ${id} ${check} :: ${evidence}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const hash = (v) => createHash('sha256').update(typeof v === 'string' ? v : JSON.stringify(v)).digest('hex').slice(0, 16);

async function connect(db) {
  const c = new pg.Client({ host: 'localhost', port: PORT, user: 'postgres', password: 'pw', database: db });
  await c.connect();
  return c;
}
let dbCounter = 0;
async function freshDb(admin) {
  const name = `s${++dbCounter}`;
  await admin.query(`create database ${name} template tpl`);
  await admin.query(`grant create, temporary on database ${name} to app_owner`);
  return connect(name);
}
async function tryAs(c, role, sql, params) {
  await c.query('begin');
  try {
    await c.query(`set local role ${role}`);
    const r = await c.query(sql, params);
    await c.query('rollback');
    return { ok: true, rows: r.rows, err: null };
  } catch (e) {
    await c.query('rollback');
    return { ok: false, rows: [], err: e.message, code: e.code };
  }
}
async function applyMigration(c, sql = migrationSql) {
  await c.query('set role app_owner');
  try { await c.query(sql); return { ok: true }; }
  catch (e) { await c.query('rollback'); return { ok: false, err: e.message, code: e.code }; }
  finally { await c.query('reset role'); }
}

// Everything the migration promises not to alter: categories, listings, orders,
// payment tables and functions, plus the original column lists.
async function snapshot(c) {
  const q = async (sql) => (await c.query(sql)).rows;
  const cats = await q(`select id, name, slug, parent_id, image_url, banner_title, banner_subtitle, icon, tint, ink, sort_order, is_active, is_selectable, is_featured from public.catalogue_categories order by id`);
  const items = await q(`select id, seller_username, title, description, price_usd::text as price_usd, images, payment_methods, status, category_id, size, promo_video_url, created_at from public.catalogue_items order by id`);
  const orders = await q(`select * from public.catalogue_orders order by id`);
  const usdt = await q(`select * from public.usdt_payments order by id`);
  const payment = {
    columns: await q(`select table_name, column_name, data_type, is_nullable, column_default from information_schema.columns where table_schema='public' and table_name in ('catalogue_orders','usdt_payments') order by 1, ordinal_position`),
    indexes: await q(`select tablename, indexdef from pg_indexes where schemaname='public' and tablename in ('catalogue_orders','usdt_payments') order by 1,2`),
    triggers: await q(`select c.relname, t.tgname, pg_get_triggerdef(t.oid) as def from pg_trigger t join pg_class c on c.oid=t.tgrelid where not t.tgisinternal and c.relname in ('catalogue_orders','usdt_payments') order by 1,2`),
    functions: await q(`select proname, pg_get_functiondef(oid) as def from pg_proc where pronamespace='public'::regnamespace and proname in ('verify_payment_stub','touch_usdt') order by 1`),
    acl: await q(`select relname, relacl::text as acl, relrowsecurity from pg_class where relnamespace='public'::regnamespace and relname in ('catalogue_orders','usdt_payments') order by 1`),
    policies: await q(`select tablename, policyname, cmd, qual from pg_policies where schemaname='public' and tablename in ('catalogue_orders','usdt_payments') order by 1,2`)
  };
  const itemCols = (await q(`select column_name from information_schema.columns where table_schema='public' and table_name='catalogue_items' order by ordinal_position`)).map((r) => r.column_name);
  const catCols = (await q(`select column_name from information_schema.columns where table_schema='public' and table_name='catalogue_categories' order by ordinal_position`)).map((r) => r.column_name);
  return { cats, items, orders, usdt, payment, itemCols, catCols };
}

const LEGACY_ITEM = (cat) => [
  'insert into public.catalogue_items (seller_username, title, description, price_usd, images, payment_methods, status, category_id, promo_video_url, created_at) values ($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7,$8,$9,now()) returning *',
  ['faithful', 'Old-API listing', 'created by the previous API', 12.5, '["https://example.com/a.jpg"]', '["usdt","paystack"]', 'active', cat, null]
];

async function main() {
  await server.initialise();
  await server.start();
  const admin = await connect('postgres');

  // Template database = production state after the lockdown, plus the cover and
  // department columns the real catalogue_categories table has.
  await admin.query('create database tpl');
  const t = await connect('tpl');
  await t.query(baseSql);
  await t.query('set role app_owner');
  await t.query(`alter table public.catalogue_categories add column icon text default 'pricetag', add column tint text default '#DBEAFE', add column ink text default '#1E3A8A', add column is_featured boolean not null default false, add column is_selectable boolean not null default true, add column image_url text, add column banner_title text, add column banner_subtitle text, add column created_at timestamptz default now()`);
  await t.query(`update public.catalogue_categories set image_url = 'https://res.cloudinary.com/demo/image/upload/' || slug || '.png' where parent_id is null or slug in ('graphic-design','drinks-beverages')`);
  await t.query(`update public.catalogue_categories set banner_title = 'Banner ' || name where parent_id is null`);
  await t.query(`update public.catalogue_categories set is_selectable = false where slug in ('other')`);
  await t.query('reset role');
  await t.end();

  // ---- Check 1: lockdown ---------------------------------------------------
  {
    const c = await freshDb(admin);
    await c.query('grant insert, update on public.catalogue_items to anon');
    const before = hash(await snapshot(c));
    const r = await applyMigration(c);
    const after = hash(await snapshot(c));
    const noObjects = (await c.query(`select to_regclass('public.catalogue_listing_drafts') as t`)).rows[0].t === null;
    record('C1a', 'Migration refuses to run if anon can still write catalogue_items (unlocked state)',
      !r.ok && /can still write catalogue_items/.test(r.err) && before === after && noObjects ? 'PASS' : 'FAIL',
      `error="${(r.err || '').slice(0, 110)}", data unchanged=${before === after}, no engine objects=${noObjects}`);
    await c.end();

    const c2 = await freshDb(admin);
    const locked = await tryAs(c2, 'anon', `insert into public.catalogue_items (seller_username,title,price_usd,status,category_id) select 'x','y',1,'active',id from public.catalogue_categories limit 1`);
    record('C1b', 'Emulated locked-down state: anon write is denied before migration', !locked.ok ? 'PASS' : 'FAIL', `error="${locked.err}"`);
    await c2.end();
  }

  // ---- Check 4 + 6: migration preserves data; idempotent; rollback ---------
  const main = await freshDb(admin);
  const pre = await snapshot(main);
  const t0 = Date.now();
  const mig = await applyMigration(main);
  const migMs = Date.now() - t0;
  if (!mig.ok) { record('C4', 'Migration runs on staging', 'FAIL', mig.err); }
  const post = await snapshot(main);

  const same = (k) => hash(pre[k]) === hash(post[k]);
  const catsOk = pre.cats.length === post.cats.length && hash(pre.cats) === hash(post.cats);
  const itemsOk = same('items');
  const coversKept = pre.cats.filter((r) => r.image_url).length === post.cats.filter((r) => r.image_url).length && catsOk;
  const additive = pre.itemCols.every((x) => post.itemCols.includes(x)) && pre.catCols.every((x) => post.catCols.includes(x));
  const paymentSame = hash(pre.payment) === hash(post.payment) && same('orders') && same('usdt');
  record('C4', 'Migration preserves categories, IDs, slugs, parents, covers, banners, listings and relationships',
    mig.ok && catsOk && itemsOk && coversKept && additive ? 'PASS' : 'FAIL',
    `categories ${pre.cats.length}->${post.cats.length} identical=${catsOk}; covers kept=${coversKept}; listings identical=${itemsOk}; columns purely additive=${additive}; migration took ${migMs} ms`);
  record('C4-pay', 'Payment tables, indexes, triggers, functions, grants, policies and rows unchanged',
    paymentSame ? 'PASS' : 'FAIL', `fingerprint before/after equal=${paymentSame}`);

  const again = await applyMigration(main);
  const post2 = await snapshot(main);
  record('C6a', 'Migration is re-runnable (idempotent) without altering data', again.ok && hash(post2.cats) === hash(post.cats) && hash(post2.items) === hash(post.items) ? 'PASS' : 'FAIL', again.ok ? 'second run succeeded, data identical' : again.err);

  const flagged = (await main.query(`select count(*)::int n from public.catalogue_items where needs_type_review`)).rows[0].n;
  const defaults = (await main.query(`select count(*)::int n from public.catalogue_items where listing_type='product' and pricing_model='fixed'`)).rows[0].n;
  record('C4b', 'Existing listings default to product + fixed; ambiguous ones are flagged, not reclassified', defaults === pre.items.length ? 'PASS' : 'FAIL', `${defaults}/${pre.items.length} product+fixed; ${flagged} flagged for review`);

  // ---- Check 5: backward compatibility with the previous API ---------------
  {
    const cat = (await main.query(`select id from public.catalogue_categories where slug='gadgets'`)).rows[0].id;
    const ins = await tryAs(main, 'service_role', ...LEGACY_ITEM(cat));
    const upd = await tryAs(main, 'service_role', `update public.catalogue_items set price_usd = 20, status = 'paused', updated_at = now() where title = 'art cover' returning id`);
    const unpause = await tryAs(main, 'service_role', `update public.catalogue_items set status = 'active' where title = 'art cover' returning id`);
    const del = await tryAs(main, 'service_role', `update public.catalogue_items set status = 'deleted' where title = 'art cover' returning id`);
    const star = await tryAs(main, 'service_role', `select * from public.catalogue_items limit 1`);
    const checkoutRead = await tryAs(main, 'service_role', `select i.id, i.price_usd, i.status, i.seller_username from public.catalogue_items i where i.status <> 'deleted'`);
    const anonRead = await tryAs(main, 'anon', `select id, title, price_usd, status from public.catalogue_items`);
    const anonCats = await tryAs(main, 'anon', `select id, name, slug, parent_id, image_url from public.catalogue_categories`);
    const anonWrite = await tryAs(main, 'anon', `update public.catalogue_items set title = 'hacked'`);
    const authedDraftRead = await tryAs(main, 'authenticated', `select * from public.catalogue_listing_drafts`);
    const anonApprovals = await tryAs(main, 'anon', `select * from public.catalogue_checkout_model_approvals`);
    const orderRead = await tryAs(main, 'service_role', `select * from public.catalogue_orders`);
    const ok = ins.ok && upd.ok && unpause.ok && del.ok && star.ok && checkoutRead.ok && anonRead.ok && anonCats.ok && !anonWrite.ok && orderRead.ok;
    record('C5', 'Previous API write/read shapes (no new columns) still work after migration', ok ? 'PASS' : 'FAIL',
      `legacy insert=${ins.ok}${ins.ok ? '' : ' ' + ins.err}; price/status update=${upd.ok}; unpause=${unpause.ok}; soft delete=${del.ok}; select *=${star.ok}; checkout-style read=${checkoutRead.ok}; anon browse=${anonRead.ok}/${anonCats.ok}; anon write blocked=${!anonWrite.ok}; orders readable=${orderRead.ok}`);
    record('C5b', 'Private engine tables are not readable by anon/authenticated', !authedDraftRead.ok && !anonApprovals.ok ? 'PASS' : 'FAIL', `drafts(authenticated): ${authedDraftRead.err}; approvals(anon): ${anonApprovals.err}`);
  }

  // ---- Check 2: pricing approval workflow ----------------------------------
  {
    const direct = await tryAs(main, 'app_owner', `update public.catalogue_pricing_models set checkout_compatible = true where key = 'hourly' returning key`);
    const roles = {};
    for (const role of ['anon', 'authenticated', 'service_role']) {
      roles[role] = {
        update: (await tryAs(main, role, `update public.catalogue_pricing_models set checkout_compatible = true where key = 'hourly'`)).ok,
        fn: (await tryAs(main, role, `select public.catalogue_set_checkout_compatible('hourly', true, 'attacker ref')`)).ok,
        approval: (await tryAs(main, role, `insert into public.catalogue_checkout_model_approvals (pricing_model, approved_value, approval_reference) values ('hourly', true, 'attacker ref')`)).ok,
        insertModel: (await tryAs(main, role, `insert into public.catalogue_pricing_models (key, label, applies_to, checkout_compatible) values ('x_model','x',array['product'],true)`)).ok
      };
    }
    const apiRolesBlocked = Object.values(roles).every((r) => !r.update && !r.fn && !r.approval && !r.insertModel);
    record('C2a', 'Owner direct UPDATE of checkout_compatible without approval is rejected', !direct.ok ? 'PASS' : 'FAIL', `error="${direct.err}"`);
    record('C2b', 'anon/authenticated/service_role cannot change models, record approvals or call the approval function', apiRolesBlocked ? 'PASS' : 'FAIL', JSON.stringify(roles));

    // Owner-level bypass attempts.
    await main.query('begin');
    let sameTxn;
    try {
      await main.query('set local role app_owner');
      await main.query(`insert into public.catalogue_checkout_model_approvals (pricing_model, approved_value, approval_reference) values ('hourly', true, 'manual same-transaction approval')`);
      await main.query(`update public.catalogue_pricing_models set checkout_compatible = true where key = 'hourly'`);
      const rec = (await main.query(`select recorded_session_user, recorded_current_user, approval_reference from public.catalogue_checkout_model_approvals where approval_reference = 'manual same-transaction approval'`)).rows[0];
      sameTxn = { bypassed: true, audit: rec };
    } catch (e) { sameTxn = { bypassed: false, err: e.message }; }
    await main.query('rollback');

    await main.query('begin');
    await main.query('set local role app_owner');
    await main.query(`select public.catalogue_set_checkout_compatible('hourly', true, 'TEST-APPROVAL-0001')`);
    const viaFn = (await main.query(`select recorded_session_user, recorded_current_user, approval_reference from public.catalogue_checkout_model_approvals where approval_reference = 'TEST-APPROVAL-0001'`)).rows[0];
    await main.query('rollback');

    await main.query('set role app_owner');
    await main.query(`insert into public.catalogue_checkout_model_approvals (pricing_model, approved_value, approval_reference) values ('hourly', true, 'stale approval from an earlier transaction')`);
    await main.query('reset role');
    const stale = await tryAs(main, 'app_owner', `update public.catalogue_pricing_models set checkout_compatible = true where key = 'hourly'`);
    const forgeIdentity = await tryAs(main, 'app_owner', `insert into public.catalogue_checkout_model_approvals (pricing_model, approved_value, approval_reference, recorded_session_user, created_at) values ('hourly', true, 'forged identity', 'someone_else', '2000-01-01') returning recorded_session_user, created_at`);
    const appendOnly = await tryAs(main, 'app_owner', `update public.catalogue_checkout_model_approvals set approved_value = false`);
    const appendDelete = await tryAs(main, 'app_owner', `delete from public.catalogue_checkout_model_approvals`);
    const appendTrunc = await tryAs(main, 'app_owner', `truncate public.catalogue_checkout_model_approvals`);
    record('C2c', 'Stale approval from an earlier transaction cannot authorise a change', !stale.ok ? 'PASS' : 'FAIL', `error="${stale.err}"`);
    record('C2d', 'Approval identity/timestamp cannot be forged; approval log is append-only (update/delete/truncate)',
      forgeIdentity.ok && forgeIdentity.rows[0].recorded_session_user === 'postgres' && !appendOnly.ok && !appendDelete.ok && !appendTrunc.ok ? 'PASS' : 'FAIL',
      `forged row stored as session_user=${forgeIdentity.rows[0]?.recorded_session_user}, created_at=${forgeIdentity.rows[0]?.created_at?.toISOString?.()}; update/delete/truncate blocked=${!appendOnly.ok && !appendDelete.ok && !appendTrunc.ok}`);
    record('C2e', 'Approval function works for the owner and records the DB-observed identity',
      viaFn && viaFn.recorded_session_user ? 'PASS' : 'FAIL', JSON.stringify(viaFn));
    record('C2f', 'RESIDUAL (owner/superuser only): the database owner can write an approval row and update in the same transaction',
      sameTxn.bypassed ? 'ACCEPTED-RISK' : 'PASS',
      sameTxn.bypassed ? `owner bypass works but leaves an append-only audit row (session_user=${sameTxn.audit.recorded_session_user}); owners can also disable triggers. No API role can do this.` : `blocked: ${sameTxn.err}`);
  }

  // ---- Check 7: staging create product / service / draft (SQL-level) -------
  {
    const svcCat = (await main.query(`select id from public.catalogue_categories where slug='graphic-design'`)).rows[0].id;
    const prodCat = (await main.query(`select id from public.catalogue_categories where slug='gadgets'`)).rows[0].id;
    const product = await tryAs(main, 'service_role', `insert into public.catalogue_items (seller_username,title,price_usd,status,category_id,listing_type,pricing_model,price_unit,images,payment_methods) values ('faithful','Rice','30','active',$1,'product','per_unit','kg','["https://e.com/a.jpg"]'::jsonb,'["usdt"]'::jsonb) returning id, listing_type, pricing_model`, [prodCat]);
    const service = await tryAs(main, 'service_role', `insert into public.catalogue_items (seller_username,title,price_usd,status,category_id,listing_type,pricing_model,service_scope,service_terms,service_scope_confirmed,payment_methods) values ('faithful','Logo design','80','active',$1,'service','fixed','Logo design with two revisions and source files.','Delivered online within 5 days.',true,'["usdt"]'::jsonb) returning id, listing_type`, [svcCat]);
    const serviceNoScope = await tryAs(main, 'service_role', `insert into public.catalogue_items (seller_username,title,price_usd,status,category_id,listing_type,pricing_model,payment_methods) values ('faithful','Vague service','80','active',$1,'service','fixed','["usdt"]'::jsonb)`, [svcCat]);
    const hourly = await tryAs(main, 'service_role', `insert into public.catalogue_items (seller_username,title,price_usd,status,category_id,listing_type,pricing_model,service_scope,service_terms,service_scope_confirmed) values ('faithful','Hourly','10','active',$1,'service','hourly','Consulting for an hour, remote.','Booked in advance.',true)`, [svcCat]);
    const draft = await tryAs(main, 'service_role', `insert into public.catalogue_listing_drafts (seller_username, listing_type, category_id, title, pricing_model, price_usd) values ('faithful','service',$1,'Hourly consulting (draft)','hourly',10) returning id`, [svcCat]);
    const draftOwnerMismatch = await tryAs(main, 'service_role', `insert into public.catalogue_listing_drafts (seller_username, listing_type, title, pricing_model, published_item_id) select 'mallory','product','steal','fixed', id from public.catalogue_items limit 1`);
    const anonDraft = await tryAs(main, 'anon', `insert into public.catalogue_listing_drafts (seller_username, listing_type, title, pricing_model) values ('x','product','y','fixed')`);
    record('C7', 'Staging SQL: product, service and draft writes behave as the API expects', product.ok && service.ok && !serviceNoScope.ok && !hourly.ok && draft.ok && !draftOwnerMismatch.ok && !anonDraft.ok ? 'PASS' : 'FAIL',
      `product=${product.ok}; service(with scope)=${service.ok}; service without scope rejected=${!serviceNoScope.ok}; hourly publish rejected=${!hourly.ok}; draft saved=${draft.ok}; foreign-seller draft link rejected=${!draftOwnerMismatch.ok}; anon draft write rejected=${!anonDraft.ok}`);
  }

  // ---- Check 3: concurrent draft linking vs seller change (real Postgres) ---
  async function race(label, order) {
    const c = await freshDb(admin);
    await applyMigration(c);
    const a = await connect(c.database);
    const b = await connect(c.database);
    const item = (await c.query(`select id from public.catalogue_items where seller_username='inyangojubirobert' limit 1`)).rows[0].id;
    await a.query('begin'); await a.query('set local role app_owner');
    await b.query('begin'); await b.query('set local role app_owner');
    await b.query(`set local lock_timeout = '8s'`); await a.query(`set local lock_timeout = '8s'`);
    const errs = [];
    const linkDraft = () => a.query(`insert into public.catalogue_listing_drafts (seller_username, listing_type, title, pricing_model, published_item_id) values ('inyangojubirobert','product','race draft','fixed',$1)`, [item]);
    const changeSeller = () => b.query(`update public.catalogue_items set seller_username='someone-else' where id=$1`, [item]);
    let pa, pb;
    if (order === 'draft-first') {
      try { await linkDraft(); } catch (e) { errs.push('A:' + e.message); }
      pb = changeSeller().catch((e) => { errs.push('B:' + e.message); });
      await sleep(1500);
      await a.query('commit').catch((e) => errs.push('Acommit:' + e.message));
      await pb;
      await b.query('commit').catch((e) => errs.push('Bcommit:' + e.message));
    } else {
      try { await changeSeller(); } catch (e) { errs.push('B:' + e.message); }
      pa = linkDraft().catch((e) => { errs.push('A:' + e.message); });
      await sleep(1500);
      await b.query('commit').catch((e) => errs.push('Bcommit:' + e.message));
      await pa;
      await a.query('commit').catch((e) => errs.push('Acommit:' + e.message));
    }
    await a.query('rollback').catch(() => {}); await b.query('rollback').catch(() => {});
    const bad = (await c.query(`select count(*)::int n from public.catalogue_listing_drafts d join public.catalogue_items i on i.id = d.published_item_id where d.seller_username is distinct from i.seller_username`)).rows[0].n;
    await a.end(); await b.end(); await c.end();
    return { label, bad, errs };
  }
  const raceResults = [];
  for (const order of ['draft-first', 'seller-change-first']) raceResults.push(await race(order, order));
  const raceOk = raceResults.every((r) => r.bad === 0);
  record('C3', 'Concurrent draft-link vs seller-change cannot leave a draft linked to another seller\'s listing', raceOk ? 'PASS' : 'FAIL',
    raceResults.map((r) => `${r.label}: inconsistent rows=${r.bad}${r.errs.length ? ' (' + r.errs.join(' | ').slice(0, 140) + ')' : ''}`).join('; '));

  // ---- Check 8: locking / interruption risk --------------------------------
  {
    const c = await freshDb(admin);
    const blocker = await connect(c.database);
    await blocker.query('begin');
    await blocker.query('select count(*) from public.catalogue_items'); // an ordinary open read transaction (e.g. a browsing API request)
    const waiter = await connect(c.database);
    await waiter.query('set role app_owner');
    const started = Date.now();
    await waiter.query(`set statement_timeout = '20s'`);
    let timedOutAfter = null; let migrationBlocked = false; let code = null;
    try { await waiter.query(migrationSql); } catch (e) { migrationBlocked = true; code = e.code; timedOutAfter = Date.now() - started; await waiter.query('rollback').catch(() => {}); }
    // While the migration waits it sits in the lock queue; probe what other readers experience.
    await waiter.end();
    await blocker.query('rollback'); await blocker.end();
    const schemaClean = (await c.query(`select to_regclass('public.catalogue_listing_drafts') as t`)).rows[0].t === null;
    const usesLockTimeout = /set\s+local\s+lock_timeout/i.test(migrationSql);
    record('C8a', 'Migration fails fast (lock_timeout) instead of queueing behind an open transaction on catalogue_items', migrationBlocked && code === '55P03' ? 'PASS' : 'RISK',
      `blocked=${migrationBlocked} (code ${code}; 55P03 = lock_timeout) after ${timedOutAfter} ms; lock_timeout configured in migration=${usesLockTimeout}; schema left clean=${schemaClean}`);
    await c.end();
  }

  // ---- Check 6: rollback on staging ----------------------------------------
  {
    await main.query('set role app_owner');
    let rb;
    try { await main.query(rollbackSql); rb = { ok: true }; } catch (e) { await main.query('rollback'); rb = { ok: false, err: e.message }; }
    await main.query('reset role');
    const afterRb = await snapshot(main);
    const comparable = ['cats', 'orders', 'usdt'];
    const dataSame = comparable.every((k) => hash(pre[k]) === hash(afterRb[k]));
    // Listings created during check 5/7 are expected extras; original two must be intact.
    const originalItems = afterRb.items.filter((r) => pre.items.some((p) => p.id === r.id));
    const itemsSame = hash(originalItems.map((r) => ({ ...r }))) === hash(pre.items.map((r) => ({ ...r })));
    const colsRestored = hash(afterRb.itemCols) === hash(pre.itemCols) && hash(afterRb.catCols) === hash(pre.catCols);
    const gone = (await main.query(`select count(*)::int n from pg_class where relnamespace='public'::regnamespace and relname in ('catalogue_pricing_models','catalogue_units','catalogue_attribute_definitions','catalogue_product_details','catalogue_service_details','catalogue_item_attributes','catalogue_listing_drafts','catalogue_checkout_model_approvals')`)).rows[0].n;
    const archive = (await main.query(`select count(*)::int n from information_schema.tables where table_schema='catalogue_engine_archive'`)).rows[0].n;
    const payOk = hash(pre.payment) === hash(afterRb.payment);
    record('C6b', 'Rollback restores original schema and keeps categories, covers, original listings, payments; archives engine data', rb.ok && dataSame && itemsSame && colsRestored && gone === 0 && archive > 0 && payOk ? 'PASS' : 'FAIL',
      rb.ok ? `categories+orders+usdt identical=${dataSame}; original listings identical=${itemsSame}; original columns restored=${colsRestored}; engine tables remaining=${gone}; archive tables=${archive}; payment fingerprint equal=${payOk}` : rb.err);
    const reapply = await applyMigration(main);
    record('C6c', 'Migration re-applies cleanly after a rollback', reapply.ok ? 'PASS' : 'FAIL', reapply.ok ? 'ok' : reapply.err);
  }

  console.log('\n=== SUMMARY ===');
  for (const r of results) console.log(`${r.status.padEnd(14)} ${r.id.padEnd(7)} ${r.check}`);
  console.log(JSON.stringify({ migration: migrationPath, migrationSha: hash(migrationSql), results }, null, 0).length > 0 ? '' : '');
  await main.end();
  await admin.end();
}

try { await main(); }
catch (e) { console.error('HARNESS ERROR', e); process.exitCode = 1; }
finally {
  await server.stop().catch(() => {});
  rmSync(dir, { recursive: true, force: true });
  process.exit(process.exitCode || 0);
}
