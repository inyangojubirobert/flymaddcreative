-- Rollback for add_dynamic_listing_engine.sql (revision 4).
-- STATUS: FOR REVIEW - NOT APPLIED. EMERGENCY RECOVERY TOOL, NOT AN UNDO BUTTON.
--
-- BEFORE RUNNING: take a full database backup (Supabase dashboard > Database >
-- Backups, or pg_dump). This script is destructive.
--
-- What it does, in ONE transaction (any failure leaves everything untouched):
--   1. copies everything the engine owns into the private schema
--      catalogue_engine_archive, which is OUTSIDE the objects dropped below:
--        drafts, product/service details, item attributes, attribute
--        definitions, pricing models (incl. checkout_compatible), units,
--        approval records, per-listing classification (listing_type,
--        pricing_model, scope, review flags) and per-category listing types;
--   2. verifies the archive row-for-row (count + content hash per source) and
--      that anon, authenticated and service_role cannot reach it;
--   3. only then drops the engine objects.
-- If step 2 fails the script aborts before anything is dropped.
--
-- Privacy: drafts hold unpublished seller business details. The archive is
-- readable only by the database owner/superusers (no grants to PUBLIC, anon,
-- authenticated or service_role, and the schema must never be added to the
-- API's exposed schemas). Delete it yourself once it is no longer needed:
--   drop schema catalogue_engine_archive cascade;
-- This script never deletes the archive. A rollback that is later undone by a
-- failure also undoes its archive, but then nothing was dropped either.
--
-- Restoring: re-run add_dynamic_listing_engine.sql, then copy rows back, e.g.
--   insert into public.catalogue_listing_drafts
--   select (jsonb_populate_record(null::public.catalogue_listing_drafts, row_data)).*
--   from catalogue_engine_archive.archived_rows
--   where run_id = '<run id printed by this script>' and source = 'catalogue_listing_drafts';
-- The dry run tests this for drafts, details and attributes.
--
-- Existing listings, categories, IDs, slugs and all payment objects are not
-- touched. Listing rows keep their original columns and values.

begin;

set local lock_timeout = '5s';

-- ---------------------------------------------------------------------------
-- 1. Private archive (never dropped by this script)
-- ---------------------------------------------------------------------------
create schema if not exists catalogue_engine_archive;
revoke all on schema catalogue_engine_archive from public, anon, authenticated, service_role;

create table if not exists catalogue_engine_archive.runs (
  run_id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  created_by text not null default current_user,
  source_counts jsonb not null default '{}'::jsonb,
  verified boolean not null default false
);

create table if not exists catalogue_engine_archive.archived_rows (
  run_id uuid not null references catalogue_engine_archive.runs(run_id),
  source text not null,
  source_key text not null,
  row_data jsonb not null,
  primary key (run_id, source, source_key)
);

revoke all on catalogue_engine_archive.runs, catalogue_engine_archive.archived_rows
  from public, anon, authenticated, service_role;
alter table catalogue_engine_archive.runs enable row level security;
alter table catalogue_engine_archive.archived_rows enable row level security;

-- ---------------------------------------------------------------------------
-- 2. Archive and verify
-- ---------------------------------------------------------------------------
do $archive$
declare
  v_run uuid := gen_random_uuid();
  spec record;
  v_live bigint;
  v_arch bigint;
  v_live_hash text;
  v_arch_hash text;
  v_counts jsonb := '{}'::jsonb;
  v_role text;
begin
  insert into catalogue_engine_archive.runs (run_id) values (v_run);

  for spec in
    select * from (values
      ('catalogue_listing_drafts',
       'select t.id::text, to_jsonb(t) from public.catalogue_listing_drafts t',
       'catalogue_listing_drafts', null::text),
      ('catalogue_product_details',
       'select t.item_id::text, to_jsonb(t) from public.catalogue_product_details t',
       'catalogue_product_details', null),
      ('catalogue_service_details',
       'select t.item_id::text, to_jsonb(t) from public.catalogue_service_details t',
       'catalogue_service_details', null),
      ('catalogue_item_attributes',
       'select t.id::text, to_jsonb(t) from public.catalogue_item_attributes t',
       'catalogue_item_attributes', null),
      ('catalogue_attribute_definitions',
       'select t.id::text, to_jsonb(t) from public.catalogue_attribute_definitions t',
       'catalogue_attribute_definitions', null),
      ('catalogue_pricing_models',
       'select t.key, to_jsonb(t) from public.catalogue_pricing_models t',
       'catalogue_pricing_models', null),
      ('catalogue_units',
       'select t.key, to_jsonb(t) from public.catalogue_units t',
       'catalogue_units', null),
      ('catalogue_checkout_model_approvals',
       'select t.id::text, to_jsonb(t) from public.catalogue_checkout_model_approvals t',
       'catalogue_checkout_model_approvals', null),
      ('catalogue_items.classification',
       $q$select x.id::text, to_jsonb(x) from (
            select i.id, i.seller_username, i.listing_type, i.pricing_model, i.price_unit,
                   i.service_scope, i.service_terms, i.service_scope_confirmed,
                   i.needs_type_review, i.type_review_reason, i.type_reviewed_at
            from public.catalogue_items i) x$q$,
       'catalogue_items', 'listing_type'),
      ('catalogue_categories.listing_types',
       $q$select x.id::text, to_jsonb(x) from (
            select c.id, c.slug, c.listing_types, c.suggested_listing_type
            from public.catalogue_categories c) x$q$,
       'catalogue_categories', 'listing_types')
    ) s(name, sql, required_table, required_column)
  loop
    if to_regclass('public.' || spec.required_table) is null then
      continue;
    end if;
    if spec.required_column is not null and not exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = spec.required_table
        and column_name = spec.required_column
    ) then
      continue;
    end if;

    execute format(
      'insert into catalogue_engine_archive.archived_rows (run_id, source, source_key, row_data) select %L::uuid, %L, s.k, s.d from (%s) s(k, d)',
      v_run, spec.name, spec.sql);

    execute format(
      'select count(*), coalesce(md5(string_agg(s.k || s.d::text, %L order by s.k)), %L) from (%s) s(k, d)',
      '|', '', spec.sql)
    into v_live, v_live_hash;

    select count(*), coalesce(md5(string_agg(a.source_key || a.row_data::text, '|' order by a.source_key)), '')
    into v_arch, v_arch_hash
    from catalogue_engine_archive.archived_rows a
    where a.run_id = v_run and a.source = spec.name;

    if v_live is distinct from v_arch or v_live_hash is distinct from v_arch_hash then
      raise exception 'Archive verification failed for %: live % rows, archived % rows. Nothing was dropped.',
        spec.name, v_live, v_arch;
    end if;
    v_counts := v_counts || jsonb_build_object(spec.name, v_arch);
  end loop;

  -- The archive must not be reachable through the API.
  foreach v_role in array array['anon', 'authenticated', 'service_role'] loop
    if has_schema_privilege(v_role, 'catalogue_engine_archive', 'USAGE')
       or has_table_privilege(v_role, 'catalogue_engine_archive.archived_rows', 'SELECT')
       or has_table_privilege(v_role, 'catalogue_engine_archive.runs', 'SELECT') then
      raise exception 'Archive is reachable by role %. Nothing was dropped.', v_role;
    end if;
  end loop;

  update catalogue_engine_archive.runs
  set source_counts = v_counts, verified = true
  where run_id = v_run;

  perform set_config('catalogue_engine.archive_run_id', v_run::text, true);
  raise notice 'Archive run % verified: %', v_run, v_counts;
