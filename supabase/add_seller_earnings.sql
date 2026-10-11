-- ============================================================================
-- Seller earnings ledger, marketplace withdrawals, private contacts
-- ============================================================================
-- Run AFTER supabase/add_cart_checkout.sql and
-- supabase/add_marketplace_fee_settings.sql, and BEFORE deploying the API
-- code that uses it. Additive only.
--
-- 1. catalogue_orders gets the seller commission captured at purchase time
--    (commission_percent / commission_usd / seller_net_usd), delivery details
--    and status timestamps. The ledger is computed from these rows - there is
--    no second balance to drift out of sync:
--      pending      paid, pending_verification   (visible, not withdrawable)
--      on hold      disputed
--      withdrawable buyer_confirmed, released
--    Orders created before this migration have commission_percent = null and
--    are NOT counted (they were settled manually). To bring an unpaid legacy
--    order into the ledger, set its commission_percent (e.g. 0) by hand.
-- 2. catalogue_order_events: append-only audit of every order status change.
-- 3. participant_withdrawals.source: 'votes' | 'marketplace'. The vote
--    balance only counts vote withdrawals; marketplace withdrawals only count
--    against marketplace earnings. Existing rows are vote withdrawals.
-- 4. request_seller_withdrawal(): atomic, row-locked, reserves funds at once
--    (any non-rejected request counts against the balance; rejection
--    restores it). Admin approval uses the existing withdrawal workflow.
-- 5. participant_private_contacts: seller phone/WhatsApp, never public.
--
-- Supabase's SQL editor may not apply a paste atomically - run the
-- verification query at the bottom and confirm every row is ok = true.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Commission + delivery details on orders
-- ----------------------------------------------------------------------------
alter table catalogue_orders add column if not exists commission_percent numeric(5,2);
alter table catalogue_orders add column if not exists commission_usd numeric(12,2);
alter table catalogue_orders add column if not exists seller_net_usd numeric(12,2);
alter table catalogue_orders add column if not exists delivery_address text;
alter table catalogue_orders add column if not exists buyer_confirmed_at timestamptz;
alter table catalogue_orders add column if not exists disputed_at timestamptz;
alter table catalogue_orders add column if not exists released_at timestamptz;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'catalogue_orders_commission_check') then
    alter table catalogue_orders add constraint catalogue_orders_commission_check check (
      commission_percent is null
      or (commission_percent between 0 and 50
          and commission_usd >= 0
          and seller_net_usd >= 0
          and commission_usd + seller_net_usd = amount_usd)
    );
  end if;
end $$;

create index if not exists catalogue_orders_seller_status_idx on catalogue_orders (seller_username, status);

alter table catalogue_checkouts add column if not exists delivery_address text;

-- ----------------------------------------------------------------------------
-- 2. Order status audit trail (+ status timestamps)
-- ----------------------------------------------------------------------------
create table if not exists catalogue_order_events (
  id bigint generated always as identity primary key,
  order_id uuid not null references catalogue_orders(id) on delete cascade,
  from_status text,
  to_status text not null,
  created_at timestamptz not null default now()
);
create index if not exists catalogue_order_events_order_idx on catalogue_order_events (order_id, created_at);

alter table catalogue_order_events enable row level security;
revoke all on table catalogue_order_events from anon, authenticated, public;
grant all on table catalogue_order_events to service_role;

create or replace function catalogue_orders_track_status()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    insert into catalogue_order_events (order_id, from_status, to_status) values (new.id, null, new.status);
    return new;
  end if;
  if new.status is distinct from old.status then
    insert into catalogue_order_events (order_id, from_status, to_status) values (new.id, old.status, new.status);
    if new.status = 'buyer_confirmed' and new.buyer_confirmed_at is null then new.buyer_confirmed_at := now(); end if;
    if new.status = 'disputed' and new.disputed_at is null then new.disputed_at := now(); end if;
    if new.status = 'released' and new.released_at is null then new.released_at := now(); end if;
  end if;
  return new;
end;
$$;

drop trigger if exists catalogue_orders_track_status_ins on catalogue_orders;
create trigger catalogue_orders_track_status_ins
  after insert on catalogue_orders
  for each row execute function catalogue_orders_track_status();

drop trigger if exists catalogue_orders_track_status_upd on catalogue_orders;
create trigger catalogue_orders_track_status_upd
  before update of status on catalogue_orders
  for each row execute function catalogue_orders_track_status();

-- ----------------------------------------------------------------------------
-- 3. Withdrawal source
-- ----------------------------------------------------------------------------
alter table participant_withdrawals add column if not exists source text not null default 'votes';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'participant_withdrawals_source_check') then
    alter table participant_withdrawals add constraint participant_withdrawals_source_check
      check (source in ('votes', 'marketplace'));
  end if;
end $$;

