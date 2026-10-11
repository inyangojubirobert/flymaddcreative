-- ============================================================
-- ONE DREAM CATALOGUE — DEPARTMENT-SCOPED CATEGORY NAMES
-- Run this FIRST, before add_construction_department.sql and
-- add_culinary_legal_artisans.sql. Safe to run repeatedly.
--
-- Changes constraints only. No row is inserted, updated, renamed,
-- deleted or merged; ids, slugs and catalogue_items.category_id
-- are untouched.
--
--   Before: a category name must be unique across the whole marketplace.
--   After:  a category name must be unique within its department.
--           Department (top-level) names stay unique among departments.
--           Slugs stay globally unique (catalogue_categories_slug_unique).
--
-- Works on any supported Postgres version (no NULLS NOT DISTINCT needed).
-- Runs as one transaction: if any step fails, nothing changes.
-- ============================================================

begin;

-- 1. Stop if any department already holds two categories with the same name
--    (ignoring case and surrounding spaces). Nothing is changed in that case.
do $$
declare
  clash record;
begin
  select coalesce(parent_id::text, '(department)') as scope, lower(trim(name)) as name, count(*) as n
  into clash
  from public.catalogue_categories
  group by 1, 2
  having count(*) > 1
  limit 1;

  if found then
    raise exception 'Duplicate name "%" in % (% rows). Resolve it before running this script.',
      clash.name, clash.scope, clash.n;
  end if;
end $$;

-- 2. Remove the global name rule, whether it exists as a constraint or a bare index.
--    The live one is catalogue_categories_name_unique; the loops also catch any
--    other unique rule on name alone (e.g. an auto-named catalogue_categories_name_key).
alter table public.catalogue_categories
  drop constraint if exists catalogue_categories_name_unique;

do $$
declare
  rule record;
begin
  for rule in
    select c.conname
    from pg_constraint c
    join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
    where c.conrelid = 'public.catalogue_categories'::regclass
      and c.contype = 'u'
      and array_length(c.conkey, 1) = 1
      and a.attname = 'name'
  loop
    execute format('alter table public.catalogue_categories drop constraint %I', rule.conname);
  end loop;

  for rule in
    select i.relname as conname
    from pg_index x
    join pg_class i on i.oid = x.indexrelid
    join pg_attribute a on a.attrelid = x.indrelid and a.attnum = x.indkey[0]
    where x.indrelid = 'public.catalogue_categories'::regclass
      and x.indisunique
      and not x.indisprimary
      and x.indnatts = 1
      and x.indexprs is null
      and a.attname = 'name'
  loop
    execute format('drop index public.%I', rule.conname);
  end loop;
end $$;

-- 3. Unique name per department. Top-level rows (parent_id is null) share one
--    bucket, so department names stay unique among themselves.
create unique index if not exists catalogue_categories_department_name_unique
  on public.catalogue_categories (
    coalesce(parent_id, '00000000-0000-0000-0000-000000000000'::uuid),
    lower(trim(name))
  );

-- 4. Allow names up to 60 characters
--    ("Construction, Electrical & Building Services" is 44).
alter table public.catalogue_categories
  drop constraint if exists catalogue_categories_name_len;

alter table public.catalogue_categories
  add constraint catalogue_categories_name_len
  check (char_length(trim(name)) between 1 and 60);

commit;


-- ------------------------------------------------------------
-- OPTIONAL CHECKS (read-only)
-- ------------------------------------------------------------
-- select version();
--
-- Unique rules now on the table; expect catalogue_categories_slug_unique and
-- catalogue_categories_department_name_unique, and no rule on name alone:
-- select indexname, indexdef from pg_indexes
--  where schemaname = 'public' and tablename = 'catalogue_categories';
