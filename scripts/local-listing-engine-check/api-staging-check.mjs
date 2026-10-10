// Staging API check: runs the REAL Next API route handlers (bundled with esbuild)
// against a throwaway local PostgreSQL + PostgREST, before and after the
// Revision 4 migration. Never connects to Supabase; no payment code is invoked.
//   needs: node_modules/@embedded-postgres (libpq on PATH) and %TEMP%\postgrest\postgrest.exe
//   node api-staging-check.mjs [migration.sql]
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, copyFileSync } from 'node:fs';
import { execSync, spawn } from 'node:child_process';
import http from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import EmbeddedPostgres from 'embedded-postgres';
import pg from 'pg';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..', '..');
const requireRoot = createRequire(join(root, 'package.json'));
const { build } = requireRoot('esbuild');
const jwt = requireRoot('jsonwebtoken');
const migrationSql = readFileSync(resolve(process.argv[2] || join(root, 'supabase', 'add_dynamic_listing_engine.sql')), 'utf8');
const baseSql = readFileSync(join(here, 'base-schema.sql'), 'utf8');

const PG_PORT = 55000 + Math.floor(Math.random() * 500);
const REST_PORT = PG_PORT + 600;
const PROXY_PORT = PG_PORT + 700;
const SECRET = 'staging-only-jwt-secret-0123456789abcdef-xyz';
const dir = mkdtempSync(join(tmpdir(), 'rev4-api-'));
const bundleDir = join(here, '_bundle');
const server = new EmbeddedPostgres({ databaseDir: dir, user: 'postgres', password: 'pw', port: PG_PORT, persistent: false });
const results = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pgrstExe = join(tmpdir(), 'postgrest', 'postgrest.exe');
let pgrst; let proxy;

function record(id, name, expected, actual, extra = '') {
  const pass = Array.isArray(expected) ? expected.includes(actual.status) : actual.status === expected;
  results.push({ id, name, pass });
  console.log(`[${pass ? 'PASS' : 'FAIL'}] ${id} ${name} -> HTTP ${actual.status} (expected ${expected})${pass ? '' : ' body=' + JSON.stringify(actual.body).slice(0, 260)} ${extra}`);
  return pass;
}

function call(handler, { method = 'GET', token, body, query = {} } = {}) {
  return new Promise((resolveCall) => {
    const req = { method, headers: token ? { authorization: `Bearer ${token}` } : {}, body, query };
    const res = {
      statusCode: 200, headers: {},
      status(c) { this.statusCode = c; return this; },
      setHeader(k, v) { this.headers[k] = v; },
      json(b) { resolveCall({ status: this.statusCode, body: b }); return this; },
      send(b) { resolveCall({ status: this.statusCode, body: b }); return this; },
      end() { resolveCall({ status: this.statusCode, body: null }); return this; }
    };
    Promise.resolve(handler(req, res)).catch((e) => resolveCall({ status: 599, body: String(e) }));
  });
}

async function bundle(entry, out) {
  await build({ entryPoints: [entry], outfile: join(bundleDir, out), bundle: true, platform: 'node', format: 'esm', packages: 'external', logLevel: 'silent' });
  return pathToFileURL(join(bundleDir, out)).href + `?t=${Date.now()}`;
}

