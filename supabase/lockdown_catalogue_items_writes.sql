-- Close public write access to catalogue listings. STATUS: FOR REVIEW - NOT APPLIED.
--
-- Audit (9 Oct 2026) found on catalogue_items:
--   policy "insert items"  INSERT  roles=public  with check (true)
--   policy "update items"  UPDATE  roles=public  using (true)
-- plus INSERT/UPDATE/DELETE/TRUNCATE grants to anon and authenticated.
-- Anyone holding the public (anon) key can create listings for any seller
-- and change any listing's price, title, seller or status.
--
-- After this runs, listings and categories can only be written by the
-- server API (pages/api/catalogue/items.js and categories.js), which uses the
-- service_role key and checks the seller's token, ownership, category and
-- field values. Public read is unchanged:
--   catalogue_items       "public read active items"  (status <> 'deleted')
--   catalogue_categories  "catalogue_categories_select_all"
--
-- PREREQUISITE: the website change that saves listings through
-- /api/catalogue/items must be deployed first; otherwise website listing
-- edits fail until it is. The mobile app already writes through the API.
--
-- Not a payment object: no payment table, function, trigger or policy is
-- touched. Safe to run more than once. Every check below aborts the whole
-- transaction (nothing is changed) if it fails.

begin;

-- 1. The server role must keep full access and bypass RLS, before and after.
--    (has_table_privilege with a privilege list is true if ANY is held, so
--    each privilege is checked on its own.)
create or replace function pg_temp.service_role_can_write() returns boolean
language sql as $$
  select bool_and(has_table_privilege('service_role', t, p))
  from unnest(array['public.catalogue_items', 'public.catalogue_categories']) as t,
       unnest(array['SELECT', 'INSERT', 'UPDATE']) as p;
$$;

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'service_role' and rolbypassrls) then
    raise exception 'Aborted: service_role is missing or does not bypass RLS; the server API would lose write access.';
  end if;
  if not pg_temp.service_role_can_write() then
    raise exception 'Aborted: service_role lacks SELECT/INSERT/UPDATE on catalogue tables.';
  end if;
end $$;

-- 2. Remove the open write policies.
drop policy if exists "insert items" on public.catalogue_items;
drop policy if exists "update items" on public.catalogue_items;

-- 3. Remove write privileges from the public API roles (reads stay).
revoke insert, update, delete, truncate, references, trigger
  on public.catalogue_items from anon, authenticated;
revoke insert, update, delete, truncate, references, trigger
  on public.catalogue_categories from anon, authenticated;

grant select on public.catalogue_items to anon, authenticated;
grant select on public.catalogue_categories to anon, authenticated;

-- 4. Verify the end state.
do $$
declare
  role_name text;
  tbl text;
  write_policies integer;
begin
  foreach role_name in array array['anon', 'authenticated'] loop
    foreach tbl in array array['public.catalogue_items', 'public.catalogue_categories'] loop
      if has_table_privilege(role_name, tbl, 'INSERT')
         or has_table_privilege(role_name, tbl, 'UPDATE')
         or has_table_privilege(role_name, tbl, 'DELETE')
         or has_table_privilege(role_name, tbl, 'TRUNCATE') then
        raise exception 'Aborted: % still has write privileges on % (possibly via another role membership).', role_name, tbl;
      end if;
      if not has_table_privilege(role_name, tbl, 'SELECT') then
        raise exception 'Aborted: % lost SELECT on %.', role_name, tbl;
      end if;
    end loop;
  end loop;

  select count(*) into write_policies
  from pg_policies
  where schemaname = 'public'
    and tablename in ('catalogue_items', 'catalogue_categories')
    and cmd in ('INSERT', 'UPDATE', 'DELETE', 'ALL');
  if write_policies > 0 then
    raise exception 'Aborted: % write policy(ies) remain on catalogue tables.', write_policies;
  end if;

  if not exists (select 1 from pg_policies
                 where schemaname = 'public' and tablename = 'catalogue_items' and cmd = 'SELECT') then
    raise exception 'Aborted: public read policy on catalogue_items is missing.';
  end if;

  if not pg_temp.service_role_can_write() then
    raise exception 'Aborted: service_role lost access.';
  end if;

  raise notice 'Lockdown verified: public roles read-only, server role unchanged.';
end $$;

commit;

-- Verification after commit (read-only), expected: only SELECT policies and
-- anon/authenticated holding SELECT only:
--   select tablename, policyname, cmd from pg_policies
--   where schemaname = 'public' and tablename in ('catalogue_items','catalogue_categories');
--   select table_name, grantee, string_agg(privilege_type, ', ')
--   from information_schema.role_table_grants
--   where table_schema = 'public' and table_name in ('catalogue_items','catalogue_categories')
--     and grantee in ('anon','authenticated') group by 1, 2;

-- Rollback (restores the previous, insecure state - only if needed):
-- begin;
-- create policy "insert items" on public.catalogue_items for insert to public with check (true);
-- create policy "update items" on public.catalogue_items for update to public using (true);
-- grant insert, update, delete, truncate, references, trigger on public.catalogue_items to anon, authenticated;
-- grant insert, update, delete, truncate, references, trigger on public.catalogue_categories to anon, authenticated;
-- commit;