-- Vote withdrawals: same as supabase/fix_participant_withdrawals_schema.sql,
-- but only vote withdrawals count against vote earnings.
create or replace function request_participant_withdrawal(
  p_participant_id uuid,
  p_amount numeric,
  p_method text,
  p_details text
)
returns table(withdrawal_id uuid, available_balance numeric)
language plpgsql
as $$
declare
  v_username text;
  v_total_votes numeric;
  v_earned numeric;
  v_withdrawn numeric;
  v_available numeric;
  v_id uuid;
  reward_rate_usd constant numeric := 1.00; -- must match REWARD_RATE_USD in public/js/supabase-config.js
begin
  select username, total_votes into v_username, v_total_votes
  from participants
  where id = p_participant_id
  for update;

  if v_username is null then
    raise exception 'participant_not_found';
  end if;

  v_earned := coalesce(v_total_votes, 0) * reward_rate_usd;

  select coalesce(sum(amount_usd), 0) into v_withdrawn
  from participant_withdrawals
  where username = v_username and status <> 'rejected' and source = 'votes';

  v_available := v_earned - v_withdrawn;

  if p_amount <= 0 or p_amount > v_available then
    raise exception 'insufficient_balance';
  end if;

  insert into participant_withdrawals (username, amount_usd, payment_method, payment_details, status, created_at, source)
  values (v_username, p_amount, p_method, p_details, 'pending', now(), 'votes')
  returning id into v_id;

  return query select v_id, v_available - p_amount;
end;
$$;

-- ----------------------------------------------------------------------------
-- 4. Marketplace earnings + withdrawals
-- ----------------------------------------------------------------------------
-- One row per seller with every ledger figure, computed from orders and
-- withdrawals. Used by the API and by request_seller_withdrawal().
create or replace function seller_earnings_summary(p_username text)
returns table(
  completed_gross_usd numeric,
  commission_usd numeric,
  withdrawable_earned_usd numeric,
  pending_net_usd numeric,
  on_hold_net_usd numeric,
  pending_count integer,
  withdrawals_pending_usd numeric,
  withdrawals_paid_usd numeric,
  available_usd numeric
)
language sql
stable
set search_path = public
as $$
  with o as (
    select status, amount_usd, commission_usd, seller_net_usd
      from catalogue_orders
     where seller_username = p_username and commission_percent is not null
  ), w as (
    select status, amount_usd
      from participant_withdrawals
     where username = p_username and source = 'marketplace'
  )
  select
    coalesce((select sum(amount_usd) from o where status in ('buyer_confirmed', 'released')), 0),
    coalesce((select sum(commission_usd) from o where status in ('buyer_confirmed', 'released')), 0),
    coalesce((select sum(seller_net_usd) from o where status in ('buyer_confirmed', 'released')), 0),
    coalesce((select sum(seller_net_usd) from o where status in ('paid', 'pending_verification')), 0),
    coalesce((select sum(seller_net_usd) from o where status = 'disputed'), 0),
    (select count(*)::int from o where status in ('paid', 'pending_verification')),
    coalesce((select sum(amount_usd) from w where status in ('pending', 'processing')), 0),
    coalesce((select sum(amount_usd) from w where status in ('claimed', 'paid')), 0),
    coalesce((select sum(seller_net_usd) from o where status in ('buyer_confirmed', 'released')), 0)
      - coalesce((select sum(amount_usd) from w where status <> 'rejected'), 0);
$$;

create or replace function request_seller_withdrawal(
  p_participant_id uuid,
  p_amount numeric,
  p_method text,
  p_details text
)
returns table(withdrawal_id uuid, available_balance numeric)
language plpgsql
set search_path = public
as $$
declare
  v_username text;
  v_available numeric;
  v_id uuid;
begin
  -- Same participant-row lock as vote withdrawals: concurrent requests from
  -- one seller are serialised, so funds can't be requested twice.
  select username into v_username from participants where id = p_participant_id for update;
  if v_username is null then
    raise exception 'participant_not_found';
  end if;

  select s.available_usd into v_available from seller_earnings_summary(v_username) s;

  if p_amount is null or p_amount <= 0 or round(p_amount, 2) <> p_amount or p_amount > v_available then
    raise exception 'insufficient_balance';
  end if;

  insert into participant_withdrawals (username, amount_usd, payment_method, payment_details, status, created_at, source)
  values (v_username, p_amount, p_method, p_details, 'pending', now(), 'marketplace')
  returning id into v_id;

  return query select v_id, v_available - p_amount;
end;
$$;

-- ----------------------------------------------------------------------------
-- 5. Private contacts (seller phone / WhatsApp)
-- ----------------------------------------------------------------------------
create table if not exists participant_private_contacts (
  participant_id uuid primary key references participants(id) on delete cascade,
  phone text,
  whatsapp text,
  updated_at timestamptz not null default now()
);
alter table participant_private_contacts enable row level security;
revoke all on table participant_private_contacts from anon, authenticated, public;
grant all on table participant_private_contacts to service_role;

