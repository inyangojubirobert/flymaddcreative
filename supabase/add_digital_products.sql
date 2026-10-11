-- ============================================================================
-- Digital products: e-books (PDF), audio, video - instant access library
-- ============================================================================
-- Additive. Reads participants and catalogue_items via foreign keys; changes
-- no existing table, escrow, wallet or withdrawal object.
--
--   digital_settings          single row: store fee %, commission %, hold, offline window, device limit
--   digital_price_tiers       Google Play price-tier products (placeholder ids, prices in USD)
--   digital_products          a catalogue listing sold as digital content (kind + tier + review)
--   digital_assets            files (Cloudinary references only): PDF / audio tracks / video lessons
--   digital_licenses          who owns what; one per verified purchase or admin grant
--   digital_license_devices   devices a licence is downloaded to (limit)
--   digital_earnings          ISOLATED seller ledger for digital sales:
--                             gross - store fee - commission = net; pending -> cleared after the
--                             hold; reversed on refund. Paid out by admin after reconciling with
--                             Google Play payouts. Not connected to escrow or withdrawals.
--
-- Rules (functions, so every client follows them):
--   digital_grant_license()   purchase bound to exact item + buyer; paid tier >= item price;
--                             one active licence per buyer+item; no self-purchase; idempotent
--   digital_revoke_license()  refunds/revocations: licence off + earnings reversed (once)
--   digital_register_device() device limit per licence
--   digital_earnings_summary()
--
-- Server-only (RLS on, no client privileges). Verify with the query at the bottom.
-- ============================================================================

create table if not exists digital_settings (
  id smallint primary key default 1 check (id = 1),
  store_fee_percent numeric(5,2) not null default 15 check (store_fee_percent between 0 and 50),
  commission_percent numeric(5,2) not null default 5 check (commission_percent between 0 and 50),
  hold_hours integer not null default 72 check (hold_hours between 0 and 720),
  offline_days integer not null default 30 check (offline_days between 1 and 365),
  max_devices integer not null default 3 check (max_devices between 1 and 10),
  updated_at timestamptz not null default now()
);
insert into digital_settings (id) values (1) on conflict (id) do nothing;

create table if not exists digital_price_tiers (
  id text primary key check (id ~ '^tier_[0-9]{4}$'),
  price_usd numeric(10,2) not null unique check (price_usd > 0),
  google_play_product_id text unique,          -- must match Play Console exactly
  is_active boolean not null default true
);

insert into digital_price_tiers (id, price_usd, google_play_product_id)
select 'tier_' || lpad((p * 100)::int::text, 4, '0'), p, 'onedream_digital_' || lpad((p * 100)::int::text, 4, '0')
  from unnest(array[0.99, 1.99, 2.99, 3.99, 4.99, 5.99, 6.99, 7.99, 8.99, 9.99, 12.99, 14.99, 19.99, 24.99, 29.99, 39.99, 49.99]::numeric[]) as p
on conflict (id) do nothing;

create table if not exists digital_products (
  item_id uuid primary key references catalogue_items(id),
  seller_username text not null,
  kind text not null check (kind in ('ebook', 'audio', 'video')),
  tier_id text not null references digital_price_tiers(id),
  preview_pages integer not null default 3 check (preview_pages between 0 and 10),
  preview_seconds integer not null default 30 check (preview_seconds between 0 and 120),
  rights_confirmed boolean not null default false,
  status text not null default 'draft' check (status in ('draft', 'pending_review', 'published', 'rejected', 'suspended')),
  review_note text,
  reviewed_by uuid,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint digital_products_rights check (status in ('draft', 'rejected') or rights_confirmed)
);

create table if not exists digital_assets (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references digital_products(item_id) on delete cascade,
  owner_id uuid not null references participants(id),
  kind text not null check (kind in ('pdf', 'audio', 'video')),
  title text,
  position integer not null default 0,
  cloudinary_public_id text not null unique,
  resource_type text not null check (resource_type in ('image', 'video')),
  format text not null,
  bytes bigint not null check (bytes > 0),
  pages integer,
  duration_seconds numeric(10,2),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'removed')),
  created_at timestamptz not null default now()
);
create index if not exists digital_assets_item_idx on digital_assets (item_id, position);