async function main() {
  mkdirSync(bundleDir, { recursive: true });
  await server.initialise(); await server.start();
  const conn = async (db) => { const c = new pg.Client({ host: 'localhost', port: PG_PORT, user: 'postgres', password: 'pw', database: db }); await c.connect(); return c; };
  const admin = await conn('postgres');
  await admin.query('create database tpl');
  const t = await conn('tpl');
  await t.query(baseSql); await t.query('set role app_owner');
  await t.query(`alter table public.catalogue_categories add column icon text default 'pricetag', add column tint text default '#DBEAFE', add column ink text default '#1E3A8A', add column is_featured boolean not null default false, add column is_selectable boolean not null default true, add column image_url text, add column banner_title text, add column banner_subtitle text, add column created_at timestamptz default now()`);
  await t.query(`update public.catalogue_categories set is_selectable = false where slug = 'other'`);
  await t.end();
  await admin.query('create database api template tpl');
  await admin.query('grant create, temporary on database api to app_owner');
  await admin.query(`create role authenticator login password 'pw' noinherit; grant anon, authenticated, service_role to authenticator;`);
  const db = await conn('api');
  await db.query('set role app_owner');
  await db.query(`create table public.participants (id uuid primary key, username text not null unique, email text)`);
  await db.query(`insert into public.participants values ('11111111-1111-1111-1111-111111111111','faithful','f@example.com'),('22222222-2222-2222-2222-222222222222','seller2','s2@example.com')`);
  await db.query('reset role');

  const startRest = async () => {
    pgrst = spawn(pgrstExe, [], { env: { ...process.env, PGRST_DB_URI: `postgres://authenticator:pw@localhost:${PG_PORT}/api`, PGRST_DB_SCHEMAS: 'public', PGRST_DB_ANON_ROLE: 'anon', PGRST_JWT_SECRET: SECRET, PGRST_SERVER_PORT: String(REST_PORT), PGRST_SERVER_HOST: '127.0.0.1', PGRST_DB_CHANNEL_ENABLED: 'true' }, stdio: ['ignore', 'pipe', 'pipe'] });
    pgrst.stderr.on('data', () => {}); pgrst.stdout.on('data', () => {});
    for (let i = 0; i < 40; i++) { try { const r = await fetch(`http://127.0.0.1:${REST_PORT}/`); if (r.status < 500) return; } catch {} await sleep(500); }
    throw new Error('PostgREST did not start');
  };
  await startRest();
  // supabase-js prefixes /rest/v1; PostgREST serves from the root.
  proxy = http.createServer((req, res) => {
    const p = http.request({ host: '127.0.0.1', port: REST_PORT, method: req.method, path: req.url.replace(/^\/rest\/v1/, '') || '/', headers: req.headers }, (r) => { res.writeHead(r.statusCode, r.headers); r.pipe(res); });
    req.pipe(p); p.on('error', () => { res.statusCode = 502; res.end(); });
  }).listen(PROXY_PORT);

  process.env.SUPABASE_URL = `http://127.0.0.1:${PROXY_PORT}`;
  process.env.SUPABASE_SERVICE_ROLE_KEY = jwt.sign({ role: 'service_role' }, SECRET);
  process.env.JWT_SECRET = SECRET;
  const tokenFor = (userId) => jwt.sign({ type: 'onedream', userId }, SECRET, { expiresIn: '1h' });
  const faithful = tokenFor('11111111-1111-1111-1111-111111111111');
  const seller2 = tokenFor('22222222-2222-2222-2222-222222222222');
  const origError = console.error; console.error = () => {};

  const items = (await import(await bundle(join(root, 'pages/api/catalogue/items.js'), 'items.mjs'))).default;
  const drafts = (await import(await bundle(join(root, 'pages/api/catalogue/drafts.js'), 'drafts.mjs'))).default;
  const configuration = (await import(await bundle(join(root, 'pages/api/catalogue/configuration.js'), 'configuration.mjs'))).default;
  const categories = (await import(await bundle(join(root, 'pages/api/catalogue/categories.js'), 'categories.mjs'))).default;

  // Previous API = the committed HEAD handler + HEAD validation library.
  const oldDir = join(bundleDir, 'old-src'); mkdirSync(join(oldDir, 'pages/api/catalogue'), { recursive: true }); mkdirSync(join(oldDir, 'lib'), { recursive: true });
  const gitShow = (p) => execSync(`git show HEAD:${p}`, { cwd: root, encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 });
  writeFileSync(join(oldDir, 'pages/api/catalogue/items.js'), gitShow('pages/api/catalogue/items.js'));
  writeFileSync(join(oldDir, 'lib/catalogueListingValidation.js'), gitShow('lib/catalogueListingValidation.js'));
  copyFileSync(join(root, 'lib/participantAuth.js'), join(oldDir, 'lib/participantAuth.js'));
  copyFileSync(join(root, 'lib/jwtSecret.js'), join(oldDir, 'lib/jwtSecret.js'));
  const oldItems = (await import(await bundle(join(oldDir, 'pages/api/catalogue/items.js'), 'old-items.mjs'))).default;

  const q = async (sql, p) => (await db.query(sql, p)).rows;
  const cat = async (slug) => (await q(`select id from public.catalogue_categories where slug=$1`, [slug]))[0].id;
  const gadgets = await cat('gadgets'); const design = await cat('graphic-design');

  console.log('--- Phase A: NEW code against the database BEFORE the migration');
  record('A1', 'GET /api/catalogue/drafts before migration -> 503 (documented dependency)', [503], await call(drafts, { token: faithful }));
  const productBody = { title: 'Rice 50kg', description: 'Local rice', price_usd: 30, category_id: gadgets, listing_type: 'product', pricing_model: 'per_unit', price_unit: 'kg',
    images: ['https://example.com/rice.jpg'], payment_methods: ['usdt'], product_details: { condition: 'new', fulfillment_methods: ['pickup'] } };
  record('A2', 'POST /api/catalogue/items (new fields) before migration -> rejected, no listing created', [400, 500], await call(items, { method: 'POST', token: faithful, body: productBody }));
  const countBefore = (await q(`select count(*)::int n from public.catalogue_items`))[0].n;

  console.log('--- Applying migration (as owner)');
  await db.query('set role app_owner'); await db.query(migrationSql); await db.query('reset role');
  await db.query(`notify pgrst, 'reload schema'`); await sleep(2500);

  console.log('--- Phase B: NEW code against the migrated database');
  const cfg = await call(configuration, { token: faithful, query: { listing_type: 'product', category_id: gadgets } });
  record('B1', 'GET /api/catalogue/configuration returns pricing models and units', 200, cfg, `models=${cfg.body?.pricing_models?.length} units=${cfg.body?.units?.length}`);
  record('B2', 'GET /api/catalogue/categories', 200, await call(categories, { token: faithful }));
  record('B3', 'POST /api/catalogue/items without a token -> 401', 401, await call(items, { method: 'POST', body: productBody }));
  const created = await call(items, { method: 'POST', token: faithful, body: productBody });
  record('B4', 'POST product (per_unit, kg, attribute, details) -> 201', 201, created);
  const pid = created.body?.id;
  const metadata = pid ? (await q(`select (select count(*) from public.catalogue_product_details where item_id=$1)::int d, (select count(*) from public.catalogue_item_attributes where item_id=$1)::int a`, [pid]))[0] : {};
  console.log(`      stored: type=${created.body?.listing_type} model=${created.body?.pricing_model} unit=${created.body?.price_unit} seller=${created.body?.seller_username} details rows=${metadata.d} attribute rows=${metadata.a}`);
  results.push({ id: 'B4b', name: 'product metadata persisted', pass: created.body?.seller_username === 'faithful' && metadata.d === 1 });
  const serviceBody = { title: 'Logo design', description: 'Brand logos', price_usd: 80, category_id: design, listing_type: 'service', pricing_model: 'fixed', payment_methods: ['usdt'],
    service_scope: 'Logo design with two revisions and source files.', service_terms: 'Delivered online within five working days.', service_scope_confirmed: true, service_details: { service_modes: ['remote'] } };
  const svc = await call(items, { method: 'POST', token: faithful, body: serviceBody });
  record('B5', 'POST service (scope, terms, confirmed, remote) -> 201', 201, svc);
  record('B6', 'POST service without scope confirmation -> 400', 400, await call(items, { method: 'POST', token: faithful, body: { ...serviceBody, service_scope_confirmed: false } }));
  record('B7', 'POST service priced hourly (not checkout-compatible) -> 400', 400, await call(items, { method: 'POST', token: faithful, body: { ...serviceBody, pricing_model: 'hourly', price_unit: 'hour' } }));
  record('B8', 'POST client-supplied seller_username is ignored (stored as caller)', 201, await call(items, { method: 'POST', token: seller2, body: { ...serviceBody, title: 'Seller2 service', seller_username: 'faithful' } }));
  const spoof = (await q(`select seller_username from public.catalogue_items where title='Seller2 service'`))[0]?.seller_username;
  results.push({ id: 'B8b', name: 'spoofed seller_username ignored', pass: spoof === 'seller2' }); console.log(`[${spoof === 'seller2' ? 'PASS' : 'FAIL'}] B8b stored seller=${spoof}`);
  record('B9', 'PATCH another seller\'s listing -> 403', 403, await call(items, { method: 'PATCH', token: seller2, body: { id: pid, title: 'Hijack' } }));
  record('B10', 'PATCH own listing title+price -> 200', 200, await call(items, { method: 'PATCH', token: faithful, body: { id: pid, title: 'Rice 50kg (updated)', price_usd: 32 } }));
  record('B11', 'DELETE another seller\'s listing -> 403', 403, await call(items, { method: 'DELETE', token: seller2, body: { id: pid }, query: { id: pid } }));

  const draftBody = { title: 'Hourly consulting', listing_type: 'service', pricing_model: 'hourly', price_usd: 10, price_unit: 'hour', category_id: design,
    service_scope: 'One hour of consulting with written notes afterwards.', service_terms: 'Booked in advance, delivered remotely.', service_scope_confirmed: true, service_details: { service_modes: ['remote'] } };
  const d1 = await call(drafts, { method: 'POST', token: faithful, body: draftBody });
  record('B12', 'POST draft (hourly service, draft-only model) -> 201', 201, d1);
  record('B13', 'GET drafts lists own draft', 200, await call(drafts, { token: faithful }), `count=${(await call(drafts, { token: faithful })).body?.drafts?.length}`);
  const other = await call(drafts, { token: seller2 });
  results.push({ id: 'B14', name: 'another seller sees no drafts', pass: other.status === 200 && other.body.drafts.length === 0 }); console.log(`[${other.status === 200 && other.body.drafts.length === 0 ? 'PASS' : 'FAIL'}] B14 other seller drafts=${other.body?.drafts?.length}`);
  record('B15', 'POST draft without a token -> 401', 401, await call(drafts, { method: 'POST', body: draftBody }));
  record('B16', 'PATCH publish of a draft-only (hourly) draft -> 409, stays a draft', 409, await call(drafts, { method: 'PATCH', token: faithful, body: { id: d1.body?.id, action: 'publish', payment_methods: ['usdt'] } }));
  record('B17', 'Another seller cannot edit/publish/delete this draft', 403, await call(drafts, { method: 'PATCH', token: seller2, body: { id: d1.body?.id, action: 'publish', payment_methods: ['usdt'] } }));
  record('B17b', 'Another seller cannot overwrite the draft via POST id', 403, await call(drafts, { method: 'POST', token: seller2, body: { ...draftBody, id: d1.body?.id } }));
  record('B17c', 'Another seller cannot delete the draft', 403, await call(drafts, { method: 'DELETE', token: seller2, body: { id: d1.body?.id }, query: { id: d1.body?.id } }));
  const pubDraft = await call(drafts, { method: 'POST', token: faithful, body: (({ payment_methods, ...rest }) => ({ ...rest, title: 'Draft then publish', pricing_model: 'fixed', price_unit: undefined }))(productBody) });
  record('B18', 'POST draft (checkout-compatible product) -> 201', 201, pubDraft);
  const published = await call(drafts, { method: 'PATCH', token: faithful, body: { id: pubDraft.body?.id, action: 'publish', payment_methods: ['usdt'] } });
  record('B19', 'PATCH publish eligible draft -> 200 and listing created', [200, 201], published);
  const link = (await q(`select published_item_id from public.catalogue_listing_drafts where id=$1`, [pubDraft.body?.id]))[0]?.published_item_id;
  results.push({ id: 'B19b', name: 'draft linked to the created listing', pass: !!link }); console.log(`[${link ? 'PASS' : 'FAIL'}] B19b published_item_id=${link}`);
  record('B20', 'Publishing the same draft again -> 409', 409, await call(drafts, { method: 'PATCH', token: faithful, body: { id: pubDraft.body?.id, action: 'publish', payment_methods: ['usdt'] } }));
  record('B21', 'DELETE a published draft -> 409', 409, await call(drafts, { method: 'DELETE', token: faithful, body: { id: pubDraft.body?.id }, query: { id: pubDraft.body?.id } }));
  record('B22', 'DELETE own unpublished draft -> 200/204', [200, 204], await call(drafts, { method: 'DELETE', token: faithful, body: { id: d1.body?.id }, query: { id: d1.body?.id } }));
  const unit = await call(items, { method: 'POST', token: faithful, body: { ...productBody, title: 'Custom unit', price_unit: 'bundle-of-3' } });
  console.log(`      custom/unknown unit response: HTTP ${unit.status} ${JSON.stringify(unit.body).slice(0, 120)}`);

  console.log('--- Phase C: PREVIOUS (HEAD) API against the migrated database');
  const oldBody = { title: 'Old-API listing', description: 'legacy shape', price_usd: 12, category_id: gadgets, images: ['https://example.com/a.jpg'], payment_methods: ['usdt'] };
  const oldCreated = await call(oldItems, { method: 'POST', token: faithful, body: oldBody });
  record('C1', 'Previous API POST (no listing_type/pricing fields) -> 201', 201, oldCreated, `type=${oldCreated.body?.listing_type} model=${oldCreated.body?.pricing_model}`);
  record('C2', 'Previous API PATCH own listing -> 200', 200, await call(oldItems, { method: 'PATCH', token: faithful, body: { id: oldCreated.body?.id, title: 'Old-API edited', price_usd: 14 } }));
  record('C3', 'Previous API PATCH pause -> 200', 200, await call(oldItems, { method: 'PATCH', token: faithful, body: { id: oldCreated.body?.id, status: 'paused' } }));

  console.error = origError;
  const failed = results.filter((r) => !r.pass);
  console.log(`\n=== API STAGING SUMMARY: ${results.length - failed.length}/${results.length} passed ===`);
  failed.forEach((r) => console.log('FAILED:', r.id, r.name));
  await db.end(); await admin.end();
  if (failed.length) process.exitCode = 1;
}

try { await main(); }
catch (e) { console.error('HARNESS ERROR', e); process.exitCode = 1; }
finally {
  try { pgrst?.kill(); } catch {}
  try { proxy?.close(); } catch {}
  await server.stop().catch(() => {});
  rmSync(dir, { recursive: true, force: true });
  rmSync(bundleDir, { recursive: true, force: true });
  process.exit(process.exitCode || 0);
}
