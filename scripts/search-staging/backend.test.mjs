import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import { transform } from 'esbuild';
import legacyKeywords from '../../lib/catalogueSearchLegacy.js';
import * as searchService from '../../lib/catalogueSearch.js';
import { searchMarketplace, searchCatalogueCategories, normalizeSearch, parseSearchOptions } from '../../lib/catalogueSearch.js';
import { stagingDatabase, stagingClient } from './database.mjs';

let db, categories, client, requests;
const metrics = { environment: 'isolated in-memory PGlite; synthetic listings; no external network', cases: [], legacyMissing: [] };
const ids = {};
async function item(slug, title, extra = {}) {
  const category = categories.find(c => c.slug === slug);
  const row = { category_id: category.id, title, seller_username: 'local-seller', description: '', created_at: '2025-01-01', ...extra };
  const keys = Object.keys(row);
  const result = await db.query(`insert into catalogue_items (${keys.join(',')}) values (${keys.map((_,i)=>'$'+(i+1)).join(',')}) returning id`, Object.values(row));
  ids[title] = result.rows[0].id;
}
before(async () => {
  ({ db, categories } = await stagingDatabase());
  ({ client, requests } = stagingClient(db));
  await item('fragrances', 'Perfume', { description: 'Men and women fragrance', created_at: '2020-01-01' });
  await item('fragrances', 'Amber evening fragrance');
  await item('shoes', 'Sneakers');
  await item('shoes', 'ZXQ 9000', { description: 'Rare copper trainer', size: 'EU 46', seller_username: 'copper_seller' });
  await item('electrical-installation-repairs', 'Electrician callout', { listing_type: 'service' });
  await item('cakes-pastries-baking', 'Wedding cake', { listing_type: 'service' });
  await item('car-hire-transport', 'Car hire', { listing_type: 'service' });
  await item('shoes', 'Private perfume draft', { status: 'paused' });
  await item('fragrances', 'Deleted perfume', { status: 'deleted' });
  await db.query('insert into participants(name,username,user_code,total_votes) values ($1,$2,$3,$4)', ['Perfume creator','perfume-seller','ABC12345',100]);
});
after(async () => {
  await mkdir('.tmp/search-integration', { recursive: true });
  await writeFile('.tmp/search-integration/backend-results.json', JSON.stringify(metrics,null,2));
  await db?.close();
});

test('local schema reconstructs 17 departments, 187 categories and 825 aliases', async () => {
  assert.equal(categories.length,204);
  assert.equal(categories.filter(c=>!c.parent_id).length,17);
  assert.equal(Number((await db.query('select count(*) from catalogue_search_aliases')).rows[0].count),825);
});

for (const [query,slug,title] of [
  ['perfume','fragrances','Perfume'], ['sneakers','shoes','Sneakers'],
  ['electrician','electrical-installation-repairs','Electrician callout'],
  ["Men's perfume",'fragrances','Perfume'], ['wedding cake','cakes-pastries-baking','Wedding cake'],
  ['car hire','car-hire-transport','Car hire'],
]) test(query + ' finds the original category and active listings', async () => {
  const start=performance.now();
  const data=await searchMarketplace(client,query);
  const elapsed=performance.now()-start;
  assert.equal(data.categorySearch,'rpc');
  assert.deepEqual(data.unavailable,[]);
  assert.ok(data.categories.some(c=>c.category_slug===slug));
  assert.ok(data.items.some(c=>c.id===ids[title]));
  assert.ok(data.items.every(c=>c.status==='active'));
  assert.equal(new Set(data.items.map(c=>c.id)).size,data.items.length);
  assert.equal(data.categories.find(c=>c.category_slug===slug).category_id,categories.find(c=>c.slug===slug).id);
  metrics.cases.push({query,ms:Math.round(elapsed*100)/100,categories:data.categories.map(c=>c.category_slug),items:data.items.map(c=>c.title)});
});

test('specific categories do not bring unrelated department listings; direct titles rank first', async () => {
  const result=await searchMarketplace(client,'perfume');
  assert.equal(result.items[0].title,'Perfume');
  assert.ok(!result.items.some(i=>i.category_id===categories.find(c=>c.slug==='shoes').id));
  assert.equal(result.categories[0].category_slug,'fragrances');
  assert.equal(result.participants[0].username,'perfume-seller');
});

