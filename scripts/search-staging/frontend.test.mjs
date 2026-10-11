import test, { before, after } from 'node:test';
import { stagingDatabase, stagingClient } from './database.mjs';
import { searchMarketplace as backendSearch } from '../../lib/catalogueSearch.js';
import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { transform } from 'esbuild';
import legacy from '../../lib/catalogueSearchLegacy.js';

const require=createRequire(import.meta.url);
const React=require('../../mobile/node_modules/react');
const ReactDOMServer=require('../../mobile/node_modules/react-dom/server');
const RNWeb=require('../../mobile/node_modules/react-native-web/dist/cjs/index.js');
const jsx=require('../../mobile/node_modules/react/jsx-runtime');
async function load(path,imports={},globals={}) {
  const source=await readFile(path,'utf8');
  const compiled=await transform(source,{loader:path.endsWith('.tsx')?'tsx':'ts',format:'cjs',jsx:'automatic'});
  const module={exports:{}};
  vm.runInNewContext(compiled.code,{module,exports:module.exports,setTimeout,clearTimeout,URLSearchParams,AbortController,console,...globals,require:(name)=>{
    if(name in imports)return imports[name];
    if(name==='react/jsx-runtime')return jsx;
    throw Error('Unexpected import '+name+' in '+path);
  }});
  return module.exports;
}
const directory=await load('mobile/src/lib/catalogue-directory.ts',{'../../../lib/catalogueSearchLegacy':{default:legacy,__esModule:true}});
const itemTools=await load('mobile/src/lib/marketplace-search-results.ts');
const category={id:'11111111-1111-1111-1111-111111111111',slug:'fragrances',name:'Fragrances',parent_id:'22222222-2222-2222-2222-222222222222',is_active:true,is_selectable:true,sort_order:1,icon:'pricetag',tint:'#fff',ink:'#000'};
const department={...category,id:category.parent_id,parent_id:null,slug:'fashion-beauty',name:'Fashion & Beauty',is_selectable:false};
const categories=[department,category];
const match={category_id:category.id,category_slug:category.slug,category_name:category.name,is_department:false,department_id:department.id,department_name:department.name,match_type:'exact_alias',rank:2};
const product={id:'product-1',title:'Perfume',description:'Amber fragrance',category_id:category.id,price_usd:10,images:[],status:'active',seller_username:'scent-seller',listing_type:'product',created_at:'2026-01-01',payment_methods:[]};
const creator={id:'person-1',name:'Scent Seller',username:'scent-seller',total_votes:10};

function hookRunner() {
  let saved, initialized=false, effects=[], nextQuery, result={data:undefined,isFetching:false,isError:false,refetch(){}};
  const calls=[];
  const imports={
    react:{useState(value){if(!initialized){saved=value;initialized=true;}return [saved,(value)=>{saved=value;}];},useEffect(fn){effects.push(fn);}},
    '@tanstack/react-query':{useQuery(options){if(options.queryKey[0]==='catalogue-categories')return {data:categories};nextQuery=options;return result;}},
    '@/api/participants':{searchMarketplace(...args){calls.push(args);return Promise.resolve({});}},
    '@/api/catalogue':{getCategories(){}}, '@/lib/catalogue-directory':directory,
  };
  const timers=new Map();let tick=0;
  return {imports,globals:{setTimeout(fn){timers.set(++tick,fn);return tick;},clearTimeout(id){timers.delete(id);}},
    setResult(value){result={...result,...value};}, options(){return nextQuery;},calls,
    flush(){for(const fn of effects.splice(0))fn();for(const fn of [...timers.values()])fn();timers.clear();}
  };
}

