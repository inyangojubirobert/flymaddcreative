import pg from 'pg';
import dotenv from 'dotenv';
import { promises as dns } from 'dns';
import { writeFile } from 'fs/promises';

dotenv.config({ path: '.env.local' });
dotenv.config();

const connectionString = process.env.DATABASE_URL || process.env.SUPABASE_DB_URL;
if (!connectionString) {
  await dumpFromApi();
  process.exit(0);
}

const url = new URL(connectionString);
const cfg = {
  user: decodeURIComponent(url.username),
  password: decodeURIComponent(url.password),
  database: url.pathname.replace(/^\//, ''),
  port: url.port ? Number(url.port) : 5432,
  host: url.hostname,
  ssl: { rejectUnauthorized: false },
};

const v4 = await dns.resolve4(cfg.host).catch(() => []);
if (!v4.length) {
  const v6 = await dns.resolve6(cfg.host).catch(() => []);
  if (v6.length) cfg.host = v6[0];
}

const client = new pg.Client(cfg);
await client.connect();

const tables = (await client.query(`
  select c.relname as name, c.relkind, c.relrowsecurity as rls
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind in ('r', 'p', 'v', 'm')
  order by c.relname
`)).rows;

const columns = (await client.query(`
  select table_name, column_name, ordinal_position, udt_name, data_type,
         is_nullable, column_default, character_maximum_length
  from information_schema.columns
  where table_schema = 'public'
  order by table_name, ordinal_position
`)).rows;

const constraints = (await client.query(`
  select conrelid::regclass::text as table_name, conname, contype, pg_get_constraintdef(oid) as def
  from pg_constraint
  where connamespace = 'public'::regnamespace
  order by 1, 2
`)).rows;

const indexes = (await client.query(`
  select tablename, indexname, indexdef
  from pg_indexes
  where schemaname = 'public'
  order by tablename, indexname
`)).rows;

const policies = (await client.query(`
  select tablename, policyname, permissive, roles, cmd, qual, with_check
  from pg_policies
  where schemaname = 'public'
  order by tablename, policyname
`)).rows;

const enums = (await client.query(`
  select t.typname, e.enumlabel
  from pg_type t
  join pg_enum e on e.enumtypid = t.oid
  join pg_namespace n on n.oid = t.typnamespace
  where n.nspname = 'public'
  order by t.typname, e.enumsortorder
`)).rows;

const catalogue = await client.query(`
  select
    (select count(*) from public.catalogue_categories) as categories,
    (select count(*) from public.catalogue_categories where parent_id is null) as roots,
    (select count(*) from public.catalogue_categories where parent_id is not null) as children,
    (select count(*) from public.catalogue_categories where is_featured) as featured,
    (select count(*) from public.catalogue_categories where not is_selectable) as not_selectable,
    (select count(*) from public.catalogue_categories where slug = 'more') as more_rows,
    (select count(*) from public.catalogue_categories where slug = 'other') as other_rows
`).catch(async (error) => ({ rows: [{ error: error.message }] }));

const byTable = new Map();
for (const column of columns) {
  if (!byTable.has(column.table_name)) byTable.set(column.table_name, []);
  byTable.get(column.table_name).push(column);
}

function typeOf(column) {
  if (column.data_type === 'ARRAY') return `${column.udt_name.replace(/^_/, '')}[]`;
  if (column.data_type === 'USER-DEFINED') return column.udt_name;
  if (column.character_maximum_length) return `${column.udt_name}(${column.character_maximum_length})`;
  return column.udt_name;
}

const lines = [];
lines.push('-- Live public schema. Reference only. Do not run this file as a migration.');
lines.push(`-- Captured ${new Date().toISOString()} from the connected Supabase database.`);
lines.push('-- Regenerate with: node scripts/dump-public-schema.mjs');
lines.push('');

if (enums.length) {
  const grouped = new Map();
  for (const item of enums) {
    if (!grouped.has(item.typname)) grouped.set(item.typname, []);
    grouped.get(item.typname).push(item.enumlabel);
  }
  lines.push('-- ENUMS');
  for (const [name, labels] of grouped) {
    lines.push(`-- ${name}: ${labels.join(' | ')}`);
  }
  lines.push('');
}

for (const table of tables) {
  const kind = table.relkind === 'v' ? 'view' : table.relkind === 'm' ? 'materialized view' : 'table';
  lines.push(`-- ${kind} public.${table.name}${table.rls ? '  -- row level security enabled' : ''}`);
  const cols = byTable.get(table.name) || [];
  if (kind === 'table') {
    lines.push(`create table if not exists public.${table.name} (`);
    lines.push(cols.map((column) => {
      const nullable = column.is_nullable === 'YES' ? '' : ' not null';
      const fallback = column.column_default ? ` default ${column.column_default}` : '';
      return `  ${column.column_name} ${typeOf(column)}${nullable}${fallback}`;
    }).join(',\n'));
    lines.push(');');
  } else {
    for (const column of cols) lines.push(`--   ${column.column_name} ${typeOf(column)}`);
  }
  const tableConstraints = constraints.filter((item) => item.table_name === `public.${table.name}` || item.table_name === table.name);
  for (const constraint of tableConstraints) {
    const label = { p: 'primary key', u: 'unique', f: 'foreign key', c: 'check' }[constraint.contype] || constraint.contype;
    lines.push(`-- ${label} ${constraint.conname}: ${constraint.def}`);
  }
  for (const index of indexes.filter((item) => item.tablename === table.name)) {
    lines.push(`-- index ${index.indexname}: ${index.indexdef}`);
  }
  for (const policy of policies.filter((item) => item.tablename === table.name)) {
    lines.push(`-- policy ${policy.policyname} ${policy.cmd} (${policy.permissive}) roles ${policy.roles}`);
    if (policy.qual) lines.push(`--   using ${policy.qual}`);
    if (policy.with_check) lines.push(`--   with check ${policy.with_check}`);
  }
  lines.push('');
}

const summary = catalogue.rows[0];
lines.push('-- CATALOGUE COUNTS AT CAPTURE');
lines.push(`-- ${JSON.stringify(summary)}`);
lines.push('');

await writeFile('supabase/schema.reference.sql', `${lines.join('\n')}\n`);
console.log(`tables ${tables.length}`);
console.log(`columns ${columns.length}`);
console.log(`policies ${policies.length}`);
console.log(`catalogue ${JSON.stringify(summary)}`);
await client.end();

async function dumpFromApi() {
  const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
  if (!supabaseUrl || !key) throw new Error('Missing Supabase URL or key');

  const headers = { apikey: key, Authorization: `Bearer ${key}` };
  const specResponse = await fetch(`${supabaseUrl}/rest/v1/`, { headers });
  if (!specResponse.ok) throw new Error(`OpenAPI ${specResponse.status}`);
  const spec = await specResponse.json();
  const definitions = spec.definitions || spec.components?.schemas || {};

  const lines = [];
  lines.push('-- Live public schema exposed by the Supabase API. Reference only. Do not run this file as a migration.');
  lines.push(`-- Captured ${new Date().toISOString()} from ${new URL(supabaseUrl).host}.`);
  lines.push('-- Column types come from the PostgREST OpenAPI document. Constraints that PostgREST does not publish are omitted.');
  lines.push('-- Regenerate with: node scripts/dump-public-schema.mjs');
  lines.push('');

  const names = Object.keys(definitions).filter((name) => !name.endsWith('_row') && definitions[name].type === 'object').sort();
  for (const name of names) {
    const definition = definitions[name];
    const required = new Set(definition.required || []);
    const properties = definition.properties || {};
    lines.push(`-- table public.${name}`);
    lines.push(`create table if not exists public.${name} (`);
    const columns = Object.entries(properties).map(([column, info]) => {
      const type = sqlType(info);
      const nullable = required.has(column) ? ' not null' : '';
      return `  ${column} ${type}${nullable}${columnNote(info)}`;
    });
    lines.push(columns.join(',\n'));
    lines.push(');');
    lines.push('');
  }

  const catalogue = await catalogueSnapshot(supabaseUrl, headers);
  lines.push('-- CATALOGUE COUNTS AT CAPTURE');
  lines.push(`-- ${JSON.stringify(catalogue)}`);
  lines.push('');

  await writeFile('supabase/schema.reference.sql', `${lines.join('\n')}\n`);
  console.log(`tables ${names.length}`);
  console.log(`catalogue ${JSON.stringify(catalogue)}`);
}

function columnNote(info) {
  const description = info.description || '';
  if (description.includes('<pk/>')) return ' -- primary key';
  const foreignKey = description.match(/<fk table='([^']+)' column='([^']+)'\/>/);
  if (foreignKey) return ` -- references ${foreignKey[1]}(${foreignKey[2]})`;
  return '';
}

function sqlType(info) {
  const format = info.format || '';
  if (info.type === 'integer' || format === 'integer') return 'integer';
  if (info.type === 'number' || format === 'numeric' || format === 'double precision') return format === 'double precision' ? 'double precision' : 'numeric';
  if (info.type === 'boolean') return 'boolean';
  if (format === 'uuid') return 'uuid';
  if (format === 'timestamp with time zone' || format === 'timestamptz') return 'timestamptz';
  if (format === 'jsonb' || info.type === 'object') return 'jsonb';
  if (info.type === 'array') return `${sqlType(info.items || { type: 'text' })}[]`;
  if (format) return format;
  return 'text';
}

async function catalogueSnapshot(supabaseUrl, headers) {
  const countHeaders = { ...headers, Prefer: 'count=exact', Range: '0-0' };
  async function count(query) {
    const response = await fetch(`${supabaseUrl}/rest/v1/catalogue_categories?select=id&${query}`, { headers: countHeaders });
    const range = response.headers.get('content-range') || '';
    const total = range.split('/')[1];
    return total && total !== '*' ? Number(total) : null;
  }
  const [categories, roots, children, featured, notSelectable, moreRows, otherRows] = await Promise.all([
    count(''),
    count('parent_id=is.null'),
    count('parent_id=not.is.null'),
    count('is_featured=eq.true'),
    count('is_selectable=eq.false'),
    count('slug=eq.more'),
    count('slug=eq.other'),
  ]);
  return { categories, roots, children, featured, notSelectable, moreRows, otherRows };
}