-- ----------------------------------------------------------------------------
-- 6. create_cart_checkout(): + commission and delivery columns
-- ----------------------------------------------------------------------------
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
    payment_ref, payment_method, network, buyer_name, buyer_email, buyer_whatsapp, notes, delivery_address,
    lines, subtotal_usd, service_fee_usd, total_usd, fee_percent, fee_cap_ngn, fee_cap_usd,
    currency, amount_ngn, exchange_rate, status
  ) values (
    v_c.payment_ref, v_c.payment_method, v_c.network, v_c.buyer_name, v_c.buyer_email, v_c.buyer_whatsapp, v_c.notes, v_c.delivery_address,
    v_c.lines, v_c.subtotal_usd, v_c.service_fee_usd, v_c.total_usd, v_c.fee_percent, v_c.fee_cap_ngn, v_c.fee_cap_usd,
    v_c.currency, v_c.amount_ngn, v_c.exchange_rate, coalesce(v_c.status, 'paid')
  ) returning id into v_id;

  insert into catalogue_orders (
    item_id, seller_username, buyer_name, buyer_email, buyer_whatsapp, notes, delivery_address,
    amount_usd, unit_price_usd, quantity, commission_percent, commission_usd, seller_net_usd,
    payment_method, currency, exchange_rate, amount_ngn,
    payment_ref, tx_hash, status, buyer_token, created_at, checkout_id
  )
  select o.item_id, o.seller_username, o.buyer_name, o.buyer_email, o.buyer_whatsapp, o.notes, o.delivery_address,
         o.amount_usd, o.unit_price_usd, coalesce(o.quantity, 1), o.commission_percent, o.commission_usd, o.seller_net_usd,
         o.payment_method, o.currency, o.exchange_rate, o.amount_ngn,
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

-- Server-only functions.
revoke all on function create_cart_checkout(jsonb, jsonb) from public, anon, authenticated;
revoke all on function seller_earnings_summary(text) from public, anon, authenticated;
revoke all on function request_seller_withdrawal(uuid, numeric, text, text) from public, anon, authenticated;
revoke all on function request_participant_withdrawal(uuid, numeric, text, text) from public, anon, authenticated;
grant execute on function create_cart_checkout(jsonb, jsonb) to service_role;
grant execute on function seller_earnings_summary(text) to service_role;
grant execute on function request_seller_withdrawal(uuid, numeric, text, text) to service_role;
grant execute on function request_participant_withdrawal(uuid, numeric, text, text) to service_role;

-- ----------------------------------------------------------------------------
-- Verification - every row must be ok = true
-- ----------------------------------------------------------------------------
with checks(check_name, ok) as (
  select 'catalogue_orders.' || col,
    exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'catalogue_orders' and column_name = col)
    from unnest(array['commission_percent', 'commission_usd', 'seller_net_usd', 'delivery_address',
                      'buyer_confirmed_at', 'disputed_at', 'released_at']) as col
  union all select 'commission arithmetic constraint',
    exists (select 1 from pg_constraint where conname = 'catalogue_orders_commission_check')
  union all select 'catalogue_checkouts.delivery_address',
    exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'catalogue_checkouts' and column_name = 'delivery_address')
  union all select 'order events table + RLS',
    coalesce((select relrowsecurity from pg_class where oid = to_regclass('public.catalogue_order_events')), false)
  union all select 'order status triggers',
    (select count(*) = 2 from pg_trigger where tgname in ('catalogue_orders_track_status_ins', 'catalogue_orders_track_status_upd'))
  union all select 'participant_withdrawals.source',
    exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'participant_withdrawals' and column_name = 'source')
  union all select 'existing withdrawals are vote withdrawals',
    not exists (select 1 from participant_withdrawals where source is null)
  union all select 'vote withdrawal function counts only vote withdrawals',
    pg_get_functiondef(to_regprocedure('public.request_participant_withdrawal(uuid,numeric,text,text)')) ilike '%source = ''votes''%'
  union all select 'function seller_earnings_summary', to_regprocedure('public.seller_earnings_summary(text)') is not null
  union all select 'function request_seller_withdrawal', to_regprocedure('public.request_seller_withdrawal(uuid,numeric,text,text)') is not null
  union all select 'create_cart_checkout records commission',
    pg_get_functiondef(to_regprocedure('public.create_cart_checkout(jsonb,jsonb)')) ilike '%seller_net_usd%'
  union all select 'private contacts table + RLS',
    coalesce((select relrowsecurity from pg_class where oid = to_regclass('public.participant_private_contacts')), false)
  union all select 'anon cannot read private contacts',
    not has_table_privilege('anon', 'public.participant_private_contacts', 'select')
  union all select 'anon cannot request seller withdrawals',
    not has_function_privilege('anon', 'public.request_seller_withdrawal(uuid,numeric,text,text)', 'execute')
)
select * from checks;
