-- READ-ONLY catalogue configuration audit. Changes nothing.
-- One query, one result table (the Supabase SQL editor only displays the
-- last statement's result). Export or copy the whole result.
-- Payment tables are not inspected here.

with t as (
  select unnest(array['catalogue_items', 'catalogue_categories']) as tbl
)
select * from (
  select 1 as ord, 'server' as section, 'postgres_version' as item,
         current_setting('server_version') as detail
  union all
  select 2, 'server', 'check_function_bodies', current_setting('check_function_bodies')
  union all
  select 3, 'server', 'gen_random_uuid_available',
         (exists (select 1 from pg_proc where proname = 'gen_random_uuid'))::text

  -- Row-level security on/forced
  union all
  select 10, 'rls', c.relname::text,
         'enabled=' || c.relrowsecurity::text || ', forced=' || c.relforcerowsecurity::text
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relname in (select tbl from t)

  -- Policies
  union all
  select 11, 'policy', p.tablename::text || '.' || p.policyname::text,
         'cmd=' || p.cmd::text || ', roles=' || array_to_string(p.roles::text[], ',')
         || ', permissive=' || p.permissive::text
         || ', using=' || coalesce(p.qual::text, '-')
         || ', check=' || coalesce(p.with_check::text, '-')
  from pg_policies p
  where p.schemaname = 'public' and p.tablename in (select tbl from t)

  -- Table privileges for API roles
  union all
  select 12, 'grant', g.table_name::text || ' -> ' || g.grantee::text,
         string_agg(g.privilege_type::text, ', ' order by g.privilege_type::text)
  from information_schema.role_table_grants g
  where g.table_schema = 'public'
    and g.table_name in (select tbl from t)
    and g.grantee in ('anon', 'authenticated')
  group by g.table_name, g.grantee

  -- Constraints
  union all
  select 20, 'constraint', rel.relname::text || '.' || con.conname::text, pg_get_constraintdef(con.oid)
  from pg_constraint con
  join pg_class rel on rel.oid = con.conrelid
  join pg_namespace n on n.oid = rel.relnamespace
  where n.nspname = 'public' and rel.relname in (select tbl from t)

  -- Indexes
  union all
  select 21, 'index', i.tablename::text || '.' || i.indexname::text, i.indexdef
  from pg_indexes i
  where i.schemaname = 'public' and i.tablename in (select tbl from t)

  -- Triggers (user-defined)
  union all
  select 22, 'trigger', rel.relname::text || '.' || tg.tgname::text, pg_get_triggerdef(tg.oid)
  from pg_trigger tg
  join pg_class rel on rel.oid = tg.tgrelid
  join pg_namespace n on n.oid = rel.relnamespace
  where n.nspname = 'public' and rel.relname in (select tbl from t)
    and not tg.tgisinternal

  -- Database functions/views that reference the listings or categories
  -- (other code paths that could read or write them)
  union all
  select 30, 'function_referencing', p.proname::text || '(' || pg_get_function_identity_arguments(p.oid) || ')',
         'security_definer=' || p.prosecdef::text
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and (p.prosrc ilike '%catalogue_items%' or p.prosrc ilike '%catalogue_categories%')
  union all
  select 31, 'view_referencing', v.viewname::text, left(v.definition, 300)
  from pg_views v
  where v.schemaname = 'public'
    and (v.definition ilike '%catalogue_items%' or v.definition ilike '%catalogue_categories%')

  -- Name collisions with objects the proposed migration would create
  union all
  select 40, 'name_collision', p.proname::text, 'function already exists'
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname in ('catalogue_item_is_public', 'catalogue_set_checkout_compatible',
                      'catalogue_pricing_models_guard', 'catalogue_items_enforce_listing_rules',
                      'catalogue_categories_listing_types_guard',
                      'catalogue_checkout_approvals_append_only')
  union all
  select 41, 'name_collision', c.relname::text, 'relation already exists (' || c.relkind::text || ')'
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relname in ('catalogue_pricing_models', 'catalogue_checkout_model_approvals',
                      'catalogue_units', 'catalogue_attribute_definitions',
                      'catalogue_item_attributes', 'catalogue_product_details',
                      'catalogue_service_details', 'catalogue_listing_drafts')

  -- Listing data checks
  union all
  select 50, 'data', 'listings_by_status', coalesce(status, '(null)') || ': ' || count(*)::text
  from public.catalogue_items group by status
  union all
  select 51, 'data', 'invalid_price_listing', id::text || ' price=' || coalesce(price_usd::text, 'null')
         || ' status=' || coalesce(status, '(null)')
  from public.catalogue_items
  where status is distinct from 'deleted'
    and (price_usd is null or price_usd = 'NaN'::numeric
         or price_usd::text in ('Infinity', '-Infinity') or price_usd <= 0)
) audit
order by ord, section, item;
