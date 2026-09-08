-- Run this in the Supabase SQL Editor (read-only, makes no changes).
-- Reports which of the pending migrations in supabase/*.sql are already
-- applied to this database, based on the tables/columns/constraints/policies
-- each one creates. messages_and_media_schema.sql is intentionally excluded
-- (it is a historical bootstrap script marked "do not run").

select
  'create_ai_business_assistant.sql' as migration,
  (to_regclass('public.ai_conversations') is not null
    and to_regclass('public.ai_messages') is not null
    and to_regclass('public.ai_subscriptions') is not null) as applied
union all
select
  'add_ai_subscription_payments.sql',
  to_regclass('public.ai_subscription_transactions') is not null
union all
select
  'add_ai_provider_subscriptions.sql',
  to_regclass('public.ai_provider_subscriptions') is not null
union all
select
  'add_bascardo_ai_sender_type.sql',
  exists (
    select 1 from pg_constraint
    where conname = 'support_messages_sender_type_check'
      and pg_get_constraintdef(oid) like '%''ai''%'
  )
union all
select
  'add_catalogue_product_details.sql',
  exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'catalogue_items' and column_name = 'size'
  ) and exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'catalogue_items' and column_name = 'promo_video_url'
  )
union all
select
  'add_messages_media_columns.sql',
  exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'messages' and column_name = 'is_read'
  )
union all
select
  'create_order_messages_table.sql',
  to_regclass('public.order_messages') is not null
union all
select
  'create_project_faqs.sql',
  to_regclass('public.project_faqs') is not null
union all
select
  'fix_payments_schema.sql',
  exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'payments' and column_name = 'payment_intent_id'
  )
union all
select
  'fix_merchant_schema.sql',
  to_regclass('public.merchant_withdrawals') is not null
    and exists (select 1 from pg_proc where proname = 'withdraw_merchant_tokens')
union all
select
  'fix_participant_withdrawals_schema.sql',
  exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'participant_withdrawals' and column_name = 'amount_usd'
  ) and exists (select 1 from pg_proc where proname = 'request_participant_withdrawal')
union all
select
  'enable_anytime_withdrawals_admin.sql',
  to_regclass('public.admin_users') is not null
    and exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'participant_withdrawals' and column_name = 'payout_type'
    )
union all
select
  'lockdown_catalogue_orders_rls.sql',
  exists (
    select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'catalogue_orders' and c.relrowsecurity
  ) and exists (
    select 1 from pg_policies where schemaname = 'public' and tablename = 'catalogue_orders'
      and policyname = 'catalogue_orders_select_all'
  )
union all
select
  'lockdown_participant_withdrawals_rls.sql',
  exists (
    select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'participant_withdrawals' and c.relrowsecurity
  )
order by migration;