create table if not exists digital_licenses (
  id uuid primary key default gen_random_uuid(),
  buyer_id uuid not null references participants(id),
  item_id uuid not null references digital_products(item_id),
  seller_username text not null,
  tier_id text references digital_price_tiers(id),
  provider text not null check (provider in ('google_play', 'admin_grant')),
  provider_ref text not null,                    -- purchase token / grant id
  order_id text,
  price_usd numeric(10,2),
  is_paid boolean not null,
  status text not null default 'active' check (status in ('active', 'refunded', 'revoked')),
  first_accessed_at timestamptz,
  revoke_reason text,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  constraint digital_licenses_provider_ref_key unique (provider, provider_ref)
);
create unique index if not exists digital_licenses_one_active on digital_licenses (buyer_id, item_id) where status = 'active';
create index if not exists digital_licenses_buyer_idx on digital_licenses (buyer_id, created_at desc);

create table if not exists digital_license_devices (
  license_id uuid not null references digital_licenses(id) on delete cascade,
  device_id text not null check (char_length(device_id) between 16 and 128),
  registered_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  primary key (license_id, device_id)
);

create table if not exists digital_earnings (
  id uuid primary key default gen_random_uuid(),
  license_id uuid not null unique references digital_licenses(id),
  seller_username text not null,
  item_id uuid not null,
  gross_usd numeric(10,2) not null check (gross_usd >= 0),
  store_fee_usd numeric(10,2) not null check (store_fee_usd >= 0),
  commission_usd numeric(10,2) not null check (commission_usd >= 0),
  net_usd numeric(10,2) not null check (net_usd >= 0),
  status text not null default 'pending' check (status in ('pending', 'reversed', 'paid_out')),
  clears_at timestamptz not null,
  reversed_at timestamptz,
  reversal_reason text,
  paid_out_at timestamptz,
  payout_reference text,
  created_at timestamptz not null default now(),
  constraint digital_earnings_arithmetic check (gross_usd = store_fee_usd + commission_usd + net_usd)
);
create index if not exists digital_earnings_seller_idx on digital_earnings (seller_username, status);

-- ----------------------------------------------------------------------------
-- Rules
-- ----------------------------------------------------------------------------

