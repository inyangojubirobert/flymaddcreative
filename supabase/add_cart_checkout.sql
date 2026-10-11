-- ============================================================================
-- Multi-listing cart checkout + shared USDT consumption registry
-- ============================================================================
-- 1. catalogue_checkouts: one row per cart payment (Paystack or USDT),
--    recording the buyer service charge and totals. Each listing still becomes
--    its own catalogue_orders row so per-seller escrow
--    (pages/api/catalogue/order-action.js) is unchanged.
-- 2. usdt_payments.consumed_*: every USDT flow (votes, single-listing order,
--    cart) must claim a transaction through claim_usdt_payment() before
--    using it, so one on-chain transfer can pay for exactly one thing.
-- 3. create_cart_checkout(): claims the USDT tx (if any) and inserts the
--    checkout and ALL its orders in one transaction - all or nothing.
--
-- Additive: no existing column is changed or dropped. Existing data is only
-- touched by the usdt_payments backfill in section 2.
--
-- RUN THIS BEFORE DEPLOYING the matching API code. The cart routes refuse to
-- take payment until it is applied; the vote and single-listing routes log
-- loudly and fall back to their previous checks if it is missing.
--
-- Supabase's SQL editor may not apply a paste atomically - run the
-- verification query at the bottom and confirm every row is ok = true.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Cart checkouts
-- ----------------------------------------------------------------------------
create table if not exists catalogue_checkouts (
  id uuid primary key default gen_random_uuid(),
  payment_ref text not null unique,          -- Paystack reference or USDT tx hash
  payment_method text not null check (payment_method in ('paystack', 'usdt')),
  network text check (network is null or network in ('bsc', 'tron')),
  buyer_name text not null,
  buyer_email text not null,
  buyer_whatsapp text,
  notes text,
  lines jsonb not null check (jsonb_typeof(lines) = 'array' and jsonb_array_length(lines) between 1 and 20),
  subtotal_usd numeric(12,2) not null check (subtotal_usd > 0),
  service_fee_usd numeric(12,2) not null default 0 check (service_fee_usd >= 0),
  total_usd numeric(12,2) not null,
  fee_percent numeric,                       -- fee policy in force when charged
  fee_cap_ngn numeric,
  currency text not null check (currency in ('NGN', 'USD')),
  amount_ngn numeric(14,2),
  exchange_rate numeric,
  status text not null default 'paid',
  created_at timestamptz not null default now(),
  constraint catalogue_checkouts_total_check check (total_usd = subtotal_usd + service_fee_usd),
  constraint catalogue_checkouts_usdt_network check (payment_method <> 'usdt' or network is not null)
);

-- Server-only table: RLS on with no policies, AND no table privileges for the
-- client roles (RLS alone still lets those roles see the table exists and
-- would expose rows if a permissive policy were ever added by mistake).
alter table catalogue_checkouts enable row level security;
revoke all on table catalogue_checkouts from anon, authenticated, public;
grant all on table catalogue_checkouts to service_role;

alter table catalogue_orders add column if not exists checkout_id uuid references catalogue_checkouts(id);
alter table catalogue_orders add column if not exists quantity integer not null default 1;
alter table catalogue_orders add column if not exists unit_price_usd numeric;

create index if not exists catalogue_orders_checkout_id_idx on catalogue_orders (checkout_id);
-- One order per listing per checkout.
create unique index if not exists catalogue_orders_checkout_item_key
  on catalogue_orders (checkout_id, item_id) where checkout_id is not null;

-- ----------------------------------------------------------------------------
-- 2. USDT consumption registry
-- ----------------------------------------------------------------------------
alter table usdt_payments add column if not exists consumed_for text;
alter table usdt_payments add column if not exists consumed_ref text;
alter table usdt_payments add column if not exists consumed_at timestamptz;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'usdt_payments_consumed_for_check') then
    alter table usdt_payments add constraint usdt_payments_consumed_for_check
      check (consumed_for is null or consumed_for in ('votes', 'catalogue_order', 'catalogue_cart'));
  end if;
end $$;

-- Backfill existing usage so old transactions can't be replayed.
-- Votes first: a tx credited as votes stays a vote tx.
update usdt_payments
   set consumed_for = 'votes', consumed_ref = user_id::text, consumed_at = coalesce(verified_at, now())
 where consumed_for is null and status = 'confirmed' and user_id is not null;

update usdt_payments p
   set consumed_for = 'catalogue_order', consumed_ref = p.tx_hash, consumed_at = now()
 where p.consumed_for is null
   and exists (select 1 from catalogue_orders o where o.tx_hash = p.tx_hash or o.payment_ref = p.tx_hash);

-- Atomically claims a confirmed USDT payment for one purpose.
-- Returns: 'claimed' | 'already_claimed' (same purpose + ref, safe retry)
--        | 'taken' (used for something else) | 'not_confirmed' | 'not_found'
create or replace function claim_usdt_payment(p_tx_hash text, p_purpose text, p_ref text)
returns text
language plpgsql
set search_path = public
as $$
declare
  v_row usdt_payments%rowtype;
begin
  if p_purpose not in ('votes', 'catalogue_order', 'catalogue_cart') then
    raise exception 'invalid purpose %', p_purpose;
  end if;

  select * into v_row from usdt_payments where tx_hash = p_tx_hash for update;
  if not found then return 'not_found'; end if;
  if v_row.status <> 'confirmed' then return 'not_confirmed'; end if;

  if v_row.consumed_for is null then
    update usdt_payments
       set consumed_for = p_purpose, consumed_ref = p_ref, consumed_at = now()
     where tx_hash = p_tx_hash;
    return 'claimed';
  end if;

  if v_row.consumed_for = p_purpose and v_row.consumed_ref = p_ref then
    return 'already_claimed';
  end if;
  return 'taken';