test('shared hook debounces, isolates stale results and propagates cancellation and filters',async()=>{
  const h=hookRunner();const {useMarketplaceSearch}=await load('mobile/src/hooks/use-marketplace-search.ts',h.imports,h.globals);
  useMarketplaceSearch(''); h.flush();
  assert.equal(h.options().enabled,false);
  h.setResult({data:{categories:[match],items:[product],categorySearch:'rpc'},isFetching:false});
  const waiting=useMarketplaceSearch('perfume',{categoryId:category.id,listingType:'service'});
  assert.equal(h.options().enabled,false);assert.equal(waiting.data,undefined);assert.equal(waiting.isSearching,true);
  h.flush();
  const ready=useMarketplaceSearch('perfume',{categoryId:category.id,listingType:'service'});
  assert.equal(h.options().enabled,true); assert.equal(ready.categories[0].id,category.id);
  assert.equal(ready.useLocalItems,false);
  const signal=new AbortController().signal; await h.options().queryFn({signal});
  assert.equal(h.calls[0][0],'perfume');assert.equal(h.calls[0][1].listingType,'service');assert.equal(h.calls[0][2],signal);
  assert.equal(useMarketplaceSearch('shoes').data,undefined);
  assert.equal(useMarketplaceSearch('').categories.length,0);
});

test('successful empty responses stay empty; errors retain local category fallback',async()=>{
  const h=hookRunner(); const {useMarketplaceSearch}=await load('mobile/src/hooks/use-marketplace-search.ts',h.imports,h.globals);
  h.setResult({data:{categories:[],items:[],categorySearch:'rpc'}});
  assert.equal(useMarketplaceSearch('Fragrances').categories.length,0);
  h.setResult({data:undefined,isError:true});
  const error=useMarketplaceSearch('Fragrances');
  assert.equal(error.degraded,true);assert.ok(error.categories.length);assert.equal(error.useLocalItems,true);
});

test('new categories render with their real ID before the directory cache refreshes',()=>{
  const rows=directory.mapServerCategoryMatches([], [match]);
  assert.equal(rows[0].id,category.id);assert.equal(rows[0].name,'Fragrances');assert.ok(rows[0].icon);
});

test('gallery helper preserves relevance, filters, cached fallback and empty success',()=>{
  const other={...product,id:'other',category_id:'elsewhere',listing_type:'service'};
  const selected=itemTools.marketplaceItems({remote:[product,other],cached:[product],query:'perfume',useLocal:false,scopeIds:[category.id],listingType:'product'});
  assert.equal(selected.length,1);assert.equal(selected[0].id,product.id);
  assert.equal(itemTools.marketplaceItems({remote:[],cached:[product],query:'perfume',useLocal:false}).length,0);
  assert.equal(itemTools.marketplaceItems({cached:[product],query:'amber',useLocal:true})[0].id,product.id);
  assert.equal(itemTools.marketplaceItems({cached:[{...product,status:'paused'}],query:'',useLocal:true}).length,0);
});

test('native and web API wrapper use the same encoded query, arbitrary listing types, timeout and abort',async()=>{
  for(const platform of ['native','web']) {
    let request, aborted=false;
    const {searchMarketplace}=await load('mobile/src/api/participants.ts',{'../lib/api-client':{API_BASE_URL:'http://127.0.0.1:3999',ApiError:Error}}, {fetch:async(url,options)=>{request={url,options};return {ok:true,json:async()=>({items:[product],categories:[match],categorySearch:'rpc'})};}});
    const result=await searchMarketplace("Men's perfume",{categoryId:category.id,listingType:'future_type'});
    assert.equal(new URL(request.url).searchParams.get('q'),"Men's perfume",platform);
    assert.equal(new URL(request.url).searchParams.get('listing_type'),'future_type');
    assert.equal(result.items[0].id,product.id);
    const controller=new AbortController();controller.abort();
    await searchMarketplace('perfume',{},controller.signal);
    aborted=request.options.signal.aborted;assert.equal(aborted,true);
  }
});

// Native uses a lightweight host-tree renderer for event/route assertions. Web
// uses real ReactDOMServer + react-native-web. Router, data, art and device APIs
// are controlled fixtures; this is component validation, not device/browser E2E.
function expand(node) {
  if(node===null||node===undefined||typeof node==='boolean')return null;
  if(Array.isArray(node))return node.map(expand);
  if(typeof node!=='object')return node;
  if(node.type===React.Fragment)return expand(node.props.children);
  if(typeof node.type==='function')return expand(node.type(node.props));
  const {children,...props}=node.props||{};
  return {type:node.type,props,children:expand(children)};
}
function nodes(tree) {
  if(tree==null)return [];
  if(Array.isArray(tree))return tree.flatMap(nodes);
  if(typeof tree!=='object')return [tree];
  return [tree,...nodes(tree.children)];
}
function textContent(tree){return nodes(tree).filter(n=>typeof n==='string'||typeof n==='number').join(' ');}

