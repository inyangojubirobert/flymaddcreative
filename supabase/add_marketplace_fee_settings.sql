-- ============================================================================
-- Marketplace fee settings (USD-based, editable in the database)
-- ============================================================================
-- All marketplace prices and charges are in US dollars. NGN is only a
-- conversion for Paystack (lib/currency.js, live rate) - other payment
-- currencies can be added the same way without changing these settings.
--
-- Edit fees in Supabase (Table editor -> marketplace_fee_settings, row id 1).
-- The API re-reads this row at most once a minute; every checkout records the
-- policy it was charged under, so edits never change past orders.
--
-- Safe to run after the API is deployed: until this table exists the API uses
-- the same defaults (1%, capped at $1.00).
-- ============================================================================

create table if not exists marketplace_fee_settings (
  id smallint primary key default 1 check (id = 1),                 -- single row
  buyer_fee_percent numeric(5,2) not null default 1
    check (buyer_fee_percent >= 0 and buyer_fee_percent <= 20),     -- 0 = no buyer charge
  buyer_fee_cap_usd numeric(10,2) default 1.00
    check (buyer_fee_cap_usd is null or buyer_fee_cap_usd >= 0),    -- null = no cap
  seller_commission_percent numeric(5,2) not null default 5
    check (seller_commission_percent >= 0 and seller_commission_percent <= 50),
    -- planned seller commission; NOT deducted yet (needs the seller earnings ledger)
  updated_at timestamptz not null default now()
);

insert into marketplace_fee_settings (id) values (1) on conflict (id) do nothing;

create or replace function marketplace_fee_settings_touch()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists marketplace_fee_settings_touch on marketplace_fee_settings;
create trigger marketplace_fee_settings_touch
  before update on marketplace_fee_settings
  for each row execute function marketplace_fee_settings_touch();

-- Server-only (the API reads it with the service role).
alter table marketplace_fee_settings enable row level security;
revoke all on table marketplace_fee_settings from anon, authenticated, public;
grant all on table marketplace_fee_settings to service_role;

-- Checkouts record the USD cap they were charged under.
alter table catalogue_checkouts add column if not exists fee_cap_usd numeric(10,2);

-- create_cart_checkout(): same as supabase/add_cart_checkout.sql, plus fee_cap_usd.
create or replace function create_cart_checkout(p_checkout jsonb, p_orders jsonb)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v_c catalogue_checkouts%rowtype;
  v_id uuid;
  v_claim text;
begin
  select id into v_id from catalogue_checkouts where payment_ref = p_checkout->>'payment_ref';
  if v_id is not null then
    return jsonb_build_object('checkout_id', v_id, 'created', false);
  end if;

  if jsonb_typeof(p_orders) <> 'array' or jsonb_array_length(p_orders) = 0 then
    raise exception 'cart_checkout_no_orders';
  end if;

  v_c := jsonb_populate_record(null::catalogue_checkouts, p_checkout);

  if v_c.payment_method = 'usdt' then
    v_claim := claim_usdt_payment(v_c.payment_ref, 'catalogue_cart', v_c.payment_ref);
    if v_claim not in ('claimed', 'already_claimed') then
      raise exception 'usdt_payment_%', v_claim;
    end if;
  end if;

  insert into catalogue_checkouts (
    payment_ref, payment_method, network, buyer_name, buyer_email, buyer_whatsapp, notes,
    lines, subtotal_usd, service_fee_usd, total_usd, fee_percent, fee_cap_ngn, fee_cap_usd,
    currency, amount_ngn, exchange_rate, status
  ) values (
    v_c.payment_ref, v_c.payment_method, v_c.network, v_c.buyer_name, v_c.buyer_email, v_c.buyer_whatsapp, v_c.notes,
    v_c.lines, v_c.subtotal_usd, v_c.service_fee_usd, v_c.total_usd, v_c.fee_percent, v_c.fee_cap_ngn, v_c.fee_cap_usd,
    v_c.currency, v_c.amount_ngn, v_c.exchange_rate, coalesce(v_c.status, 'paid')
  ) returning id into v_id;

  insert into catalogue_orders (
    item_id, seller_username, buyer_name, buyer_email, buyer_whatsapp, notes,
    amount_usd, unit_price_usd, quantity, payment_method, currency, exchange_rate, amount_ngn,
    payment_ref, tx_hash, status, buyer_token, created_at, checkout_id
  )
  select o.item_id, o.seller_username, o.buyer_name, o.buyer_email, o.buyer_whatsapp, o.notes,
         o.amount_usd, o.unit_price_usd, coalesce(o.quantity, 1), o.payment_method, o.currency, o.exchange_rate, o.amount_ngn,
         o.payment_ref, o.tx_hash, o.status, o.buyer_token, coalesce(o.created_at, now()), v_id
    from jsonb_populate_recordset(null::catalogue_orders, p_orders) o;

  return jsonb_build_object('checkout_id', v_id, 'created', true);
exception
  when unique_violation then
    select id into v_id from catalogue_checkouts where payment_ref = p_checkout->>'payment_ref';
    if v_id is null then raise; end if;
    return jsonb_build_object('checkout_id', v_id, 'created', false);
end;
$$;

revoke all on function create_cart_checkout(jsonb, jsonb) from public, anon, authenticated;
grant execute on function create_cart_checkout(jsonb, jsonb) to service_role;

-- ----------------------------------------------------------------------------
-- Verification - every row must be ok = true
-- ----------------------------------------------------------------------------
with checks(check_name, ok) as (
  select 'table marketplace_fee_settings', to_regclass('public.marketplace_fee_settings') is not null
  union all select 'settings row exists', exists (select 1 from marketplace_fee_settings where id = 1)
  union all select 'settings RLS on',
    coalesce((select relrowsecurity from pg_class where oid = to_regclass('public.marketplace_fee_settings')), false)
  union all select 'anon cannot read settings', not has_table_privilege('anon', 'public.marketplace_fee_settings', 'select')
  union all select 'authenticated cannot update settings', not has_table_privilege('authenticated', 'public.marketplace_fee_settings', 'update')
  union all select 'catalogue_checkouts.fee_cap_usd',
    exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'catalogue_checkouts' and column_name = 'fee_cap_usd')
  union all select 'create_cart_checkout writes fee_cap_usd',
    pg_get_functiondef(to_regprocedure('public.create_cart_checkout(jsonb,jsonb)')) ilike '%fee_cap_usd%'
  union all select 'anon cannot execute create_cart_checkout',
    not has_function_privilege('anon', 'public.create_cart_checkout(jsonb,jsonb)', 'execute')
)
select * from checks
union all
select 'current: ' || buyer_fee_percent || '% buyer fee, cap $' || coalesce(buyer_fee_cap_usd::text, 'none')
       || ', seller commission ' || seller_commission_percent || '% (not applied yet)', true
from marketplace_fee_settings where id = 1;