-- Grants a licence for a verified purchase (or an admin grant). Purchase
-- binding: the caller passes the item id that Google returned in the purchase
-- (obfuscatedExternalProfileId) and the tier that was actually paid; this
-- function refuses anything that does not cover the item's price.
create or replace function digital_grant_license(
  p_buyer_id uuid, p_item_id uuid, p_paid_tier_id text,
  p_provider text, p_provider_ref text, p_order_id text, p_is_paid boolean
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
  -- Idempotent per purchase token; a token can never unlock anything else.
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
    v_fee := round(v_paid_price * v_settings.store_fee_percent / 100, 2);
    v_commission := round(v_paid_price * v_settings.commission_percent / 100, 2);
    insert into digital_earnings (license_id, seller_username, item_id, gross_usd, store_fee_usd, commission_usd, net_usd, clears_at)
    values (v_license, v_product.seller_username, p_item_id, v_paid_price, v_fee, v_commission,
            v_paid_price - v_fee - v_commission, now() + make_interval(hours => v_settings.hold_hours));
  end if;
  return v_license;
end;
$$;

-- Refund / chargeback / revocation: licence off, seller earning reversed. Once.
create or replace function digital_revoke_license(p_provider text, p_provider_ref text, p_status text, p_reason text)
returns integer
language plpgsql
set search_path = public
as $$
declare
  l digital_licenses%rowtype;
begin
  if p_status not in ('refunded', 'revoked') then raise exception 'invalid_status'; end if;
  select * into l from digital_licenses where provider = p_provider and provider_ref = p_provider_ref for update;
  if not found or l.status <> 'active' then return 0; end if;
  update digital_licenses set status = p_status, revoke_reason = p_reason, revoked_at = now() where id = l.id;
  update digital_earnings set status = 'reversed', reversed_at = now(), reversal_reason = p_reason
   where license_id = l.id and status = 'pending';
  -- Already paid out: stays paid_out; reconciliation shows it as owed by the seller.
  return 1;
end;
$$;

-- Registers (or refreshes) a device for an active licence, within the limit.
create or replace function digital_register_device(p_license_id uuid, p_buyer_id uuid, p_device_id text)
returns integer
language plpgsql
set search_path = public
as $$
declare
  l digital_licenses%rowtype;
  v_max integer;
  v_count integer;
begin
  select * into l from digital_licenses where id = p_license_id for update;
  if not found or l.buyer_id <> p_buyer_id then raise exception 'license_not_found'; end if;
  if l.status <> 'active' then raise exception 'license_inactive'; end if;
  if exists (select 1 from digital_license_devices where license_id = l.id and device_id = p_device_id) then
    update digital_license_devices set last_seen_at = now() where license_id = l.id and device_id = p_device_id;
  else
    select max_devices into v_max from digital_settings where id = 1;
    select count(*) into v_count from digital_license_devices where license_id = l.id;
    if v_count >= v_max then raise exception 'device_limit'; end if;
    insert into digital_license_devices (license_id, device_id) values (l.id, p_device_id);
  end if;
  update digital_licenses set first_accessed_at = coalesce(first_accessed_at, now()) where id = l.id;
  select count(*) into v_count from digital_license_devices where license_id = l.id;
  return v_count;
end;
$$;

create or replace function digital_earnings_summary(p_seller text)
returns table(sales integer, gross_usd numeric, store_fees_usd numeric, commission_usd numeric,
              pending_usd numeric, cleared_usd numeric, paid_out_usd numeric, reversed_usd numeric)
language sql
stable
set search_path = public
as $$
  select
    count(*) filter (where status <> 'reversed')::int,
    coalesce(sum(gross_usd) filter (where status <> 'reversed'), 0),
    coalesce(sum(store_fee_usd) filter (where status <> 'reversed'), 0),
    coalesce(sum(commission_usd) filter (where status <> 'reversed'), 0),
    coalesce(sum(net_usd) filter (where status = 'pending' and clears_at > now()), 0),
    coalesce(sum(net_usd) filter (where status = 'pending' and clears_at <= now()), 0),
    coalesce(sum(net_usd) filter (where status = 'paid_out'), 0),
    coalesce(sum(net_usd) filter (where status = 'reversed'), 0)
  from digital_earnings where seller_username = p_seller;
$$;

-- ----------------------------------------------------------------------------
-- Server-only access
-- ----------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['digital_settings', 'digital_price_tiers', 'digital_products', 'digital_assets',
                           'digital_licenses', 'digital_license_devices', 'digital_earnings'] loop
    execute format('alter table %I enable row level security', t);
    execute format('revoke all on table %I from anon, authenticated, public', t);
    execute format('grant all on table %I to service_role', t);
  end loop;
end $$;

do $$
declare f text;
begin
  foreach f in array array['digital_grant_license(uuid, uuid, text, text, text, text, boolean)',
                           'digital_revoke_license(text, text, text, text)',
                           'digital_register_device(uuid, uuid, text)', 'digital_earnings_summary(text)'] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $$;

-- ----------------------------------------------------------------------------
-- Verification - every row must be ok = true
-- ----------------------------------------------------------------------------
with checks(check_name, ok) as (
  select 'table ' || t, to_regclass('public.' || t) is not null
    from unnest(array['digital_settings', 'digital_price_tiers', 'digital_products', 'digital_assets',
                      'digital_licenses', 'digital_license_devices', 'digital_earnings']) t
  union all select 'RLS on ' || t, coalesce((select relrowsecurity from pg_class where oid = to_regclass('public.' || t)), false)
    from unnest(array['digital_products', 'digital_assets', 'digital_licenses', 'digital_earnings']) t
  union all select 'anon cannot read ' || t, not has_table_privilege('anon', 'public.' || t, 'select')
    from unnest(array['digital_assets', 'digital_licenses', 'digital_earnings']) t
  union all select '17 price tiers with placeholder Play product ids',
    (select count(*) from digital_price_tiers where google_play_product_id like 'onedream_digital_%') = 17
  union all select 'settings row', exists (select 1 from digital_settings where id = 1)
  union all select 'one active licence per buyer+item', exists (select 1 from pg_indexes where indexname = 'digital_licenses_one_active')
  union all select 'purchase token unique', exists (select 1 from pg_constraint where conname = 'digital_licenses_provider_ref_key')
  union all select 'earnings arithmetic enforced', exists (select 1 from pg_constraint where conname = 'digital_earnings_arithmetic')
  union all select 'function ' || f, to_regproc('public.' || f) is not null
    from unnest(array['digital_grant_license', 'digital_revoke_license', 'digital_register_device', 'digital_earnings_summary']) f
  union all select 'anon cannot grant licences',
    not has_function_privilege('anon', 'public.digital_grant_license(uuid,uuid,text,text,text,text,boolean)', 'execute')
)
select * from checks;