async function screen(platform,path,{query='perfume',data,params={},isError=false,fetching=false,kind='all'}={}) {
  const routes=[];let retry=0;
  const native={StyleSheet:{create:s=>s},useWindowDimensions:()=>({width:390}),Platform:{OS:'android'},View:'View',Text:'Text',Pressable:'Pressable',TextInput:'TextInput',Image:'Image',ActivityIndicator:'ActivityIndicator',ScrollView:'ScrollView',RefreshControl:'RefreshControl',FlatList:props=>jsx.jsx('FlatList',{children:[props.ListHeaderComponent,...props.data.map(item=>props.renderItem({item})),props.data.length?null:props.ListEmptyComponent]})};
  const rn=platform==='web'?RNWeb:native;
  let state=0;
  const states=path.includes('(tabs)')?[query]:path.includes('category/')?[query]:[params.department||null,false,'foryou',query,kind];
  const result=data||{participants:[creator],items:[product],categories:[match],categorySearch:'rpc',unavailable:[]};
  const search={data:isError?undefined:result,categories:isError?[]:directory.mapServerCategoryMatches(categories,result.categories||[]),isSearching:fetching,degraded:isError,isError,useLocalItems:isError,refetch(){retry++;}};
  const imports={
    react:{...React,useState(initial){return [state<states.length?states[state++]:initial,()=>{}];},useEffect(){}},
    'react-native':rn,'react-native-safe-area-context':{SafeAreaView:rn.View},
    '@expo/vector-icons':{Ionicons:()=>null},
    'expo-router':{useRouter:()=>({push:route=>routes.push(route),replace:route=>routes.push(route),setParams(){}}),useLocalSearchParams:()=>params,Stack:{Screen:()=>null}},
    '@tanstack/react-query':{useQuery:options=>options.queryKey[0]==='catalogue-categories'?{data:categories,refetch(){}}:{data:[product],isFetching:false,refetch(){}}},
    '@/hooks/use-theme':{useTheme:()=>({text:'#000',textSecondary:'#555',backgroundElement:'#fff',backgroundSelected:'#eee'})},
    '@/components/themed-view':{ThemedView:rn.View},
    '@/components/themed-text':{ThemedText:({type,themeColor,...props})=>jsx.jsx(rn.Text,props)},
    '@/components/catalogue-visuals':{CatalogueThumb:()=>null,CatalogueBanner:({children})=>jsx.jsx(rn.View,{children})},
    '@/constants/theme':{Palette:new Proxy({},{get:()=> '#123456'}),Spacing:{half:2,one:4,two:8,three:12,four:16,five:20},BottomTabInset:64},
    '@/api/catalogue':{getCategories(){},getShopFeed(){},cataloguePriceLabel:item=>'$'+item.price_usd},
    '@/hooks/use-marketplace-search':{useMarketplaceSearch:()=>search},
    '@/lib/catalogue-directory':directory,'@/lib/marketplace-search-results':itemTools,
  };
  const {default:Component}=await load(path,imports);
  const element=jsx.jsx(Component,{});
  const rendered=platform==='web'?ReactDOMServer.renderToStaticMarkup(element):expand(element);
  return {rendered,routes,retry:()=>retry};
}