end $archive$;

-- Gate: nothing below runs unless this transaction produced a verified archive.
do $gate$
begin
  if not exists (
    select 1 from catalogue_engine_archive.runs
    where run_id = nullif(current_setting('catalogue_engine.archive_run_id', true), '')::uuid
      and verified
  ) then
    raise exception 'No verified archive for this run. Nothing was dropped.';
  end if;
end $gate$;

-- ---------------------------------------------------------------------------
-- 3. Drop the engine
-- ---------------------------------------------------------------------------
drop trigger if exists catalogue_items_enforce_listing_rules on public.catalogue_items;
drop trigger if exists catalogue_items_seller_change_guard on public.catalogue_items;
drop trigger if exists catalogue_categories_listing_types_guard on public.catalogue_categories;

alter table public.catalogue_items
  drop constraint if exists catalogue_items_status_check,
  drop constraint if exists catalogue_items_pricing_model_fkey,
  drop constraint if exists catalogue_items_listing_type_check,
  drop constraint if exists catalogue_items_price_unit_check,
  drop constraint if exists catalogue_items_service_text_check;

drop index if exists public.catalogue_items_listing_type_idx;
drop index if exists public.catalogue_items_pricing_model_idx;
drop index if exists public.catalogue_items_needs_type_review_idx;

