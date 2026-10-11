// Isolated PostgreSQL and a narrow PostgREST transport adapter. No env files or
// external network are read; the real Supabase client serializes every request.
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';
import { createClient } from '@supabase/supabase-js';

export async function stagingDatabase() {
  const db = new PGlite({ extensions: { pg_trgm } });
  await db.exec(`
    create role anon; create role authenticated; create role service_role bypassrls;
    create table catalogue_items (
      id uuid primary key default gen_random_uuid(), seller_username text, title text,
      description text default '', size text, price_usd numeric default 10,
      images text[] default '{}', listing_type text default 'product',
      pricing_model text default 'fixed', price_unit text, promo_video_url text,
      payment_methods text[] default '{}', status text default 'active',
      created_at timestamptz default now()
    );
    create table participants (id uuid primary key default gen_random_uuid(), name text,
      username text, user_code text, total_votes integer default 0, current_stage integer default 1);
  `);
  for (const file of ['add_catalogue_categories.sql', 'add_construction_department.sql',
    'add_culinary_legal_artisans.sql', 'add_accommodation_categories.sql', 'add_catalogue_search_aliases.sql']) {
    await db.exec(await readFile(new URL('../../supabase/' + file, import.meta.url), 'utf8'));
  }
  const categories = (await db.query('select * from catalogue_categories order by sort_order, name')).rows;
  return { db, categories };
}

export function stagingClient(db, { rpcUnavailable = false, failTables = [], hangRpc = false } = {}) {
  const requests = [];
  const transport = async (input, init = {}) => {
    const url = new URL(input);
    if (url.hostname !== 'search-staging.invalid') throw Error('External network forbidden in search staging');
    const table = url.pathname.split('/').at(-1);
    requests.push({ table, method: init.method || 'GET', params: url.searchParams });
    if (url.pathname.includes('/rpc/')) {
      if (hangRpc) return new Promise(() => {});
      if (rpcUnavailable) return Response.json({ code: 'PGRST202', message: 'Missing RPC' }, { status: 404 });
      const { search_term, result_limit } = JSON.parse(init.body);
      const data = await db.query('select * from search_catalogue_categories($1,$2)', [search_term, result_limit]);
      return Response.json(data.rows);
    }
    if (failTables.includes(table)) return Response.json({ message: 'Isolated simulated outage' }, { status: 503 });
    if (!['catalogue_categories','catalogue_items','participants'].includes(table)) throw Error('Unexpected table ' + table);
    if (init.method && init.method !== 'GET') throw Error('Search attempted a write');
    const values = [];
    const bind = value => { values.push(value); return '$' + values.length; };
    const ident = name => {
      if (!/^[a-z_]+$/.test(name)) throw Error('Unsafe identifier ' + name);
      return '"' + name + '"';
    };
    const conditions = [];
    for (const [key, value] of url.searchParams) {
      if (key === 'or') {
        const expression = value.slice(1,-1);
        const terms = [];
        const re = /([a-z_]+)\.ilike\.("(?:\\.|[^"\\])*")(?:,|$)/gy;
        let at = 0, match;
        while ((match = re.exec(expression))) {
          terms.push(ident(match[1]) + ' ilike ' + bind(JSON.parse(match[2])));
          at = re.lastIndex;
        }
        if (at !== expression.length || !terms.length) throw Error('Malformed OR filter ' + expression);
        conditions.push('(' + terms.join(' or ') + ')');
      } else if (!['select','order','limit'].includes(key)) {
        if (value.startsWith('eq.')) conditions.push(ident(key) + ' = ' + bind(value.slice(3)));
        else if (value.startsWith('ilike.')) conditions.push(ident(key) + ' ilike ' + bind(value.slice(6)));
        else if (value.startsWith('in.(')) {
          const ids = value.slice(4,-1).split(',').filter(Boolean);
          conditions.push(ids.length ? ident(key) + ' in (' + ids.map(bind).join(',') + ')' : 'false');
        } else throw Error('Unsupported filter ' + value);
      }
    }
    const columns = (url.searchParams.get('select') || '*').split(',').map(ident).join(',');
    const order = (url.searchParams.get('order') || '').split(',').filter(Boolean).map(part => {
      const [column, direction] = part.split('.');
      return ident(column) + (direction === 'desc' ? ' desc' : ' asc');
    });
    const limit = Number(url.searchParams.get('limit') || 1000);
    const sql = 'select ' + columns + ' from ' + ident(table)
      + (conditions.length ? ' where ' + conditions.join(' and ') : '')
      + (order.length ? ' order by ' + order.join(',') : '') + ' limit ' + bind(limit);
    const result = await db.query(sql, values);
    return Response.json(result.rows);
  };
  return {
    requests,
    client: createClient('https://search-staging.invalid', 'local-test-key', {
      auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: transport },
    }),
  };
}
