-- ============================================================================
-- Dream Coin gift revenue sharing (owner decision, 17 October 2026)
-- ============================================================================
-- Additive. Run after add_dream_coins_gifting.sql and add_earnings_and_payouts.sql.
--
-- When PURCHASED Dream Coins are spent on a gift, the value of those coins is
-- shared: 50% to the recipient, 10% to the merchant who referred the
-- recipient (for 12 months from the recipient's registration), and the rest
-- (40%, or 50% with no eligible merchant) stays with One Dream.
--
--   coin_lots                  every coin credit is a lot: purchase, test purchase,
--                              admin adjustment or legacy balance. Only real
--                              purchases carry monetary value.
--   gift_lot_allocations       which lots paid for each gift (oldest first)
--   gift_earnings              one per gift: split, merchant and entitlement snapshot
--   gift_earning_components    one per gift x lot: provisional and final value, shares
--   play_settlement_batches    one imported Google Play earnings report
--   play_settlement_lines      its rows (charges, Google fees, taxes, refunds)
--
-- Valuation: a lot's value is what Google pays One Dream for it.
--   provisional  = configured Play price (dream_coin_packages.reference_price_usd,
--                  checked against Play Console by the admin billing check)
--                  x quantity, less the provisional fee estimate in settings
--   final        = charge + Google fee + tax for that order in the imported
--                  earnings report (refund lines are excluded here because
--                  refunds reverse the gifts they funded separately)
-- With gift_value_basis = 'gross', the price before Google's fee is used.
--
-- Withdrawable: a lot's earnings become available only when the admin marks
-- the earnings report batch that contains its charge as paid out by Google
-- (funds actually received). There is no fixed holding period.
--
-- Coin balances and the coin ledger keep working exactly as before; the
-- functions replaced below add lot bookkeeping and earnings around them and
-- keep the same signatures. Nothing is recorded as money while
-- earnings_settings.gift_earnings_enabled is false.
-- ============================================================================

do $$
begin
  if to_regclass('public.earnings_settings') is null or to_regclass('public.dream_coin_purchases') is null then
    raise exception 'Run add_dream_coins_gifting.sql and add_earnings_and_payouts.sql first';
  end if;
end $$;

-- ----------------------------------------------------------------------------
-- Settlement reports (Google Play earnings report imports)
-- ----------------------------------------------------------------------------
create table if not exists play_settlement_batches (
  id uuid primary key default gen_random_uuid(),
  report_month text not null check (report_month ~ '^[0-9]{4}-[0-9]{2}$'),
  source_name text,
  rows_imported integer not null default 0,
  merchant_currency text not null default 'USD',
  imported_by uuid,
  imported_at timestamptz not null default now(),
  funds_available_at timestamptz,          -- Google's payout for this report has reached One Dream
  payout_reference text,
  marked_by uuid
);

create table if not exists play_settlement_lines (
  id bigint generated always as identity primary key,
  batch_id uuid not null references play_settlement_batches(id),
  line_hash text not null unique,          -- re-importing the same report adds nothing
  order_id text not null,
  product_id text,
  transaction_type text not null,
  amount_micro bigint not null,            -- merchant currency millionths (USD)
  buyer_country text,
  transaction_date date,
  raw jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index if not exists play_settlement_lines_order on play_settlement_lines (order_id);

-- ----------------------------------------------------------------------------
-- Coin lots
-- ----------------------------------------------------------------------------
create table if not exists coin_lots (
  id uuid primary key default gen_random_uuid(),
  participant_id uuid not null references participants(id),
  source text not null check (source in ('purchase', 'test_purchase', 'admin_adjustment', 'legacy')),
  purchase_id uuid unique references dream_coin_purchases(id),
  order_id text,
  buyer_region text,
  coins_total integer not null check (coins_total > 0),
  coins_remaining integer not null check (coins_remaining >= 0),
  coins_refunded integer not null default 0 check (coins_refunded >= 0),
  coins_debt_repaid integer not null default 0 check (coins_debt_repaid >= 0),
  earning boolean not null,                -- only real purchases carry money
  gross_micro bigint,                      -- configured Play price x quantity (USD)
  provisional_net_micro bigint,
  provisional_fee_percent numeric(5,2),
  settled_charge_micro bigint,
  settled_fee_micro bigint,
  settled_tax_micro bigint,
  settled_refund_micro bigint,
  settled_net_micro bigint,                -- charge + fee + tax (refunds excluded, see header)
  settlement_status text not null default 'unreported' check (settlement_status in ('unreported', 'reported', 'funds_available', 'not_applicable')),
  settlement_batch_id uuid references play_settlement_batches(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint coin_lots_coins check (coins_remaining + coins_debt_repaid <= coins_total),
  constraint coin_lots_money check (not earning or gross_micro is not null)
);
create index if not exists coin_lots_open on coin_lots (participant_id, created_at, id) where coins_remaining > 0;
create index if not exists coin_lots_order on coin_lots (order_id);

create table if not exists gift_lot_allocations (
  gift_transaction_id uuid not null references virtual_gift_transactions(id),
  lot_id uuid not null references coin_lots(id),
  coins integer not null check (coins > 0),
  coins_reversed integer not null default 0,
  created_at timestamptz not null default now(),
  primary key (gift_transaction_id, lot_id),
  constraint gift_lot_allocations_reversed check (coins_reversed between 0 and coins)
);
create index if not exists gift_lot_allocations_lot on gift_lot_allocations (lot_id, created_at desc);

create table if not exists gift_earnings (
  gift_transaction_id uuid primary key references virtual_gift_transactions(id),
  sender_id uuid not null references participants(id),
  recipient_id uuid not null references participants(id),
  merchant_id uuid references referral_merchants(id),
  merchant_entitled_until timestamptz,     -- recipient registration + N months (snapshot)
  merchant_excluded_reason text,           -- why an otherwise-referring merchant earns nothing
  value_basis text not null check (value_basis in ('net', 'gross')),
  recipient_percent numeric(5,2) not null,
  merchant_percent numeric(5,2) not null,  -- 0 when no eligible merchant
  status text not null default 'active' check (status in ('active', 'partially_reversed', 'reversed')),
  created_at timestamptz not null default now()
);
create index if not exists gift_earnings_recipient on gift_earnings (recipient_id, created_at desc);
create index if not exists gift_earnings_merchant on gift_earnings (merchant_id, created_at desc) where merchant_id is not null;

create table if not exists gift_earning_components (
  gift_transaction_id uuid not null references gift_earnings(gift_transaction_id),
  lot_id uuid not null references coin_lots(id),
  coins integer not null check (coins > 0),
  provisional_value_micro bigint not null check (provisional_value_micro >= 0),  -- immutable
  final_value_micro bigint check (final_value_micro is null or final_value_micro >= 0), -- set once, at reconciliation
  recipient_micro bigint not null,         -- current shares (final when reconciled)
  merchant_micro bigint not null,
  platform_micro bigint not null,
  reversed_coins integer not null default 0,
  reversed_recipient_micro bigint not null default 0,
  reversed_merchant_micro bigint not null default 0,
  released boolean not null default false,
  released_at timestamptz,
  reconciled_at timestamptz,
  primary key (gift_transaction_id, lot_id),
  constraint gift_earning_components_reversed check (reversed_coins between 0 and coins)
);
create index if not exists gift_earning_components_lot on gift_earning_components (lot_id);

-- Legacy coins (credited before lots existed) never carry money.
insert into coin_lots (participant_id, source, coins_total, coins_remaining, earning, settlement_status)
select b.participant_id, 'legacy', b.balance, b.balance, false, 'not_applicable'
  from dream_coin_balances b
 where b.balance > 0
   and not exists (select 1 from coin_lots l where l.participant_id = b.participant_id);

-- ----------------------------------------------------------------------------
-- Helpers
-- ----------------------------------------------------------------------------

/** The lot's value base for a gift: final if reconciled, else provisional. */
create or replace function coin_lot_value_base(l coin_lots, p_basis text)
returns bigint
language sql
immutable
as $$
  select case
    when not l.earning then 0
    when p_basis = 'gross' then coalesce(l.settled_charge_micro, l.gross_micro, 0)
    else greatest(coalesce(l.settled_net_micro, l.provisional_net_micro, 0), 0)
  end;
$$;

/** Splits a value: recipient and merchant are rounded down; the remainder stays with the platform. */
create or replace function gift_split(p_value bigint, p_recipient_pct numeric, p_merchant_pct numeric,
  out recipient_micro bigint, out merchant_micro bigint, out platform_micro bigint)
language sql
immutable
as $$
  select floor(p_value * p_recipient_pct / 100)::bigint,
         floor(p_value * p_merchant_pct / 100)::bigint,
         p_value - floor(p_value * p_recipient_pct / 100)::bigint - floor(p_value * p_merchant_pct / 100)::bigint;
$$;

/** Posts one party's share of a component to its current bucket. */
create or replace function gift_component_post(
  p_gift uuid, p_lot uuid, p_party_type text, p_party_id uuid, p_source text, p_amount bigint,
  p_released boolean, p_entry text, p_key text, p_note text default null)
returns void
language plpgsql
set search_path = public
as $$
begin
  perform partner_ledger_post(p_party_type, p_party_id, p_source, case when p_released then 'available' else 'pending' end,
                              p_amount, p_entry, 'gift_component', p_gift || ':' || p_lot, p_key, p_note);
end;
$$;

/**
 * Takes coins from a participant's open lots, oldest first. Returns the lots
 * and coins taken (jsonb array). Coins not covered by any lot are simply not
 * allocated (they cannot carry money).
 */
create or replace function coin_lots_take(p_participant uuid, p_coins integer)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  l coin_lots%rowtype;
  need integer := p_coins;
  take integer;
  taken jsonb := '[]'::jsonb;
begin
  for l in select * from coin_lots where participant_id = p_participant and coins_remaining > 0
            order by created_at, id for update loop
    exit when need <= 0;
    take := least(need, l.coins_remaining);
    update coin_lots set coins_remaining = coins_remaining - take, updated_at = now() where id = l.id;
    taken := taken || jsonb_build_object('lot_id', l.id, 'coins', take);
    need := need - take;
  end loop;
  return taken;
end;
$$;

/** Records allocations and, when switched on, the gift's monetary earnings. */
create or replace function gift_record_earnings(p_gift uuid)
returns void
language plpgsql
set search_path = public
as $$
declare
  t virtual_gift_transactions%rowtype;
  s earnings_settings%rowtype;
  taken jsonb;
  item jsonb;
  l coin_lots%rowtype;
  v_merchant uuid;
  v_until timestamptz;
  v_excluded text;
  v_registered timestamptz;
  v_merchant_pct numeric(5,2);
  v_value bigint;
  sh record;
  any_earning boolean := false;
begin
  select * into t from virtual_gift_transactions where id = p_gift;
  select * into s from earnings_settings where id;

  taken := coin_lots_take(t.sender_id, t.coins_spent);
  for item in select * from jsonb_array_elements(taken) loop
    insert into gift_lot_allocations (gift_transaction_id, lot_id, coins)
    values (p_gift, (item->>'lot_id')::uuid, (item->>'coins')::integer);
    if exists (select 1 from coin_lots where id = (item->>'lot_id')::uuid and earning) then any_earning := true; end if;
  end loop;

  if not s.gift_earnings_enabled or not any_earning then return; end if;

  -- The merchant who referred the RECIPIENT, for N months from registration.
  select p.created_at, ml.merchant_id into v_registered, v_merchant
    from participants p left join merchant_referral_links ml on ml.id = p.referred_by_merchant_link_id
   where p.id = t.recipient_id;
  if v_merchant is not null then
    v_until := v_registered + make_interval(months => s.gift_merchant_months);
    if t.created_at >= v_until then v_excluded := 'entitlement_expired';
    elsif exists (select 1 from merchant_participant_links mpl
                   where mpl.merchant_id = v_merchant and mpl.participant_id in (t.sender_id, t.recipient_id)) then
      v_excluded := 'merchant_is_party_to_gift';
    elsif exists (select 1 from referral_merchants rm join participants sp on sp.id = t.sender_id
                   where rm.id = v_merchant and lower(rm.email) = lower(sp.email)) then
      v_excluded := 'merchant_is_sender';
    end if;
  end if;
  v_merchant_pct := case when v_merchant is not null and v_excluded is null then s.gift_merchant_percent else 0 end;

  insert into gift_earnings (gift_transaction_id, sender_id, recipient_id, merchant_id, merchant_entitled_until,
                             merchant_excluded_reason, value_basis, recipient_percent, merchant_percent)
  values (p_gift, t.sender_id, t.recipient_id, case when v_excluded is null then v_merchant end, v_until,
          v_excluded, s.gift_value_basis, s.gift_recipient_percent, v_merchant_pct);

  for item in select * from jsonb_array_elements(taken) loop
    select * into l from coin_lots where id = (item->>'lot_id')::uuid;
    continue when not l.earning;
    v_value := floor(coin_lot_value_base(l, s.gift_value_basis)::numeric * (item->>'coins')::integer / l.coins_total)::bigint;
    select * into sh from gift_split(v_value, s.gift_recipient_percent, v_merchant_pct);
    insert into gift_earning_components (gift_transaction_id, lot_id, coins, provisional_value_micro, final_value_micro,
      recipient_micro, merchant_micro, platform_micro, released, released_at, reconciled_at)
    values (p_gift, l.id, (item->>'coins')::integer, v_value,
            case when l.settlement_status in ('reported', 'funds_available') then v_value end,
            sh.recipient_micro, sh.merchant_micro, sh.platform_micro,
            l.settlement_status = 'funds_available', case when l.settlement_status = 'funds_available' then now() end,
            case when l.settlement_status in ('reported', 'funds_available') then now() end);
    perform gift_component_post(p_gift, l.id, 'participant', t.recipient_id, 'gift_recipient', sh.recipient_micro,
                                l.settlement_status = 'funds_available', 'accrue', 'gift:' || p_gift || ':' || l.id || ':recipient:accrue');
    if v_merchant_pct > 0 then
      perform gift_component_post(p_gift, l.id, 'merchant', v_merchant, 'gift_referral', sh.merchant_micro,
                                  l.settlement_status = 'funds_available', 'accrue', 'gift:' || p_gift || ':' || l.id || ':merchant:accrue');
    end if;
  end loop;
end;
$$;

/**
 * Reverses `p_coins` of one component (refund or admin reversal). The share
 * reversed is proportional; the last coins take any rounding remainder.
 */
create or replace function gift_component_reverse(p_gift uuid, p_lot uuid, p_coins integer, p_key text, p_reason text)
returns void
language plpgsql
set search_path = public
as $$
declare
  c gift_earning_components%rowtype;
  g gift_earnings%rowtype;
  new_reversed integer;
  target_r bigint;
  target_m bigint;
  delta_r bigint;
  delta_m bigint;
begin
  select * into c from gift_earning_components where gift_transaction_id = p_gift and lot_id = p_lot for update;
  if not found then return; end if;
  select * into g from gift_earnings where gift_transaction_id = p_gift;
  new_reversed := least(c.coins, c.reversed_coins + p_coins);
  if new_reversed = c.reversed_coins then return; end if;

  if new_reversed = c.coins then
    target_r := c.recipient_micro; target_m := c.merchant_micro;
  else
    target_r := floor(c.recipient_micro::numeric * new_reversed / c.coins)::bigint;
    target_m := floor(c.merchant_micro::numeric * new_reversed / c.coins)::bigint;
  end if;
  delta_r := target_r - c.reversed_recipient_micro;
  delta_m := target_m - c.reversed_merchant_micro;

  update gift_earning_components
     set reversed_coins = new_reversed, reversed_recipient_micro = target_r, reversed_merchant_micro = target_m
   where gift_transaction_id = p_gift and lot_id = p_lot;

  -- From available if already released (it may go negative after a payout: recoverable debt).
  perform gift_component_post(p_gift, p_lot, 'participant', g.recipient_id, 'gift_recipient', -delta_r, c.released, 'reverse',
                              p_key || ':recipient', p_reason);
  if g.merchant_id is not null then
    perform gift_component_post(p_gift, p_lot, 'merchant', g.merchant_id, 'gift_referral', -delta_m, c.released, 'reverse',
                                p_key || ':merchant', p_reason);
  end if;

  update gift_earnings ge
     set status = case when not exists (select 1 from gift_earning_components x
                                         where x.gift_transaction_id = p_gift and x.reversed_coins < x.coins)
                       then 'reversed' else 'partially_reversed' end
   where ge.gift_transaction_id = p_gift;
end;
$$;

-- ----------------------------------------------------------------------------
-- Replaced Dream Coins functions (same signatures as add_dream_coins_gifting.sql)
-- ----------------------------------------------------------------------------
create or replace function dream_coins_credit_purchase(
  p_participant_id uuid, p_package_id text, p_product_id text, p_purchase_token text,
  p_order_id text, p_quantity integer, p_is_test boolean, p_purchased_at timestamptz)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  pkg dream_coin_packages%rowtype;
  existing dream_coin_purchases%rowtype;
  s earnings_settings%rowtype;
  new_id uuid;
  total integer;
  new_balance integer;
  debt integer;
  gross bigint;
begin
  select * into existing from dream_coin_purchases where purchase_token = p_purchase_token;
  if found then
    if existing.participant_id <> p_participant_id then raise exception 'purchase_owned_by_other_account'; end if;
    return jsonb_build_object('purchase_id', existing.id, 'already_credited', true, 'quantity', existing.quantity,
      'coins_per_unit', existing.coins_per_unit, 'total_coins', existing.total_coins, 'consumption_state', existing.consumption_state,
      'balance', (select balance from dream_coin_balances where participant_id = p_participant_id));
  end if;

  select * into pkg from dream_coin_packages where id = p_package_id;
  if not found then raise exception 'unknown_package'; end if;
  if pkg.google_play_product_id <> p_product_id then raise exception 'product_mismatch'; end if;
  if p_quantity is null or p_quantity < 1 or p_quantity > 1000 then raise exception 'invalid_quantity'; end if;
  total := p_quantity * pkg.coins_per_unit;

  insert into dream_coin_purchases (participant_id, package_id, product_id, purchase_token, order_id, quantity,
                                    coins_per_unit, total_coins, is_test, purchased_at)
  values (p_participant_id, pkg.id, p_product_id, p_purchase_token, p_order_id, p_quantity,
          pkg.coins_per_unit, total, coalesce(p_is_test, false), p_purchased_at)
  on conflict (purchase_token) do nothing
  returning id into new_id;

  if new_id is null then
    return dream_coins_credit_purchase(p_participant_id, p_package_id, p_product_id, p_purchase_token,
                                       p_order_id, p_quantity, p_is_test, p_purchased_at);
  end if;

  insert into dream_coin_balances as b (participant_id, balance, lifetime_purchased)
  values (p_participant_id, total, total)
  on conflict (participant_id) do update
    set balance = b.balance + excluded.balance,
        lifetime_purchased = b.lifetime_purchased + excluded.lifetime_purchased,
        updated_at = now()
  returning balance into new_balance;

  insert into dream_coin_ledger (participant_id, entry_type, coins, balance_after, purchase_id, idempotency_key, note)
  values (p_participant_id, 'purchase_credit', total, new_balance, new_id, 'purchase:' || new_id,
          format('%s x %s (%s coins each)', p_quantity, pkg.id, pkg.coins_per_unit));

  -- Lot: coins that repay a refund debt are not spendable lot coins.
  select * into s from earnings_settings where id;
  debt := greatest(0, -(new_balance - total));
  gross := case when pkg.reference_price_usd is null then null else round(pkg.reference_price_usd * 1000000)::bigint * p_quantity end;
  insert into coin_lots (participant_id, source, purchase_id, order_id, coins_total, coins_remaining, coins_debt_repaid,
                         earning, gross_micro, provisional_net_micro, provisional_fee_percent, settlement_status)
  values (p_participant_id, case when coalesce(p_is_test, false) then 'test_purchase' else 'purchase' end, new_id, p_order_id,
          total, total - least(total, debt), least(total, debt),
          not coalesce(p_is_test, false) and gross is not null, gross,
          case when gross is null then null else floor(gross * (100 - s.gift_provisional_fee_percent) / 100)::bigint end,
          s.gift_provisional_fee_percent,
          case when coalesce(p_is_test, false) or gross is null then 'not_applicable' else 'unreported' end);

  return jsonb_build_object('purchase_id', new_id, 'already_credited', false, 'quantity', p_quantity,
    'coins_per_unit', pkg.coins_per_unit, 'total_coins', total, 'consumption_state', 'pending', 'balance', new_balance);
end;
$$;

/** Optional details from Google's purchase record (billing region). */
create or replace function coin_lot_set_region(p_purchase_id uuid, p_region text)
returns void
language sql
set search_path = public
as $$
  update coin_lots set buyer_region = upper(left(p_region, 2)), updated_at = now()
   where purchase_id = p_purchase_id and buyer_region is null and p_region ~ '^[A-Za-z]{2}$';
$$;

create or replace function dream_coins_reverse_purchase(p_purchase_token text, p_quantity integer, p_event_key text, p_reason text)
returns integer
language plpgsql
set search_path = public
as $$
declare
  p dream_coin_purchases%rowtype;
  l coin_lots%rowtype;
  a record;
  qty integer;
  coins integer;
  from_unspent integer;
  leftover integer;
  r integer;
  new_balance integer;
  key text := 'reversal:' || md5(p_purchase_token) || ':' || coalesce(p_event_key, '');
begin
  select * into p from dream_coin_purchases where purchase_token = p_purchase_token for update;
  if not found then return 0; end if;
  if exists (select 1 from dream_coin_ledger where idempotency_key = key) then return 0; end if;

  qty := p.quantity - p.reversed_quantity;
  if p_quantity is not null then qty := least(greatest(p_quantity, 0), qty); end if;
  if qty <= 0 then return 0; end if;
  coins := qty * p.coins_per_unit;

  update dream_coin_purchases
     set reversed_quantity = reversed_quantity + qty,
         status = case when reversed_quantity + qty = quantity then 'reversed' else 'partially_reversed' end,
         updated_at = now()
   where id = p.id;

  update dream_coin_balances set balance = balance - coins, updated_at = now()
   where participant_id = p.participant_id
  returning balance into new_balance;

  insert into dream_coin_ledger (participant_id, entry_type, coins, balance_after, purchase_id, idempotency_key, note)
  values (p.participant_id, 'purchase_reversal', -coins, new_balance, p.id, key,
          left(format('%s of %s unit(s) reversed: %s', qty, p.quantity, coalesce(p_reason, 'refund')), 500));

  -- Lot: unspent coins go first; coins already spent reverse the earnings of
  -- the gifts this lot paid for, most recent gift first.
  select * into l from coin_lots where purchase_id = p.id for update;
  if found then
    from_unspent := least(l.coins_remaining, coins);
    leftover := coins - from_unspent;
    update coin_lots set coins_remaining = coins_remaining - from_unspent, coins_refunded = coins_refunded + coins, updated_at = now()
     where id = l.id;
    for a in select gla.* from gift_lot_allocations gla where gla.lot_id = l.id and gla.coins_reversed < gla.coins
              order by gla.created_at desc, gla.gift_transaction_id desc for update loop
      exit when leftover <= 0;
      r := least(leftover, a.coins - a.coins_reversed);
      update gift_lot_allocations set coins_reversed = coins_reversed + r
       where gift_transaction_id = a.gift_transaction_id and lot_id = a.lot_id;
      perform gift_component_reverse(a.gift_transaction_id, l.id, r, key || ':' || a.gift_transaction_id,
                                     coalesce(p_reason, 'Google Play refund'));
      leftover := leftover - r;
    end loop;
  end if;
  return coins;
end;
$$;

create or replace function virtual_gift_send(
  p_sender_id uuid, p_recipient_id uuid, p_gift_id text, p_quantity integer, p_client_request_id text,
  p_context_type text, p_context_ref text, p_verified_buyer boolean, p_message text, p_is_anonymous boolean,
  p_max_gifts_per_hour integer, p_max_coins_per_day integer)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  g virtual_gift_catalogue%rowtype;
  b dream_coin_balances%rowtype;
  existing virtual_gift_transactions%rowtype;
  cost integer;
  new_id uuid;
  new_balance integer;
begin
  if p_sender_id = p_recipient_id then raise exception 'self_gifting'; end if;
  if p_quantity is null or p_quantity < 1 or p_quantity > 99 then raise exception 'invalid_quantity'; end if;

  select * into b from dream_coin_balances where participant_id = p_sender_id for update;
  if not found then raise exception 'insufficient_coins'; end if;

  select * into existing from virtual_gift_transactions where sender_id = p_sender_id and client_request_id = p_client_request_id;
  if found then
    return jsonb_build_object('gift_transaction_id', existing.id, 'already_sent', true, 'coins_spent', existing.coins_spent, 'balance', b.balance);
  end if;

  if b.gifting_suspended then raise exception 'account_suspended'; end if;
  select * into g from virtual_gift_catalogue where id = p_gift_id and is_active;
  if not found then raise exception 'gift_unavailable'; end if;
  cost := p_quantity * g.coin_cost;

  if (select count(*) from virtual_gift_transactions
       where sender_id = p_sender_id and created_at > now() - interval '1 hour') >= p_max_gifts_per_hour then
    raise exception 'rate_limited';
  end if;
  if coalesce((select sum(coins_spent) from virtual_gift_transactions
       where sender_id = p_sender_id and status = 'sent' and created_at > now() - interval '24 hours'), 0) + cost > p_max_coins_per_day then
    raise exception 'daily_limit';
  end if;
  if b.balance < cost then raise exception 'insufficient_coins'; end if;

  insert into virtual_gift_transactions (sender_id, recipient_id, gift_id, gift_snapshot, quantity, unit_cost, coins_spent,
    recognition_points, context_type, context_ref, verified_buyer, message, is_anonymous, client_request_id)
  values (p_sender_id, p_recipient_id, g.id,
    jsonb_build_object('name', g.name, 'emoji', g.emoji, 'image_url', g.image_url, 'coin_cost', g.coin_cost, 'category', g.category),
    p_quantity, g.coin_cost, cost, cost, coalesce(p_context_type, 'profile'), p_context_ref, coalesce(p_verified_buyer, false),
    nullif(btrim(coalesce(p_message, '')), ''), coalesce(p_is_anonymous, false), p_client_request_id)
  returning id into new_id;

  update dream_coin_balances set balance = balance - cost, lifetime_spent = lifetime_spent + cost, updated_at = now()
   where participant_id = p_sender_id
  returning balance into new_balance;

  insert into dream_coin_ledger (participant_id, entry_type, coins, balance_after, gift_transaction_id, idempotency_key, note)
  values (p_sender_id, 'gift_debit', -cost, new_balance, new_id, 'gift:' || new_id, format('%s x %s', p_quantity, g.id));

  perform gift_record_earnings(new_id);

  return jsonb_build_object('gift_transaction_id', new_id, 'already_sent', false, 'coins_spent', cost, 'balance', new_balance);
end;
$$;

create or replace function virtual_gift_reverse(p_gift_transaction_id uuid, p_admin_id uuid, p_reason text)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  t virtual_gift_transactions%rowtype;
  a record;
  new_balance integer;
begin
  select * into t from virtual_gift_transactions where id = p_gift_transaction_id for update;
  if not found then raise exception 'gift_not_found'; end if;
  if t.status = 'reversed' then return jsonb_build_object('already_reversed', true); end if;

  update virtual_gift_transactions set status = 'reversed' where id = t.id;
  insert into virtual_gift_refunds (gift_transaction_id, coins_returned, reason, admin_id) values (t.id, t.coins_spent, p_reason, p_admin_id);
  update dream_coin_balances set balance = balance + t.coins_spent, lifetime_spent = lifetime_spent - t.coins_spent, updated_at = now()
   where participant_id = t.sender_id
  returning balance into new_balance;
  insert into dream_coin_ledger (participant_id, entry_type, coins, balance_after, gift_transaction_id, idempotency_key, note, admin_id)
  values (t.sender_id, 'gift_reversal_credit', t.coins_spent, new_balance, t.id, 'gift-reversal:' || t.id, left(p_reason, 500), p_admin_id);

  -- Coins go back to the lots they came from; the gift's earnings are reversed.
  for a in select * from gift_lot_allocations where gift_transaction_id = t.id and coins_reversed < coins for update loop
    update coin_lots set coins_remaining = coins_remaining + (a.coins - a.coins_reversed), updated_at = now()
     where id = a.lot_id and coins_refunded = 0;
    perform gift_component_reverse(t.id, a.lot_id, a.coins - a.coins_reversed, 'gift-reversal:' || t.id || ':' || a.lot_id, p_reason);
    update gift_lot_allocations set coins_reversed = coins where gift_transaction_id = t.id and lot_id = a.lot_id;
  end loop;

  insert into dream_gifting_admin_audit (admin_id, action, target_type, target_id, details)
  values (p_admin_id, 'reverse_gift', 'gift', t.id::text, jsonb_build_object('reason', p_reason, 'coins_returned', t.coins_spent));
  return jsonb_build_object('already_reversed', false, 'coins_returned', t.coins_spent, 'sender_balance', new_balance);
end;
$$;

create or replace function dream_coins_admin_adjust(p_participant_id uuid, p_coins integer, p_reason text, p_admin_id uuid, p_request_key text)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  key text := 'admin:' || p_request_key;
  new_balance integer;
begin
  if p_coins is null or p_coins = 0 or abs(p_coins) > 1000000 then raise exception 'invalid_amount'; end if;
  if exists (select 1 from dream_coin_ledger where idempotency_key = key) then
    return jsonb_build_object('already_applied', true);
  end if;
  insert into dream_coin_balances as b (participant_id, balance) values (p_participant_id, p_coins)
  on conflict (participant_id) do update set balance = b.balance + excluded.balance, updated_at = now()
  returning balance into new_balance;
  insert into dream_coin_ledger (participant_id, entry_type, coins, balance_after, idempotency_key, note, admin_id)
  values (p_participant_id, 'admin_adjustment', p_coins, new_balance, key, left(p_reason, 500), p_admin_id);
  insert into dream_gifting_admin_audit (admin_id, action, target_type, target_id, details)
  values (p_admin_id, 'adjust_coins', 'participant', p_participant_id::text, jsonb_build_object('coins', p_coins, 'reason', p_reason));

  -- Admin coins never carry money; a negative adjustment removes unspent coins.
  if p_coins > 0 then
    insert into coin_lots (participant_id, source, coins_total, coins_remaining, earning, settlement_status)
    values (p_participant_id, 'admin_adjustment', p_coins, p_coins, false, 'not_applicable');
  else
    perform coin_lots_take(p_participant_id, -p_coins);
  end if;
  return jsonb_build_object('already_applied', false, 'balance', new_balance);
end;
$$;

-- ----------------------------------------------------------------------------
-- Settlement: import, reconcile, release
-- ----------------------------------------------------------------------------

/**
 * Imports parsed earnings-report rows (jsonb array of
 * {line_hash, order_id, product_id, transaction_type, amount_micro, buyer_country, transaction_date, raw})
 * into a new batch, then reconciles every coin lot those orders belong to.
 */
create or replace function play_settlement_import(p_report_month text, p_source_name text, p_rows jsonb, p_admin uuid)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  batch uuid;
  r jsonb;
  inserted integer := 0;
  orders text[];
  reconciled integer;
begin
  insert into play_settlement_batches (report_month, source_name, imported_by)
  values (p_report_month, left(p_source_name, 200), p_admin) returning id into batch;

  for r in select * from jsonb_array_elements(p_rows) loop
    insert into play_settlement_lines (batch_id, line_hash, order_id, product_id, transaction_type, amount_micro,
                                       buyer_country, transaction_date, raw)
    values (batch, r->>'line_hash', r->>'order_id', r->>'product_id', r->>'transaction_type', (r->>'amount_micro')::bigint,
            r->>'buyer_country', nullif(r->>'transaction_date', '')::date, coalesce(r->'raw', '{}'::jsonb))
    on conflict (line_hash) do nothing;
    if found then inserted := inserted + 1; end if;
  end loop;
  update play_settlement_batches set rows_imported = inserted where id = batch;

  select array_agg(distinct order_id) into orders from play_settlement_lines where batch_id = batch;
  reconciled := coin_lots_reconcile(coalesce(orders, '{}'), batch);
  insert into earnings_admin_audit (admin_id, action, target_type, target_id, details)
  values (coalesce(p_admin, '00000000-0000-0000-0000-000000000000'), 'import_play_report', 'settlement_batch', batch::text,
          jsonb_build_object('month', p_report_month, 'rows', inserted, 'lots_reconciled', reconciled));
  return jsonb_build_object('batch_id', batch, 'rows_imported', inserted, 'lots_reconciled', reconciled);
end;
$$;

/** Recomputes settled amounts for the lots of these orders and re-values their gift components. */
create or replace function coin_lots_reconcile(p_orders text[], p_batch uuid)
returns integer
language plpgsql
set search_path = public
as $$
declare
  l coin_lots%rowtype;
  c record;
  sums record;
  charge_batch uuid;
  n integer := 0;
  v_value bigint;
  sh record;
  g gift_earnings%rowtype;
begin
  for l in select * from coin_lots where order_id = any(p_orders) and earning for update loop
    select coalesce(sum(amount_micro) filter (where transaction_type ilike 'charge'), 0) as charge,
           coalesce(sum(amount_micro) filter (where transaction_type ilike 'google fee'), 0) as fee,
           coalesce(sum(amount_micro) filter (where transaction_type ilike 'tax'), 0) as tax,
           coalesce(sum(amount_micro) filter (where transaction_type ilike '%refund%'), 0) as refund
      into sums from play_settlement_lines where order_id = l.order_id;
    select batch_id into charge_batch from play_settlement_lines
     where order_id = l.order_id and transaction_type ilike 'charge' order by id limit 1;
    continue when charge_batch is null;   -- only refunds reported so far: nothing to value yet

    update coin_lots
       set settled_charge_micro = sums.charge, settled_fee_micro = sums.fee, settled_tax_micro = sums.tax,
           settled_refund_micro = sums.refund, settled_net_micro = sums.charge + sums.fee + sums.tax,
           settlement_batch_id = charge_batch,
           settlement_status = case when settlement_status = 'funds_available' then 'funds_available' else 'reported' end,
           updated_at = now()
     where id = l.id
    returning * into l;
    n := n + 1;

    for c in select * from gift_earning_components where lot_id = l.id for update loop
      select * into g from gift_earnings where gift_transaction_id = c.gift_transaction_id;
      v_value := floor(coin_lot_value_base(l, g.value_basis)::numeric * c.coins / l.coins_total)::bigint;
      continue when c.final_value_micro is not null and c.final_value_micro = v_value;
      select * into sh from gift_split(v_value, g.recipient_percent, g.merchant_percent);
      update gift_earning_components
         set final_value_micro = v_value, recipient_micro = sh.recipient_micro, merchant_micro = sh.merchant_micro,
             platform_micro = sh.platform_micro, reconciled_at = now()
       where gift_transaction_id = c.gift_transaction_id and lot_id = c.lot_id;
      -- Only the part not already reversed changes hands.
      perform gift_component_post(c.gift_transaction_id, l.id, 'participant', g.recipient_id, 'gift_recipient',
        (sh.recipient_micro - c.recipient_micro) - (floor(sh.recipient_micro::numeric * c.reversed_coins / c.coins)::bigint - c.reversed_recipient_micro),
        c.released, 'reconcile', 'gift:' || c.gift_transaction_id || ':' || l.id || ':recipient:reconcile:' || extract(epoch from clock_timestamp()));
      if g.merchant_id is not null then
        perform gift_component_post(c.gift_transaction_id, l.id, 'merchant', g.merchant_id, 'gift_referral',
          (sh.merchant_micro - c.merchant_micro) - (floor(sh.merchant_micro::numeric * c.reversed_coins / c.coins)::bigint - c.reversed_merchant_micro),
          c.released, 'reconcile', 'gift:' || c.gift_transaction_id || ':' || l.id || ':merchant:reconcile:' || extract(epoch from clock_timestamp()));
      end if;
      update gift_earning_components
         set reversed_recipient_micro = floor(sh.recipient_micro::numeric * reversed_coins / coins)::bigint,
             reversed_merchant_micro = floor(sh.merchant_micro::numeric * reversed_coins / coins)::bigint
       where gift_transaction_id = c.gift_transaction_id and lot_id = c.lot_id and reversed_coins > 0 and reversed_coins < coins;
      update gift_earning_components
         set reversed_recipient_micro = recipient_micro, reversed_merchant_micro = merchant_micro
       where gift_transaction_id = c.gift_transaction_id and lot_id = c.lot_id and reversed_coins = coins;
    end loop;
  end loop;
  return n;
end;
$$;

/**
 * Google has paid out this report: its lots' gift earnings become
 * withdrawable (pending -> available), net of anything already reversed.
 */
create or replace function play_settlement_mark_funds(p_batch uuid, p_admin uuid, p_reference text)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  c record;
  g gift_earnings%rowtype;
  released integer := 0;
begin
  update play_settlement_batches set funds_available_at = coalesce(funds_available_at, now()), payout_reference = p_reference, marked_by = p_admin
   where id = p_batch;
  if not found then raise exception 'batch_not_found'; end if;
  update coin_lots set settlement_status = 'funds_available', updated_at = now()
   where settlement_batch_id = p_batch and earning;

  for c in select gc.* from gift_earning_components gc join coin_lots l on l.id = gc.lot_id
            where l.settlement_batch_id = p_batch and not gc.released for update of gc loop
    select * into g from gift_earnings where gift_transaction_id = c.gift_transaction_id;
    perform partner_ledger_move('participant', g.recipient_id, 'gift_recipient', 'pending', 'available',
      c.recipient_micro - c.reversed_recipient_micro, 'release', 'gift_component', c.gift_transaction_id || ':' || c.lot_id,
      'gift:' || c.gift_transaction_id || ':' || c.lot_id || ':recipient:release');
    if g.merchant_id is not null then
      perform partner_ledger_move('merchant', g.merchant_id, 'gift_referral', 'pending', 'available',
        c.merchant_micro - c.reversed_merchant_micro, 'release', 'gift_component', c.gift_transaction_id || ':' || c.lot_id,
        'gift:' || c.gift_transaction_id || ':' || c.lot_id || ':merchant:release');
    end if;
    update gift_earning_components set released = true, released_at = now()
     where gift_transaction_id = c.gift_transaction_id and lot_id = c.lot_id;
    released := released + 1;
  end loop;

  insert into earnings_admin_audit (admin_id, action, target_type, target_id, details)
  values (coalesce(p_admin, '00000000-0000-0000-0000-000000000000'), 'mark_play_funds_available', 'settlement_batch', p_batch::text,
          jsonb_build_object('reference', p_reference, 'components_released', released));
  return jsonb_build_object('batch_id', p_batch, 'components_released', released);
end;
$$;

-- ----------------------------------------------------------------------------
-- Server-only access
-- ----------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['play_settlement_batches', 'play_settlement_lines', 'coin_lots', 'gift_lot_allocations',
                           'gift_earnings', 'gift_earning_components'] loop
    execute format('alter table %I enable row level security', t);
    execute format('revoke all on table %I from anon, authenticated, public', t);
    execute format('grant all on table %I to service_role', t);
  end loop;
end $$;

do $$
declare f text;
begin
  foreach f in array array[
    'coin_lot_value_base(coin_lots, text)', 'gift_split(bigint, numeric, numeric)',
    'gift_component_post(uuid, uuid, text, uuid, text, bigint, boolean, text, text, text)',
    'coin_lots_take(uuid, integer)', 'gift_record_earnings(uuid)', 'gift_component_reverse(uuid, uuid, integer, text, text)',
    'coin_lot_set_region(uuid, text)', 'play_settlement_import(text, text, jsonb, uuid)',
    'coin_lots_reconcile(text[], uuid)', 'play_settlement_mark_funds(uuid, uuid, text)',
    'dream_coins_credit_purchase(uuid, text, text, text, text, integer, boolean, timestamptz)',
    'dream_coins_reverse_purchase(text, integer, text, text)',
    'virtual_gift_send(uuid, uuid, text, integer, text, text, text, boolean, text, boolean, integer, integer)',
    'virtual_gift_reverse(uuid, uuid, text)', 'dream_coins_admin_adjust(uuid, integer, text, uuid, text)'] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $$;

-- ----------------------------------------------------------------------------
-- Verification - every row must be ok = true
-- ----------------------------------------------------------------------------
with checks(check_name, ok) as (
  select 'table ' || t, to_regclass('public.' || t) is not null
    from unnest(array['play_settlement_batches', 'play_settlement_lines', 'coin_lots', 'gift_lot_allocations',
                      'gift_earnings', 'gift_earning_components']) t
  union all select 'every purchase has a lot', not exists (
    select 1 from dream_coin_purchases p where not exists (select 1 from coin_lots l where l.purchase_id = p.id))
  union all select 'function ' || f, to_regproc('public.' || f) is not null
    from unnest(array['gift_record_earnings', 'gift_component_reverse', 'coin_lots_take', 'play_settlement_import',
                      'coin_lots_reconcile', 'play_settlement_mark_funds', 'coin_lot_set_region']) f
  union all select 'anon cannot read gift earnings', not has_table_privilege('anon', 'public.gift_earnings', 'select')
)
select * from checks;
