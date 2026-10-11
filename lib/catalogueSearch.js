import legacyKeywords from './catalogueSearchLegacy.js';

// Read-only discovery shared by API routes; client injection permits isolated tests.
export const SEARCH_LIMIT = 40;
export const SEARCH_TIMEOUT_MS = 4000;
const ITEM_FIELDS = 'id,seller_username,title,description,size,price_usd,images,category_id,listing_type,pricing_model,price_unit,promo_video_url,payment_methods,status,created_at';
const TEXT_FIELDS = ['title', 'description', 'size', 'seller_username'];

export function normalizeSearch(value) {
  if (typeof value !== 'string') return '';
  // Keep literal text (including underscores in seller names); remove only
  // control characters and PostgREST's * wildcard alias.
  return value.slice(0, 200).replace(/[*\x00-\x1f]/g, ' ').replace(/\s+/g, ' ').trim();
}

function tokensFor(query) {
  return [...new Set(query.toLowerCase().match(/[\p{L}\p{N}]+/gu) || [])]
    .filter((word) => word.length > 1).slice(0, 12);
}

function escapeLike(query) {
  return query.replace(/[\\%_]/g, (character) => '\\' + character);
}

export function textFilter(fields, query) {
  // Quoting prevents commas, parentheses and quotes becoming filter operators.
  const pattern = JSON.stringify(`%${escapeLike(query)}%`);
  return fields.map((field) => `${field}.ilike.${pattern}`).join(',');
}

async function read(build, timeoutMs = SEARCH_TIMEOUT_MS) {
  const controller = new AbortController();
  let timer;
  try {
    return await Promise.race([
      Promise.resolve().then(() => build(controller.signal)),
      new Promise((resolve) => {
        timer = setTimeout(() => {
          controller.abort();
          resolve({ data: null, error: { code: 'SEARCH_TIMEOUT' } });
        }, timeoutMs);
      }),
    ]);
  } catch {
    return { data: null, error: { code: 'SEARCH_UNAVAILABLE' } };
  } finally {
    clearTimeout(timer);
  }
}

export async function searchCatalogueCategories(client, input, { timeoutMs } = {}) {
  const query = normalizeSearch(input);
  if (!/[\p{L}\p{N}]/u.test(query)) return { categories: [], categorySearch: 'rpc' };
  const legacyRanks = new Map(Object.entries(legacyKeywords).flatMap(([slug, words]) => {
    const needle = query.toLowerCase();
    return words.some((word) => word.includes(needle))
      ? [[slug, words.includes(needle) ? 2 : 4]] : [];
  }));
  const [result, legacy] = await Promise.all([
    read((signal) => client.rpc('search_catalogue_categories', {
      search_term: query.replace(/[%_\\]/g, ' '), result_limit: 20,
    }).abortSignal(signal), timeoutMs),
    legacyRanks.size ? read((signal) => client.from('catalogue_categories')
      .select('id,name,slug,parent_id').eq('is_active', true).in('slug', [...legacyRanks.keys()])
      .limit(100).abortSignal(signal), timeoutMs) : Promise.resolve({ data: [] }),
  ]);
  const legacyMatches = (legacy.data || []).map((row) => ({
    category_id: row.id, category_name: row.name, category_slug: row.slug,
    is_department: !row.parent_id, department_id: row.parent_id || row.id,
    department_name: row.parent_id ? 'Category' : row.name,
    match_type: 'legacy_keyword', rank: legacyRanks.get(row.slug),
  }));
  const merge = (rows) => {
    const best = new Map();
    for (const row of [...rows, ...legacyMatches]) {
      if (row.match_type === 'fuzzy' && legacyMatches.length) continue;
      if (!best.has(row.category_id) || row.rank < best.get(row.category_id).rank) best.set(row.category_id, row);
    }
    return [...best.values()].sort((a,b) => a.rank-b.rank || Number(a.is_department)-Number(b.is_department)
      || a.category_name.localeCompare(b.category_name)).slice(0,20);
  };
  if (!result.error) return { categories: merge(result.data || []), categorySearch: legacy.error ? 'fallback' : 'rpc' };
  // A successful empty RPC is authoritative; only a failure uses name fallback.
  const fallback = await read((signal) => client.from('catalogue_categories')
    .select('id,name,slug,parent_id').eq('is_active', true)
    .or(textFilter(['name', 'slug'], query)).order('name').limit(20)
    .abortSignal(signal), timeoutMs);
  return {
    categorySearch: fallback.error ? 'unavailable' : 'fallback',
    categories: merge((fallback.data || []).map((row) => ({
      category_id: row.id, category_name: row.name, category_slug: row.slug,
      is_department: !row.parent_id, department_id: row.parent_id || row.id,
      department_name: row.parent_id ? 'Category' : row.name,
      match_type: 'name_fallback', rank: row.name.toLowerCase() === query.toLowerCase() ? 1 : 3,
    }))),
  };
}

export function listingRelevance(item, query) {
  const needle = query.toLowerCase();
  const title = (item.title || '').toLowerCase();
  if (title === needle) return 0;
  if (title.includes(needle)) return 1;
  const tokens = tokensFor(query);
  if (tokens.length && tokens.every((word) => title.includes(word))) return 2;
  return 3;
}