test('unknown searches have a genuine empty state', async () => {
  const result=await searchMarketplace(client,'zzzznotreal');
  assert.deepEqual(result.items,[]); assert.deepEqual(result.categories,[]); assert.deepEqual(result.participants,[]);
});

test('exact, partial and fuzzy category matches retain SQL match labels', async () => {
  assert.equal((await searchCatalogueCategories(client,'Fragrances')).categories[0].match_type,'exact_name');
  assert.equal((await searchCatalogueCategories(client,'perfum')).categories[0].category_slug,'fragrances');
  const fuzzy=await searchMarketplace(client,'perfuem');
  assert.ok(fuzzy.categories.some(c=>c.category_slug==='fragrances' && c.match_type==='fuzzy'));
  assert.deepEqual(fuzzy.items,[],'suggestions must not silently expand listings');
});

test('titles, descriptions, size, seller and unordered multiword searches are independent of aliases', async () => {
  for(const query of ['ZXQ 9000','rare copper','EU 46','copper_seller','9000 ZXQ']) {
    const data=await searchMarketplace(client,query);
    assert.ok(data.items.some(i=>i.id===ids['ZXQ 9000']),query);
  }
});

test('category, department and listing type scopes are intersected and unknown scopes stay empty', async () => {
  const shoes=categories.find(c=>c.slug==='shoes');
  const fashion=categories.find(c=>c.slug==='fashion-beauty');
  assert.equal((await searchMarketplace(client,'Sneakers',{categoryId:shoes.id,departmentId:fashion.id,listingType:'product'})).items[0].title,'Sneakers');
  assert.deepEqual((await searchMarketplace(client,'Sneakers',{categoryId:shoes.id,listingType:'service'})).items,[]);
  assert.deepEqual((await searchMarketplace(client,'perfume',{departmentId:'00000000-0000-0000-0000-000000000000'})).items,[]);
  assert.ok((await searchMarketplace(client,'electrician',{listingType:'service'})).items.every(i=>i.listing_type==='service'));
});

test('missing RPC falls back while listing and participant discovery survive', async () => {
  const {client:fallback}=stagingClient(db,{rpcUnavailable:true});
  const data=await searchMarketplace(fallback,'perfume');
  assert.equal(data.categorySearch,'fallback'); assert.ok(data.unavailable.includes('aliases'));
  assert.equal(data.items[0].title,'Perfume'); assert.equal(data.participants.length,1);
  assert.equal((await searchCatalogueCategories(fallback,'Fragrances')).categories[0].category_slug,'fragrances');
});

test('independent outages preserve healthy result groups; timeouts settle', async () => {
  const {client:noPeople}=stagingClient(db,{failTables:['participants']});
  const data=await searchMarketplace(noPeople,'perfume');
  assert.ok(data.items.length); assert.ok(data.categories.length); assert.deepEqual(data.unavailable,['participants']);
  const {client:noItems}=stagingClient(db,{failTables:['catalogue_items']});
  assert.ok((await searchMarketplace(noItems,'perfume')).unavailable.includes('items'));
  const {client:noRpc}=stagingClient(db,{hangRpc:true});
  const start=performance.now();
  assert.equal((await searchCatalogueCategories(noRpc,'Fragrances',{timeoutMs:30})).categorySearch,'fallback');
  assert.ok(performance.now()-start<1000);
});

test('input limits and filter metacharacters cannot widen results or execute SQL', async () => {
  assert.equal(normalizeSearch('a'.repeat(5000)).length,200);
  assert.deepEqual(parseSearchOptions({listing_type:'future_type'}),{listingType:'future_type'});
  for(const params of [{q:['a','b'],category_id:['x']},{department_id:'not-a-uuid'},{listing_type:'x),status.eq.paused'}]) {
    assert.throws(()=>parseSearchOptions(params));
  }
  for(const query of ['%%%','***','___',' \\ ', 'x"),status.eq.paused', "'; drop table catalogue_items; --"]) {
    const result=await searchMarketplace(client,query);
    assert.deepEqual(result.items,[],query);
  }
  assert.equal((await db.query('select count(*) from catalogue_items')).rows.length,1);
  assert.ok(requests.every(r=>r.method==='GET'||r.table==='search_catalogue_categories'));
  assert.equal((await searchMarketplace(client,'copper_seller')).items[0].title,'ZXQ 9000');
});