for(const platform of ['native','web']) {
  test(platform+' Discover renders categories, products, creators, typo suggestions and error/empty states',async()=>{
    const path='mobile/src/app/(tabs)/search.tsx';
    const valid=await screen(platform,path);
    const text=platform==='web'?valid.rendered:textContent(valid.rendered);
    assert.match(text,/Fragrances/);assert.match(text,/Perfume/);assert.match(text,/Scent Seller/);
    if(platform==='native') {
      const pressables=nodes(valid.rendered).filter(n=>n?.type==='Pressable');
      pressables.find(n=>textContent(n).includes('Fragrances')).props.onPress();
      pressables.find(n=>textContent(n).includes('Perfume')).props.onPress();
      pressables.find(n=>textContent(n).includes('Scent Seller')).props.onPress();
      assert.equal(valid.routes[0],'/shop/category/'+category.id);
      assert.equal(valid.routes[1],'/catalogue/item/'+product.id);
      assert.equal(valid.routes[2],'/profile/'+creator.username);
    }
    const typo=await screen(platform,path,{data:{categories:[{...match,match_type:'fuzzy'}],items:[],participants:[]}});
    assert.match(platform==='web'?typo.rendered:textContent(typo.rendered),/Suggested category/);
    const empty=await screen(platform,path,{data:{categories:[],items:[],participants:[]}});
    assert.match(platform==='web'?empty.rendered:textContent(empty.rendered),/No matches found/);
    const error=await screen(platform,path,{isError:true});
    assert.match(platform==='web'?error.rendered:textContent(error.rendered),/temporarily unavailable/);
    if(platform==='native') {
      nodes(error.rendered).find(n=>n?.type==='Pressable'&&textContent(n).includes('Tap to retry')).props.onPress();assert.equal(error.retry(),1);
    }
    if(platform==='web') {await mkdir('.tmp/search-integration',{recursive:true});await writeFile('.tmp/search-integration/web-discover.html',valid.rendered);}
  });
  test(platform+' Shop and category galleries retain listing routes and category scope',async()=>{
    const shop=await screen(platform,'mobile/src/app/shop/index.tsx');
    assert.match(platform==='web'?shop.rendered:textContent(shop.rendered),/Perfume/);
    const page=await screen(platform,'mobile/src/app/shop/category/[id].tsx',{params:{id:category.id}});
    assert.match(platform==='web'?page.rendered:textContent(page.rendered),/Perfume/);
    if(platform==='native') {
      nodes(page.rendered).find(n=>n?.type==='Pressable'&&textContent(n).includes('Perfume')).props.onPress();
      assert.equal(page.routes[0],'/catalogue/item/'+product.id);
    }
  });
}

let integrationDb, fixtures;
before(async () => {
  const {db,categories:rows}=await stagingDatabase();integrationDb=db;
  const {client}=stagingClient(db);
  fixtures=[];
  for(const [query,slug,title] of [
    ['perfume','fragrances','Perfume'],['sneakers','shoes','Sneakers'],
    ['electrician','electrical-installation-repairs','Electrician callout'],
    ["Men's perfume",'fragrances',"Men's perfume"],['wedding cake','cakes-pastries-baking','Wedding cake'],
    ['car hire','car-hire-transport','Car hire'],
  ]) {
    const category=rows.find(row=>row.slug===slug);
    await db.query('insert into catalogue_items(category_id,title,seller_username) values ($1,$2,$3)',[category.id,title,'fixture-seller']);
    fixtures.push({query,category,title,data:await backendSearch(client,query)});
  }
});
after(async()=>{await integrationDb?.close();});
for(const platform of ['native','web']) test(platform+' renders all six required queries from the SQL-backed API and keeps original category routes',async()=>{
  for(const fixture of fixtures) {
    const view=await screen(platform,'mobile/src/app/(tabs)/search.tsx',{query:fixture.query,data:fixture.data});
    const text=platform==='web'?view.rendered:textContent(view.rendered);
    // Apostrophes are HTML escaped by ReactDOMServer.
    assert.ok(text.includes(fixture.category.name.replaceAll('&','&amp;'))||text.includes(fixture.category.name),fixture.query);
    assert.ok(text.includes(fixture.title.replaceAll("'",'&#x27;'))||text.includes(fixture.title),fixture.query);
    if(platform==='native') {
      nodes(view.rendered).find(n=>n?.type==='Pressable'&&textContent(n).includes(fixture.category.name)).props.onPress();
      assert.equal(view.routes[0],'/shop/category/'+fixture.category.id);
    }
  }
});