export async function searchMarketplace(client, input, options = {}) {
  const query = normalizeSearch(input);
  const empty = { participants: [], categories: [], items: [], categorySearch: 'rpc', unavailable: [] };
  if (!/[\p{L}\p{N}]/u.test(query)) return empty;
  const { categoryId, departmentId, listingType, timeoutMs } = options;
  const unavailable = [];
  const readQuery = (build) => read(build, timeoutMs);
  const categoryPromise = searchCatalogueCategories(client, query, { timeoutMs });
  const participantPromise = readQuery((signal) => client.from('participants')
    .select('id,name,username,user_code,total_votes,current_stage')
    .or(textFilter(['username', 'user_code', 'name'], query))
    .order('total_votes', { ascending: false }).limit(20).abortSignal(signal));

  let scopeIds = categoryId ? [categoryId] : null;
  if (departmentId) {
    const scope = await readQuery((signal) => client.from('catalogue_categories')
      .select('id').eq('is_active', true).eq('parent_id', departmentId).limit(500).abortSignal(signal));
    if (scope.error) unavailable.push('items');
    scopeIds = (scope.data || []).map((row) => row.id).filter((id) => !categoryId || id === categoryId);
  }
  const itemQuery = () => {
    let request = client.from('catalogue_items').select(ITEM_FIELDS).eq('status', 'active');
    if (scopeIds) request = request.in('category_id', scopeIds);
    if (listingType) request = request.eq('listing_type', listingType);
    return request;
  };
  const limitedItems = (build) => scopeIds?.length === 0 ? Promise.resolve({ data: [] })
    : readQuery((signal) => build(itemQuery()).order('created_at', { ascending: false })
      .order('id').limit(SEARCH_LIMIT).abortSignal(signal));
  // Text discovery is independent of alias availability. Reserve exact titles
  // so older exact hits cannot be crowded out by newer description matches.
  const directPromise = Promise.all([
    limitedItems((request) => request.ilike('title', escapeLike(query))),
    limitedItems((request) => request.or(textFilter(TEXT_FIELDS, query))),
    ...(tokensFor(query).length > 1 ? [limitedItems((request) => tokensFor(query)
      .reduce((next, token) => next.or(textFilter(TEXT_FIELDS, token)), request))] : []),
  ]);
  const categoryResult = await categoryPromise;
  const categories = categoryResult.categories.filter((match) =>
    (!categoryId || match.category_id === categoryId)
    && (!departmentId || match.department_id === departmentId));
  if (categoryResult.categorySearch !== 'rpc') unavailable.push('aliases');
  // Don't include unrelated siblings when a parent and its specific child match.
  // Fuzzy matches are suggestions to select, never automatic listing expansion.
  const directCategories = categories.filter((row) => !row.is_department && row.match_type !== 'fuzzy');
  const departments = categories.filter((row) => row.is_department && row.match_type !== 'fuzzy'
    && !directCategories.some((child) => child.department_id === row.category_id));
  const ids = directCategories.map((row) => row.category_id);
  if (departments.length) {
    const children = await readQuery((signal) => client.from('catalogue_categories')
      .select('id').eq('is_active', true).in('parent_id', departments.map((row) => row.category_id))
      .limit(500).abortSignal(signal));
    if (children.error) unavailable.push('items');
    ids.push(...(children.data || []).map((row) => row.id));
  }
  const relatedIds = [...new Set(ids)].filter((id) => !scopeIds || scopeIds.includes(id));
  const relatedPromise = relatedIds.length
    ? limitedItems((request) => request.in('category_id', relatedIds))
    : Promise.resolve({ data: [] });
  const [directResults, related, people] = await Promise.all([directPromise, relatedPromise, participantPromise]);
  if (people.error) unavailable.push('participants');
  if (related.error || directResults.some((result) => result.error)) unavailable.push('items');
  const direct = directResults.flatMap((result) => result.data || []);
  direct.sort((a, b) => listingRelevance(a, query) - listingRelevance(b, query)
    || (b.created_at || '').localeCompare(a.created_at || '') || a.id.localeCompare(b.id));
  const relatedRank = new Map(directCategories.map((row) => [row.category_id, row.rank]));
  const relatedItems = (related.data || []).sort((a, b) =>
    (relatedRank.get(a.category_id) || 20) - (relatedRank.get(b.category_id) || 20));
  const unique = new Map();
  for (const item of [...direct, ...relatedItems]) if (!unique.has(item.id)) unique.set(item.id, item);
  return {
    participants: people.data || [], categories, items: [...unique.values()].slice(0, SEARCH_LIMIT),
    categorySearch: categoryResult.categorySearch, unavailable: [...new Set(unavailable)],
  };
}

export function parseSearchOptions(params) {
  const options = {};
  for (const [parameter, key] of [['category_id', 'categoryId'], ['department_id', 'departmentId']]) {
    if (params[parameter] === undefined) continue;
    if (typeof params[parameter] !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(params[parameter])) {
      throw new Error(`Invalid ${parameter}`);
    }
    options[key] = params[parameter];
  }
  if (params.listing_type !== undefined) {
    if (typeof params.listing_type !== 'string' || !/^[a-z][a-z0-9_-]{0,39}$/.test(params.listing_type)) throw new Error('Invalid listing_type');
    options.listingType = params.listing_type;
  }
  return options;
}