test('new terminology, categories and listing types appear without client changes', async () => {
  const department=categories.find(c=>c.slug==='technology');
  const result=await db.query("insert into catalogue_categories(name,slug,parent_id) values ('Orbital Repairs','orbital-repairs',$1) returning *",[department.id]);
  const category=result.rows[0];
  categories.push(category);
  await item(category.slug,'Station tune-up',{listing_type:'future_type'});
  await db.query('insert into catalogue_search_aliases(category_id,alias) values ($1,$2)',[category.id,'spaceship mechanic']);
  const data=await searchMarketplace(client,'spaceship mechanic');
  assert.equal(data.categories[0].category_id,category.id);
  assert.equal(data.items[0].listing_type,'future_type');
});

test('anonymous role can search but cannot change aliases', async () => {
  await db.exec('set role anon');
  try {
    assert.ok((await db.query("select * from search_catalogue_categories('perfume',20)")).rows.length);
    await assert.rejects(db.query("insert into catalogue_search_aliases(category_id,alias) select id,'forbidden' from catalogue_categories limit 1"),/permission denied/);
  } finally { await db.exec('reset role'); }
});

test('legacy keyword coverage audit controls retirement of the offline map', async () => {
  const keywords=legacyKeywords;
  let checked=0;
  for(const [slug,words] of Object.entries(keywords)) for(const word of words) {
    checked++;
    const rows=(await db.query('select * from search_catalogue_categories($1,500)',[word])).rows;
    if(!rows.some(row=>row.category_slug===slug)) {
      metrics.legacyMissing.push({slug,word});
      const preserved=await searchCatalogueCategories(client,word);
      assert.ok(preserved.categories.some(row=>row.category_slug===slug),'Lost legacy search '+word+' -> '+slug);
    }
  }
  metrics.legacyChecked=checked;
  assert.ok(checked>200);
});

async function route(path) {
  const source=await readFile(path,'utf8');
  const bundled=await transform(source,{format:'cjs',loader:'js'});
  const module={exports:{}};
  vm.runInNewContext(bundled.code,{module,exports:module.exports,process:{env:{SUPABASE_URL:'https://search-staging.invalid',SUPABASE_ANON_KEY:'local'}},require:(id)=>{
    if(id==='@supabase/supabase-js')return {createClient:()=>client};
    if(id.endsWith('catalogueSearch'))return searchService;
    if(id.endsWith('participantAuth'))return {requireParticipant(){throw Error('GET called write authentication')}};
    throw Error('Unexpected import '+id);
  },AbortController,setTimeout,clearTimeout,console});
  return module.exports.default;
}
async function call(handler,query,method='GET') {
  let status=200,body;
  const res={status(value){status=value;return this;},json(value){body=value;return this;}};
  await handler({method,query},res);
  return {status,body};
}
test('both API adapters use the shared contract, reject arrays and keep unfiltered directory reads', async () => {
  const search=await route('pages/api/onedream/search.js');
  const directory=await route('pages/api/catalogue/categories.js');
  assert.equal((await call(search,{q:'perfume'})).body.items[0].title,'Perfume');
  assert.equal((await call(search,{q:['a','b']})).status,400);
  assert.equal((await call(search,{q:'perfume',category_id:'invalid'})).status,400);
  assert.equal((await call(search,{},'POST')).status,405);
  assert.equal((await call(directory,{q:'perfume'})).body.categories[0].category_slug,'fragrances');
  assert.equal((await call(directory,{q:['a','b']})).status,400);
  assert.ok((await call(directory,{})).body.categories.length>=204);
});

test('bounded warm-query latency sample', async () => {
  const times=[];
  for(let i=0;i<20;i++) {
    const start=performance.now();await searchMarketplace(client,['perfume','sneakers','wedding cake','zzzznotreal'][i%4]);times.push(performance.now()-start);
  }
  times.sort((a,b)=>a-b);
  metrics.performance={samples:times.length,p50Ms:+times[9].toFixed(2),p95Ms:+times[18].toFixed(2),maxMs:+times.at(-1).toFixed(2)};
  const start=performance.now(); await searchMarketplace(client,'adversarial '.repeat(5000));
  metrics.performance.largeInputMs=+(performance.now()-start).toFixed(2);
  console.log(JSON.stringify({performance:metrics.performance,legacyMissing:metrics.legacyMissing.length,legacyChecked:metrics.legacyChecked}));
});
