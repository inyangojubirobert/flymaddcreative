-- ============================================================================
-- Digital products, phase 2: website (Paystack) purchases, creator
-- subscriptions, EPUB e-books, encrypted offline copies
-- ============================================================================
-- Run AFTER supabase/add_digital_products.sql. Additive: extends the digital_*
-- tables only. No AI subscription, advertising, wallet, escrow, marketplace
-- order or withdrawal object is touched.
--
--   digital_paystack_payments      website checkouts (one-time purchase or first
--                                  subscription month), bound to buyer + item/creator
--   digital_sub_tiers              creator subscription prices (USD / month)
--   digital_sub_products           Google Play subscription products per tier, in
--                                  SLOTS (Google allows one live subscription per
--                                  product per user, so subscribing to several
--                                  creators at one price needs several products)
--   digital_creator_plans          a creator's monthly plan (one per creator)
--   digital_subscriptions          subscriber -> creator, provider, period, renewal
--   digital_subscription_payments  every paid month (Google order / Paystack charge)
--   digital_subscription_devices   device limit for subscription offline copies
--   digital_earnings               (existing ledger) now also records subscription
--                                  months: source = 'subscription'
--
-- Rules (functions):
--   digital_grant_license()               + p_fee_usd: actual processor fee (Paystack)
--   digital_start_subscription()          bound to subscriber + creator; paid tier
--                                         >= plan price; one live sub per pair;
--                                         idempotent per purchase token / reference
--   digital_record_subscription_payment() one earning per paid month, idempotent
--   digital_revoke_subscription_payment() refund: month reversed, access ends
--   digital_end_subscription()            admin / fallback revoke
--   digital_subscription_access()         does this subscriber get this item now?
--   digital_register_sub_device()         device limit
--   digital_expire_subscriptions()        ends lapsed website subscriptions
--
-- Server-only (RLS on, no client privileges). Verify with the query at the bottom.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Existing digital tables: new providers, EPUB, subscription inclusion
-- ----------------------------------------------------------------------------
alter table digital_licenses drop constraint if exists digital_licenses_provider_check;
alter table digital_licenses add constraint digital_licenses_provider_check
  check (provider in ('google_play', 'admin_grant', 'paystack'));

alter table digital_assets drop constraint if exists digital_assets_kind_check;
alter table digital_assets add constraint digital_assets_kind_check check (kind in ('pdf', 'epub', 'audio', 'video'));
alter table digital_assets drop constraint if exists digital_assets_resource_type_check;
alter table digital_assets add constraint digital_assets_resource_type_check check (resource_type in ('image', 'video', 'raw'));
-- EPUB preview: the first sections, sanitised to plain formatted text (JSON array of HTML strings).
alter table digital_assets add column if not exists preview_sections jsonb;

alter table digital_products add column if not exists in_subscription boolean not null default true;

-- ----------------------------------------------------------------------------
-- Creator subscriptions
-- ----------------------------------------------------------------------------
create table if not exists digital_sub_tiers (
  id text primary key check (id ~ '^sub_[0-9]{4}$'),
  price_usd numeric(10,2) not null unique check (price_usd > 0),
  is_active boolean not null default true
);

insert into digital_sub_tiers (id, price_usd)
select 'sub_' || lpad((p * 100)::int::text, 4, '0'), p
  from unnest(array[1.99, 2.99, 4.99, 7.99, 9.99, 19.99]::numeric[]) as p
on conflict (id) do nothing;

create table if not exists digital_sub_products (
  id text primary key check (id ~ '^sub_[0-9]{4}_s[0-9]{1,2}$'),
  tier_id text not null references digital_sub_tiers(id),
  slot smallint not null check (slot between 1 and 20),
  google_play_product_id text unique,            -- must match Play Console exactly
  is_active boolean not null default true,
  constraint digital_sub_products_tier_slot unique (tier_id, slot)
);