alter table public.catalogue_items
  drop column if exists listing_type,
  drop column if exists pricing_model,
  drop column if exists price_unit,
  drop column if exists service_scope,
  drop column if exists service_terms,
  drop column if exists service_scope_confirmed,
  drop column if exists needs_type_review,
  drop column if exists type_review_reason,
  drop column if exists type_reviewed_at;

alter table public.catalogue_categories
  drop constraint if exists catalogue_categories_listing_types_check,
  drop constraint if exists catalogue_categories_suggested_listing_type_check;

alter table public.catalogue_categories
  drop column if exists listing_types,
  drop column if exists suggested_listing_type;

-- No CASCADE: an unexpected dependency makes the drop fail loudly and the
-- whole transaction (archive included) is undone with nothing deleted.
drop table if exists public.catalogue_item_attributes;
drop table if exists public.catalogue_attribute_definitions;
drop table if exists public.catalogue_product_details;
drop table if exists public.catalogue_service_details;
drop table if exists public.catalogue_listing_drafts;
drop table if exists public.catalogue_checkout_model_approvals;
drop table if exists public.catalogue_pricing_models;
drop table if exists public.catalogue_units;

drop function if exists public.catalogue_items_enforce_listing_rules();
drop function if exists public.catalogue_items_seller_change_guard();
drop function if exists public.catalogue_categories_listing_types_guard();
drop function if exists public.catalogue_listing_drafts_owner_guard();
drop function if exists public.catalogue_pricing_models_guard();
drop function if exists public.catalogue_checkout_approvals_set_identity();
drop function if exists public.catalogue_checkout_approvals_append_only();
drop function if exists public.catalogue_set_checkout_compatible(text, boolean, text);
-- From an earlier draft of the migration, if it was ever applied:
drop function if exists public.catalogue_set_checkout_compatible(text, boolean, text, text);
drop function if exists public.catalogue_item_is_public(uuid);

-- ---------------------------------------------------------------------------
-- 4. Final check: the archive survived and is still verified
-- ---------------------------------------------------------------------------
do $final$
declare
  v_run uuid := nullif(current_setting('catalogue_engine.archive_run_id', true), '')::uuid;
  v_rows bigint;
  v_expected bigint;
begin
  select coalesce(sum(value::bigint), 0) into v_expected
  from catalogue_engine_archive.runs r, jsonb_each_text(r.source_counts)
  where r.run_id = v_run and r.verified;

  select count(*) into v_rows from catalogue_engine_archive.archived_rows where run_id = v_run;

  if v_rows <> v_expected then
    raise exception 'Archive row count changed during rollback (% vs %).', v_rows, v_expected;
  end if;
  raise notice 'Rollback complete. % archived row(s) kept in catalogue_engine_archive (run %).', v_rows, v_run;
end $final$;

commit;