end;
$$;

-- ----------------------------------------------------------------------------
-- 3. Atomic cart checkout
-- ----------------------------------------------------------------------------
-- p_checkout: one catalogue_checkouts row as JSON (no id/created_at)
-- p_orders:   array of catalogue_orders rows as JSON (no id/checkout_id)
-- Returns {checkout_id, created}. created = false means a checkout with this
-- payment_ref already existed (retry or race) and nothing was written.
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
    lines, subtotal_usd, service_fee_usd, total_usd, fee_percent, fee_cap_ngn,
    currency, amount_ngn, exchange_rate, status
  ) values (
    v_c.payment_ref, v_c.payment_method, v_c.network, v_c.buyer_name, v_c.buyer_email, v_c.buyer_whatsapp, v_c.notes,
    v_c.lines, v_c.subtotal_usd, v_c.service_fee_usd, v_c.total_usd, v_c.fee_percent, v_c.fee_cap_ngn,
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
    -- Concurrent request for the same payment won the race; everything in
    -- this call (including the USDT claim) is rolled back.
    select id into v_id from catalogue_checkouts where payment_ref = p_checkout->>'payment_ref';
    if v_id is null then raise; end if;
    return jsonb_build_object('checkout_id', v_id, 'created', false);
end;
$$;

-- Functions are executable by PUBLIC by default - server only.
revoke all on function claim_usdt_payment(text, text, text) from public, anon, authenticated;
revoke all on function create_cart_checkout(jsonb, jsonb) from public, anon, authenticated;
grant execute on function claim_usdt_payment(text, text, text) to service_role;
grant execute on function create_cart_checkout(jsonb, jsonb) to service_role;

-- ----------------------------------------------------------------------------
-- Verification - every row must be ok = true
-- ----------------------------------------------------------------------------
with checks(check_name, ok) as (
  select 'table catalogue_checkouts', to_regclass('public.catalogue_checkouts') is not null
  union all select 'catalogue_checkouts RLS on',
    coalesce((select relrowsecurity from pg_class where oid = to_regclass('public.catalogue_checkouts')), false)
  union all select 'catalogue_checkouts has no RLS policies',
    not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'catalogue_checkouts')
  union all select 'anon cannot read catalogue_checkouts',
    not has_table_privilege('anon', 'public.catalogue_checkouts', 'select')
  union all select 'authenticated cannot write catalogue_checkouts',
    not has_table_privilege('authenticated', 'public.catalogue_checkouts', 'insert')
  union all select 'payment_ref unique',
    exists (select 1 from pg_indexes where tablename = 'catalogue_checkouts' and indexdef ilike '%unique%(payment_ref)%')
  union all select 'total = subtotal + fee constraint',
    exists (select 1 from pg_constraint where conname = 'catalogue_checkouts_total_check')
  union all select 'catalogue_orders.' || col,
    exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'catalogue_orders' and column_name = col)
    from unnest(array['checkout_id', 'quantity', 'unit_price_usd']) as col
  union all select 'catalogue_orders.checkout_id foreign key',
    exists (select 1 from pg_constraint where conrelid = 'public.catalogue_orders'::regclass and contype = 'f'
            and confrelid = 'public.catalogue_checkouts'::regclass)
  union all select 'one order per listing per checkout index',
    exists (select 1 from pg_indexes where indexname = 'catalogue_orders_checkout_item_key')
  union all select 'catalogue_orders.payment_ref unique (pre-existing)',
    exists (select 1 from pg_indexes where indexname = 'catalogue_orders_payment_ref_key')
  union all select 'usdt_payments.' || col,
    exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'usdt_payments' and column_name = col)
    from unnest(array['consumed_for', 'consumed_ref', 'consumed_at']) as col
  union all select 'usdt_payments.tx_hash unique (pre-existing)',
    exists (select 1 from pg_indexes where tablename = 'usdt_payments' and indexdef ilike '%unique%(tx_hash)%')
  union all select 'function claim_usdt_payment', to_regprocedure('public.claim_usdt_payment(text,text,text)') is not null
  union all select 'function create_cart_checkout', to_regprocedure('public.create_cart_checkout(jsonb,jsonb)') is not null
  union all select 'anon cannot execute create_cart_checkout',
    not has_function_privilege('anon', 'public.create_cart_checkout(jsonb,jsonb)', 'execute')
  union all select 'authenticated cannot execute claim_usdt_payment',
    not has_function_privilege('authenticated', 'public.claim_usdt_payment(text,text,text)', 'execute')
  union all select 'no confirmed vote tx also used for a catalogue order (past replays)',
    not exists (select 1 from usdt_payments p join catalogue_orders o on o.tx_hash = p.tx_hash
                where p.user_id is not null and p.status = 'confirmed')
)
select * from checks;
-- If the last check is false, a transaction was used for votes AND a
-- marketplace order before this fix. List them with:
--   select p.tx_hash, p.user_id, p.amount, o.id as order_id, o.amount_usd
--     from usdt_payments p join catalogue_orders o on o.tx_hash = p.tx_hash
--    where p.user_id is not null and p.status = 'confirmed';
