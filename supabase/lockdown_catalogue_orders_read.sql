-- ============================================================================
-- Close public reads of catalogue_orders
-- ============================================================================
-- RUN ONLY AFTER the website/API version that reads orders through the API
-- (pages/api/catalogue/order.js, /api/catalogue/orders) is deployed - the
-- old website read this table directly with the anon key.
--
-- Orders hold buyer contacts and the buyer_token that authorises delivery
-- confirmation, which now makes seller earnings withdrawable. They must only
-- be readable server-side:
--   buyer  -> GET /api/catalogue/order?order_id=&buyer_token=
--   seller -> GET /api/catalogue/orders (participant login, own orders only)
--   admin  -> GET /api/admin/orders
-- ============================================================================

drop policy if exists catalogue_orders_select_all on catalogue_orders;
revoke select, insert, update, delete on table catalogue_orders from anon, authenticated;
grant all on table catalogue_orders to service_role;

-- Verification - every row must be ok = true
select 'no public select policy' as check_name,
       not exists (select 1 from pg_policies where tablename = 'catalogue_orders' and policyname = 'catalogue_orders_select_all') as ok
union all
select 'anon cannot read orders', not has_table_privilege('anon', 'public.catalogue_orders', 'select')
union all
select 'RLS still on', coalesce((select relrowsecurity from pg_class where oid = to_regclass('public.catalogue_orders')), false);
