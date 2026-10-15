-- ============================================================================
-- Advertising: package value exceptions
-- ============================================================================
-- Additive. Lets an admin mark an ascending-value warning (a dearer package
-- offering less than a cheaper one, lib/adPackageValidation.js) as
-- intentional. `signature` records the exact values compared, so an exception
-- stops applying as soon as either package changes.
--
-- Changes no existing table, package, price or entitlement. Server-only: RLS
-- on with no policies, no client-role privileges. Safe to re-run.
-- ============================================================================

create table if not exists advertising_package_value_exceptions (
  package_id text not null references advertising_packages(id) on delete cascade,
  compared_package_id text not null references advertising_packages(id) on delete cascade,
  rule text not null check (rule in ('creatives', 'duration', 'priority', 'placements')),
  signature text not null check (char_length(signature) <= 200),
  note text not null check (char_length(note) between 1 and 300),
  acknowledged_by uuid,
  acknowledged_by_email text,
  created_at timestamptz not null default now(),
  primary key (package_id, compared_package_id, rule)
);

alter table advertising_package_value_exceptions enable row level security;
revoke all on advertising_package_value_exceptions from anon, authenticated;

-- Verify. `create table if not exists` skips a table that already exists, so
-- check the actual schema, not just that the table is there: every row must
-- say ok = true.
with cols as (
  select column_name, data_type, is_nullable from information_schema.columns
  where table_schema = 'public' and table_name = 'advertising_package_value_exceptions'
)
select 'columns' as check_name,
       (select count(*) from cols) = 8
       and exists (select 1 from cols where column_name = 'package_id' and data_type = 'text' and is_nullable = 'NO')
       and exists (select 1 from cols where column_name = 'compared_package_id' and data_type = 'text' and is_nullable = 'NO')
       and exists (select 1 from cols where column_name = 'rule' and data_type = 'text' and is_nullable = 'NO')
       and exists (select 1 from cols where column_name = 'signature' and data_type = 'text' and is_nullable = 'NO')
       and exists (select 1 from cols where column_name = 'note' and data_type = 'text' and is_nullable = 'NO')
       and exists (select 1 from cols where column_name = 'acknowledged_by' and data_type = 'uuid')
       and exists (select 1 from cols where column_name = 'acknowledged_by_email' and data_type = 'text')
       and exists (select 1 from cols where column_name = 'created_at' and data_type = 'timestamp with time zone') as ok
union all
select 'primary key (package_id, compared_package_id, rule)',
       (select array_agg(a.attname::text order by k.ord) from pg_constraint c
          cross join lateral unnest(c.conkey) with ordinality as k(attnum, ord)
          join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum
         where c.conrelid = 'public.advertising_package_value_exceptions'::regclass and c.contype = 'p')
       = array['package_id', 'compared_package_id', 'rule']
union all
select 'rule / signature / note checks + 2 package foreign keys',
       (select count(*) from pg_constraint
         where conrelid = 'public.advertising_package_value_exceptions'::regclass and contype = 'c') >= 3
       and (select count(*) from pg_constraint
         where conrelid = 'public.advertising_package_value_exceptions'::regclass and contype = 'f'
           and confrelid = 'public.advertising_packages'::regclass) = 2
union all
select 'row level security on',
       (select relrowsecurity from pg_class where oid = 'public.advertising_package_value_exceptions'::regclass)
union all
select 'no access for anon / authenticated',
       not exists (select 1 from information_schema.role_table_grants
                    where table_schema = 'public' and table_name = 'advertising_package_value_exceptions'
                      and grantee in ('anon', 'authenticated'))
union all
select 'no client policies',
       not exists (select 1 from pg_policies where tablename = 'advertising_package_value_exceptions');