insert into digital_sub_products (id, tier_id, slot, google_play_product_id)
select t.id || '_s' || s, t.id, s, 'onedream_creator_' || substr(t.id, 5) || '_s' || s
  from digital_sub_tiers t cross join generate_series(1, 3) as s
on conflict (id) do nothing;

create table if not exists digital_creator_plans (
  creator_username text primary key,
  creator_id uuid not null unique references participants(id),
  tier_id text not null references digital_sub_tiers(id),
  description text check (description is null or char_length(description) <= 500),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists digital_subscriptions (
  id uuid primary key default gen_random_uuid(),
  subscriber_id uuid not null references participants(id),
  creator_username text not null references digital_creator_plans(creator_username),
  provider text not null check (provider in ('google_play', 'paystack', 'admin_grant')),
  provider_ref text not null,                    -- Google purchase token / first Paystack reference
  product_id text,                               -- Google Play product (slot)
  tier_id text references digital_sub_tiers(id),
  price_usd numeric(10,2) not null check (price_usd >= 0),
  status text not null default 'active' check (status in ('active', 'past_due', 'expired', 'revoked')),
  auto_renew boolean not null default true,
  current_period_start timestamptz not null,
  current_period_end timestamptz not null,
  paystack_authorization_code text,              -- server-only; lets the renewal job charge the saved card
  paystack_email text,
  last_charge_reference text,                    -- renewal charge in flight (checked before any new attempt)
  renewal_attempts integer not null default 0,
  last_renewal_error text,
  ended_at timestamptz,
  end_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint digital_subscriptions_provider_ref_key unique (provider, provider_ref),
  constraint digital_subscriptions_period check (current_period_end > current_period_start)
);
create unique index if not exists digital_subscriptions_one_live
  on digital_subscriptions (subscriber_id, creator_username) where status in ('active', 'past_due');
create index if not exists digital_subscriptions_due_idx on digital_subscriptions (provider, status, current_period_end);

create table if not exists digital_subscription_payments (
  id uuid primary key default gen_random_uuid(),
  subscription_id uuid not null references digital_subscriptions(id),
  provider text not null check (provider in ('google_play', 'paystack')),
  provider_ref text not null,                    -- Google order id / Paystack reference
  provider_txn_id text,                          -- Paystack transaction id (refund matching)
  period_start timestamptz not null,
  period_end timestamptz not null,
  gross_usd numeric(10,2) not null check (gross_usd > 0),
  status text not null default 'paid' check (status in ('paid', 'refunded')),
  refunded_at timestamptz,
  created_at timestamptz not null default now(),
  constraint digital_subscription_payments_ref_key unique (provider, provider_ref)
);
create index if not exists digital_subscription_payments_sub_idx on digital_subscription_payments (subscription_id, created_at);

create table if not exists digital_subscription_devices (
  subscription_id uuid not null references digital_subscriptions(id) on delete cascade,
  device_id text not null check (char_length(device_id) between 16 and 128),
  registered_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  primary key (subscription_id, device_id)
);

-- ----------------------------------------------------------------------------
-- Website (Paystack) checkouts
-- ----------------------------------------------------------------------------
create table if not exists digital_paystack_payments (
  reference text primary key check (reference ~ '^dgp_[a-f0-9]{24}$'),
  purpose text not null check (purpose in ('purchase', 'subscription')),
  buyer_id uuid not null references participants(id),
  item_id uuid references digital_products(item_id),
  creator_username text,
  tier_id text not null check (tier_id ~ '^(tier|sub)_[0-9]{4}$'),
  price_usd numeric(10,2) not null check (price_usd > 0),
  amount_kobo bigint not null check (amount_kobo > 0),
  exchange_rate numeric(14,4) not null check (exchange_rate > 0),
  email text not null,
  status text not null default 'initialized'
    check (status in ('initialized', 'paid', 'failed', 'refund_pending', 'refunded')),
  paystack_transaction_id text,
  fees_kobo bigint,
  license_id uuid references digital_licenses(id),
  subscription_id uuid references digital_subscriptions(id),
  failure text,
  created_at timestamptz not null default now(),
  verified_at timestamptz,
  constraint digital_paystack_payments_target check (
    (purpose = 'purchase' and item_id is not null and tier_id like 'tier_%')
    or (purpose = 'subscription' and creator_username is not null and tier_id like 'sub_%'))
);
create index if not exists digital_paystack_payments_status_idx on digital_paystack_payments (status, created_at);
create index if not exists digital_paystack_payments_txn_idx on digital_paystack_payments (paystack_transaction_id);

-- ----------------------------------------------------------------------------
-- Earnings ledger: subscription months too (still isolated from escrow/wallet)
-- ----------------------------------------------------------------------------
alter table digital_earnings alter column license_id drop not null;
alter table digital_earnings alter column item_id drop not null;
alter table digital_earnings add column if not exists subscription_payment_id uuid unique references digital_subscription_payments(id);
alter table digital_earnings add column if not exists source text not null default 'purchase';
alter table digital_earnings drop constraint if exists digital_earnings_source_check;
alter table digital_earnings add constraint digital_earnings_source_check check (source in ('purchase', 'subscription'));
alter table digital_earnings drop constraint if exists digital_earnings_one_source;
alter table digital_earnings add constraint digital_earnings_one_source check (
  (source = 'purchase' and license_id is not null and subscription_payment_id is null)
  or (source = 'subscription' and subscription_payment_id is not null and license_id is null));

-- ----------------------------------------------------------------------------
-- Rules
-- ----------------------------------------------------------------------------

-- Same rules as phase 1, plus the actual processor fee when known (Paystack
-- reports its fee per transaction; Google Play uses the settings percentage).
drop function if exists digital_grant_license(uuid, uuid, text, text, text, text, boolean);
create or replace function digital_grant_license(
  p_buyer_id uuid, p_item_id uuid, p_paid_tier_id text,
  p_provider text, p_provider_ref text, p_order_id text, p_is_paid boolean,
  p_fee_usd numeric default null
)
returns uuid
language plpgsql
set search_path = public
as $$
declare
  v_existing digital_licenses%rowtype;
  v_product digital_products%rowtype;
  v_item_price numeric;
  v_paid_price numeric;
  v_buyer text;
  v_settings digital_settings%rowtype;
  v_license uuid;
  v_fee numeric;
  v_commission numeric;
begin
  select * into v_existing from digital_licenses where provider = p_provider and provider_ref = p_provider_ref;
  if found then
    if v_existing.buyer_id = p_buyer_id and v_existing.item_id = p_item_id then return v_existing.id; end if;
    raise exception 'token_already_used';
  end if;

  select * into v_product from digital_products where item_id = p_item_id for share;
  if not found or v_product.status <> 'published' then raise exception 'product_not_available'; end if;
  select username into v_buyer from participants where id = p_buyer_id;
  if v_buyer is null then raise exception 'buyer_not_found'; end if;
  if v_buyer = v_product.seller_username then raise exception 'own_product'; end if;
  if exists (select 1 from digital_licenses where buyer_id = p_buyer_id and item_id = p_item_id and status = 'active') then
    raise exception 'already_owned';
  end if;

  select price_usd into v_item_price from digital_price_tiers where id = v_product.tier_id;
  if p_is_paid then
    select price_usd into v_paid_price from digital_price_tiers where id = p_paid_tier_id;
    if v_paid_price is null or v_paid_price < v_item_price then raise exception 'underpaid'; end if;
  end if;

  insert into digital_licenses (buyer_id, item_id, seller_username, tier_id, provider, provider_ref, order_id, price_usd, is_paid)
  values (p_buyer_id, p_item_id, v_product.seller_username, case when p_is_paid then p_paid_tier_id else null end,
          p_provider, p_provider_ref, p_order_id, case when p_is_paid then v_paid_price else 0 end, p_is_paid)
  returning id into v_license;

  if p_is_paid then
    select * into v_settings from digital_settings where id = 1;
    v_commission := round(v_paid_price * v_settings.commission_percent / 100, 2);
    -- Note: greatest(NULL, 0) is 0 in Postgres, so test for NULL explicitly.
    v_fee := least(case when p_fee_usd is null then round(v_paid_price * v_settings.store_fee_percent / 100, 2)
                        else round(greatest(p_fee_usd, 0), 2) end,
                   v_paid_price - v_commission);
    insert into digital_earnings (license_id, seller_username, item_id, gross_usd, store_fee_usd, commission_usd, net_usd, clears_at, source)
    values (v_license, v_product.seller_username, p_item_id, v_paid_price, v_fee, v_commission,
            v_paid_price - v_fee - v_commission, now() + make_interval(hours => v_settings.hold_hours), 'purchase');
  end if;
  return v_license;
end;
$$;

create or replace function digital_start_subscription(
  p_subscriber_id uuid, p_creator_username text, p_provider text, p_provider_ref text,
  p_product_id text, p_paid_tier_id text, p_period_start timestamptz, p_period_end timestamptz,
  p_auto_renew boolean, p_authorization_code text default null, p_email text default null,
  p_replaces_ref text default null
)
returns uuid
language plpgsql
set search_path = public
as $$
declare
  v_existing digital_subscriptions%rowtype;
  v_plan digital_creator_plans%rowtype;
  v_subscriber text;
  v_plan_price numeric;
  v_paid numeric;
  v_id uuid;
begin
  if p_provider not in ('google_play', 'paystack', 'admin_grant') then raise exception 'invalid_provider'; end if;
  if p_period_end <= p_period_start then raise exception 'invalid_period'; end if;

  -- Idempotent per purchase token / reference; never reusable for anyone else.
  select * into v_existing from digital_subscriptions where provider = p_provider and provider_ref = p_provider_ref;
  if found then
    if v_existing.subscriber_id = p_subscriber_id and v_existing.creator_username = p_creator_username then return v_existing.id; end if;
    raise exception 'token_already_used';
  end if;

  select * into v_plan from digital_creator_plans where creator_username = p_creator_username for share;
  if not found or not v_plan.is_active then raise exception 'plan_not_available'; end if;
  select username into v_subscriber from participants where id = p_subscriber_id;
  if v_subscriber is null then raise exception 'buyer_not_found'; end if;
  if v_subscriber = p_creator_username then raise exception 'own_product'; end if;

  select price_usd into v_plan_price from digital_sub_tiers where id = v_plan.tier_id;
  if p_provider <> 'admin_grant' then
    select price_usd into v_paid from digital_sub_tiers where id = p_paid_tier_id;
    if v_paid is null or v_paid < v_plan_price then raise exception 'underpaid'; end if;
  end if;

  -- A Google upgrade / resubscribe replaces the old token.
  if p_replaces_ref is not null then
    update digital_subscriptions
       set status = 'expired', auto_renew = false, ended_at = now(), end_reason = 'replaced', updated_at = now()
     where provider = p_provider and provider_ref = p_replaces_ref and subscriber_id = p_subscriber_id
       and status in ('active', 'past_due');
  end if;
  if exists (select 1 from digital_subscriptions
              where subscriber_id = p_subscriber_id and creator_username = p_creator_username
                and status in ('active', 'past_due') and current_period_end > now()) then
    raise exception 'already_subscribed';
  end if;
  -- Live rows whose period is already over end now.
  update digital_subscriptions
     set status = 'expired', auto_renew = false, ended_at = now(), end_reason = coalesce(end_reason, 'lapsed'), updated_at = now()
   where subscriber_id = p_subscriber_id and creator_username = p_creator_username and status in ('active', 'past_due');

  insert into digital_subscriptions (subscriber_id, creator_username, provider, provider_ref, product_id, tier_id, price_usd,
                                     auto_renew, current_period_start, current_period_end, paystack_authorization_code, paystack_email)
  values (p_subscriber_id, p_creator_username, p_provider, p_provider_ref, p_product_id,
          case when p_provider = 'admin_grant' then null else p_paid_tier_id end,
          coalesce(v_paid, 0), p_auto_renew, p_period_start, p_period_end, p_authorization_code, p_email)
  returning id into v_id;
  return v_id;
end;
$$;

-- One paid month: payment row + seller earning; extends the period. Idempotent.
create or replace function digital_record_subscription_payment(
  p_subscription_id uuid, p_provider text, p_provider_ref text, p_provider_txn_id text,
  p_period_start timestamptz, p_period_end timestamptz, p_gross_usd numeric, p_fee_usd numeric default null
)
returns uuid
language plpgsql
set search_path = public
as $$
declare
  s digital_subscriptions%rowtype;
  v_payment uuid;
  v_settings digital_settings%rowtype;
  v_fee numeric;
  v_commission numeric;
begin
  select id into v_payment from digital_subscription_payments where provider = p_provider and provider_ref = p_provider_ref;
  if found then return v_payment; end if;

  select * into s from digital_subscriptions where id = p_subscription_id for update;
  if not found then raise exception 'subscription_not_found'; end if;
  if s.provider <> p_provider then raise exception 'provider_mismatch'; end if;
  if s.status = 'revoked' then raise exception 'subscription_revoked'; end if;
  if p_gross_usd is null or p_gross_usd <= 0 or p_period_end <= p_period_start then raise exception 'invalid_payment'; end if;

  insert into digital_subscription_payments (subscription_id, provider, provider_ref, provider_txn_id, period_start, period_end, gross_usd)
  values (s.id, p_provider, p_provider_ref, p_provider_txn_id, p_period_start, p_period_end, round(p_gross_usd, 2))
  returning id into v_payment;

  select * into v_settings from digital_settings where id = 1;
  v_commission := round(p_gross_usd * v_settings.commission_percent / 100, 2);
  v_fee := least(case when p_fee_usd is null then round(p_gross_usd * v_settings.store_fee_percent / 100, 2)
                      else round(greatest(p_fee_usd, 0), 2) end,
                 round(p_gross_usd, 2) - v_commission);
  insert into digital_earnings (subscription_payment_id, source, seller_username, item_id, gross_usd, store_fee_usd, commission_usd, net_usd, clears_at)
  values (v_payment, 'subscription', s.creator_username, null, round(p_gross_usd, 2), v_fee, v_commission,
          round(p_gross_usd, 2) - v_fee - v_commission, now() + make_interval(hours => v_settings.hold_hours));

  update digital_subscriptions
     set current_period_start = case when p_period_end > current_period_end then p_period_start else current_period_start end,
         current_period_end = greatest(current_period_end, p_period_end),
         status = case when greatest(current_period_end, p_period_end) > now() then 'active' else status end,
         renewal_attempts = 0, last_renewal_error = null, last_charge_reference = null, updated_at = now()
   where id = s.id;
  return v_payment;
end;
$$;

-- Refund / chargeback of one paid month: the month's earning is reversed and
-- the subscription's access ends. Once.
create or replace function digital_revoke_subscription_payment(p_provider text, p_provider_ref text, p_reason text)
returns integer
language plpgsql
set search_path = public
as $$
declare
  p digital_subscription_payments%rowtype;
begin
  select * into p from digital_subscription_payments where provider = p_provider and provider_ref = p_provider_ref for update;
  if not found or p.status = 'refunded' then return 0; end if;
  update digital_subscription_payments set status = 'refunded', refunded_at = now() where id = p.id;
  update digital_earnings set status = 'reversed', reversed_at = now(), reversal_reason = p_reason
   where subscription_payment_id = p.id and status = 'pending';
  update digital_subscriptions
     set status = 'revoked', auto_renew = false, ended_at = now(), end_reason = p_reason, updated_at = now()
   where id = p.subscription_id and status <> 'revoked';
  return 1;
end;
$$;

-- Ends a subscription now (admin action, or a refund matched only by token).
create or replace function digital_end_subscription(p_subscription_id uuid, p_status text, p_reason text)
returns integer
language plpgsql
set search_path = public
as $$
declare
  v_count integer;
begin
  if p_status not in ('expired', 'revoked') then raise exception 'invalid_status'; end if;
  update digital_subscriptions
     set status = p_status, auto_renew = false, ended_at = now(), end_reason = p_reason, updated_at = now()
   where id = p_subscription_id and status in ('active', 'past_due');
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- The subscription giving this subscriber access to this item right now, if any.
create or replace function digital_subscription_access(p_subscriber_id uuid, p_item_id uuid)
returns table (subscription_id uuid, current_period_end timestamptz)
language sql
stable
set search_path = public
as $$
  select s.id, s.current_period_end
    from digital_subscriptions s
    join digital_products p on p.seller_username = s.creator_username
   where s.subscriber_id = p_subscriber_id and p.item_id = p_item_id
     and p.status = 'published' and p.in_subscription
     and s.status in ('active', 'past_due') and s.current_period_end > now()
   order by s.current_period_end desc
   limit 1;
$$;

create or replace function digital_register_sub_device(p_subscription_id uuid, p_subscriber_id uuid, p_device_id text)
returns integer
language plpgsql
set search_path = public
as $$
declare
  s digital_subscriptions%rowtype;
  v_max integer;
  v_count integer;
begin
  select * into s from digital_subscriptions where id = p_subscription_id for update;
  if not found or s.subscriber_id <> p_subscriber_id then raise exception 'license_not_found'; end if;
  if s.status not in ('active', 'past_due') or s.current_period_end <= now() then raise exception 'license_inactive'; end if;
  if exists (select 1 from digital_subscription_devices where subscription_id = s.id and device_id = p_device_id) then
    update digital_subscription_devices set last_seen_at = now() where subscription_id = s.id and device_id = p_device_id;
  else
    select max_devices into v_max from digital_settings where id = 1;
    select count(*) into v_count from digital_subscription_devices where subscription_id = s.id;
    if v_count >= v_max then raise exception 'device_limit'; end if;
    insert into digital_subscription_devices (subscription_id, device_id) values (s.id, p_device_id);
  end if;
  select count(*) into v_count from digital_subscription_devices where subscription_id = s.id;
  return v_count;
end;
$$;

-- Website subscriptions whose renewal failed for 3 days (or were cancelled)
-- end. Google Play subscriptions follow Google's own state (billing sync).
create or replace function digital_expire_subscriptions()
returns integer
language plpgsql
set search_path = public
as $$
declare
  v_count integer;
begin
  update digital_subscriptions
     set status = 'expired', auto_renew = false, ended_at = now(),
         end_reason = coalesce(end_reason, case when auto_renew then 'renewal payment failed' else 'cancelled' end), updated_at = now()
   where provider in ('paystack', 'admin_grant') and status in ('active', 'past_due')
     and current_period_end < now() - case when auto_renew then interval '3 days' else interval '0 days' end;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- ----------------------------------------------------------------------------
-- Server-only access
-- ----------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['digital_sub_tiers', 'digital_sub_products', 'digital_creator_plans', 'digital_subscriptions',
                           'digital_subscription_payments', 'digital_subscription_devices', 'digital_paystack_payments'] loop
    execute format('alter table %I enable row level security', t);
    execute format('revoke all on table %I from anon, authenticated, public', t);
    execute format('grant all on table %I to service_role', t);
  end loop;
end $$;

do $$
declare f text;
begin
  foreach f in array array[
    'digital_grant_license(uuid, uuid, text, text, text, text, boolean, numeric)',
    'digital_start_subscription(uuid, text, text, text, text, text, timestamptz, timestamptz, boolean, text, text, text)',
    'digital_record_subscription_payment(uuid, text, text, text, timestamptz, timestamptz, numeric, numeric)',
    'digital_revoke_subscription_payment(text, text, text)',
    'digital_end_subscription(uuid, text, text)',
    'digital_subscription_access(uuid, uuid)',
    'digital_register_sub_device(uuid, uuid, text)',
    'digital_expire_subscriptions()'] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $$;

-- ----------------------------------------------------------------------------
-- Verification - every row must be ok = true
-- ----------------------------------------------------------------------------
with checks(check_name, ok) as (
  select 'table ' || t, to_regclass('public.' || t) is not null
    from unnest(array['digital_sub_tiers', 'digital_sub_products', 'digital_creator_plans', 'digital_subscriptions',
                      'digital_subscription_payments', 'digital_subscription_devices', 'digital_paystack_payments']) t
  union all select 'RLS on ' || t, coalesce((select relrowsecurity from pg_class where oid = to_regclass('public.' || t)), false)
    from unnest(array['digital_subscriptions', 'digital_subscription_payments', 'digital_paystack_payments', 'digital_creator_plans']) t
  union all select 'anon cannot read ' || t, not has_table_privilege('anon', 'public.' || t, 'select')
    from unnest(array['digital_subscriptions', 'digital_paystack_payments', 'digital_subscription_payments']) t
  union all select '6 subscription tiers', (select count(*) from digital_sub_tiers) = 6
  union all select '18 subscription products with placeholder Play ids',
    (select count(*) from digital_sub_products where google_play_product_id like 'onedream_creator_%') = 18
  union all select 'licences accept paystack',
    pg_get_constraintdef((select oid from pg_constraint where conname = 'digital_licenses_provider_check')) like '%paystack%'
  union all select 'assets accept epub',
    pg_get_constraintdef((select oid from pg_constraint where conname = 'digital_assets_kind_check')) like '%epub%'
  union all select 'products.in_subscription column',
    exists (select 1 from information_schema.columns where table_name = 'digital_products' and column_name = 'in_subscription')
  union all select 'earnings: one source per row', exists (select 1 from pg_constraint where conname = 'digital_earnings_one_source')
  union all select 'earnings arithmetic still enforced', exists (select 1 from pg_constraint where conname = 'digital_earnings_arithmetic')
  union all select 'one live subscription per subscriber+creator', exists (select 1 from pg_indexes where indexname = 'digital_subscriptions_one_live')
  union all select 'subscription token unique', exists (select 1 from pg_constraint where conname = 'digital_subscriptions_provider_ref_key')
  union all select 'subscription payment unique', exists (select 1 from pg_constraint where conname = 'digital_subscription_payments_ref_key')
  union all select 'only the new grant function remains',
    (select count(*) from pg_proc where proname = 'digital_grant_license') = 1
  union all select 'function ' || f, to_regproc('public.' || f) is not null
    from unnest(array['digital_start_subscription', 'digital_record_subscription_payment', 'digital_revoke_subscription_payment',
                      'digital_end_subscription', 'digital_subscription_access', 'digital_register_sub_device',
                      'digital_expire_subscriptions']) f
  union all select 'anon cannot grant licences',
    not has_function_privilege('anon', 'public.digital_grant_license(uuid,uuid,text,text,text,text,boolean,numeric)', 'execute')
  union all select 'anon cannot start subscriptions',
    not has_function_privilege('anon', 'public.digital_start_subscription(uuid,text,text,text,text,text,timestamptz,timestamptz,boolean,text,text,text)', 'execute')
)
select * from checks;
