-- ============================================================================
-- Dream Coins, virtual gifts & marketplace recognition
-- ============================================================================
-- Additive. Creates new tables and functions only. Reads participants through
-- foreign keys; touches no existing table, payment flow, wallet, vote or
-- marketplace record.
--
--   dream_coin_packages          admin-managed coin packages (Google Play consumables)
--   dream_coin_purchases         one row per verified Google Play purchase token
--   dream_coin_balances          current balance + gifting suspension per account
--   virtual_gift_catalogue       admin-managed gifts (no app release needed)
--   virtual_gift_transactions    gifts sent (coins spent -> recognition points)
--   dream_coin_ledger            append-only: every credit, debit, reversal, correction
--   virtual_gift_refunds         append-only: admin gift reversals
--   dream_gifting_admin_audit    append-only: every admin action in this module
--   reward_programs              configurable, NON-CASH recognition programmes
--   reward_awards                awards granted under a programme
--
-- Rules that must never break live in functions (one transaction each):
--   dream_coins_credit_purchase()  credit exactly once per purchase token,
--                                  quantity x coins_per_unit
--   dream_coins_record_consumption()
--   dream_coins_reverse_purchase() refunds / partial refunds / revocations;
--                                  the balance may go negative (a debt that
--                                  blocks spending) - nothing else is touched
--   virtual_gift_send()            idempotent, atomic, rate limited, no self-gifts
--   virtual_gift_reverse()         admin reversal, coins back to the sender
--   dream_coins_admin_adjust()     audited correction
--   dream_coins_set_suspension()   audited suspension
--
-- Dream Coins have no cash value: there is no withdrawal, transfer or
-- conversion function, and recognition points are not a balance anyone can
-- spend or withdraw. Reward programmes cannot be monetary (constraint below);
-- adding cash rewards needs a new, separately approved migration.
--
-- Server-only: RLS on with no policies, no client-role privileges.
-- Supabase's SQL editor may not apply a paste atomically - run the
-- verification query at the bottom and confirm every row is ok = true.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Coin packages
-- ----------------------------------------------------------------------------
create table if not exists dream_coin_packages (
  id text primary key check (id ~ '^[a-z0-9_]{2,60}$'),
  google_play_product_id text not null unique check (google_play_product_id ~ '^[a-z0-9][a-z0-9._]{0,138}$'),
  name text not null check (char_length(name) between 2 and 40),
  coins_per_unit integer not null check (coins_per_unit between 1 and 1000000),
  -- Planning reference only. Buyers always see and pay Google Play's localized price.
  reference_price_usd numeric(10,2) check (reference_price_usd is null or reference_price_usd > 0),
  highlight text check (highlight is null or char_length(highlight) <= 20),
  is_active boolean not null default true,
  sort_order integer not null default 100,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into dream_coin_packages (id, google_play_product_id, name, coins_per_unit, reference_price_usd, highlight, sort_order) values
  ('dream_coins_100',   'dream_coins_100',   'Starter',    100,   0.99,  null,          10),
  ('dream_coins_250',   'dream_coins_250',   'Friend',     250,   1.99,  null,          20),
  ('dream_coins_600',   'dream_coins_600',   'Supporter',  600,   4.99,  'Popular',     30),
  ('dream_coins_1300',  'dream_coins_1300',  'Champion',   1300,  9.99,  null,          40),
  ('dream_coins_2800',  'dream_coins_2800',  'Patron',     2800,  19.99, 'Best value',  50),
  ('dream_coins_7500',  'dream_coins_7500',  'Benefactor', 7500,  49.99, null,          60),
  ('dream_coins_16000', 'dream_coins_16000', 'Legend',     16000, 99.99, null,          70)
on conflict (id) do nothing;

-- ----------------------------------------------------------------------------
-- Purchases (one per Google Play purchase token)
-- ----------------------------------------------------------------------------
create table if not exists dream_coin_purchases (
  id uuid primary key default gen_random_uuid(),
  participant_id uuid not null references participants(id),
  package_id text not null references dream_coin_packages(id),
  provider text not null default 'google_play' check (provider in ('google_play')),
  product_id text not null,
  purchase_token text not null unique,
  order_id text,
  quantity integer not null check (quantity between 1 and 1000),       -- Google's verified quantity
  coins_per_unit integer not null check (coins_per_unit > 0),         -- snapshot at credit time
  total_coins integer not null,
  is_test boolean not null default false,                            -- Play license-tester purchase
  status text not null default 'credited' check (status in ('credited', 'partially_reversed', 'reversed')),
  consumption_state text not null default 'pending' check (consumption_state in ('pending', 'consumed', 'acknowledged', 'failed')),
  reversed_quantity integer not null default 0,
  purchased_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint dream_coin_purchases_total check (total_coins = quantity * coins_per_unit),
  constraint dream_coin_purchases_reversed check (reversed_quantity between 0 and quantity)
);
create index if not exists dream_coin_purchases_participant on dream_coin_purchases (participant_id, created_at desc);

-- ----------------------------------------------------------------------------
-- Balances
-- ----------------------------------------------------------------------------
create table if not exists dream_coin_balances (
  participant_id uuid primary key references participants(id),
  balance integer not null default 0,              -- negative only after a refund of spent coins
  lifetime_purchased integer not null default 0,
  lifetime_spent integer not null default 0,
  gifting_suspended boolean not null default false,
  suspended_reason text,
  updated_at timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- Gift catalogue
-- ----------------------------------------------------------------------------
create table if not exists virtual_gift_catalogue (
  id text primary key check (id ~ '^[a-z0-9_]{2,40}$'),
  name text not null check (char_length(name) between 2 and 40),
  description text check (description is null or char_length(description) <= 200),
  emoji text check (emoji is null or char_length(emoji) <= 8),            -- artwork fallback
  image_url text check (image_url is null or image_url ~ '^https://'),
  animation_url text check (animation_url is null or animation_url ~ '^https://'),
  coin_cost integer not null check (coin_cost between 1 and 1000000),
  category text not null default 'appreciation' check (char_length(category) between 2 and 40),
  is_active boolean not null default true,
  display_priority integer not null default 100,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into virtual_gift_catalogue (id, name, description, emoji, coin_cost, display_priority) values
  ('appreciation_heart',   'Appreciation Heart',   'A simple thank-you.',                        '❤️', 10,   10),
  ('thank_you_rose',       'Thank You Rose',       'For a smooth, friendly purchase.',          '🌹', 25,   20),
  ('support_star',         'Support Star',         'For great service.',                         '⭐', 50,   30),
  ('golden_trophy',        'Golden Trophy',        'For going above and beyond.',                '🏆', 100,  40),
  ('dream_supporter',      'Dream Supporter',      'Back a seller you believe in.',              '🌟', 250,  50),
  ('diamond_appreciation', 'Diamond Appreciation', 'Exceptional quality and care.',              '💎', 500,  60),
  ('legendary_support',    'Legendary Support',    'The highest recognition you can send.',      '👑', 1000, 70)
on conflict (id) do nothing;

-- ----------------------------------------------------------------------------
-- Gifts sent
-- ----------------------------------------------------------------------------
create table if not exists virtual_gift_transactions (
  id uuid primary key default gen_random_uuid(),
  sender_id uuid not null references participants(id),
  recipient_id uuid not null references participants(id),
  gift_id text not null references virtual_gift_catalogue(id),
  gift_snapshot jsonb not null,                  -- name / emoji / image / cost when sent
  quantity integer not null check (quantity between 1 and 99),
  unit_cost integer not null check (unit_cost > 0),
  coins_spent integer not null,
  recognition_points integer not null check (recognition_points >= 0),   -- non-cash, never withdrawable
  context_type text not null default 'profile' check (context_type in ('profile', 'order')),
  context_ref text check (context_ref is null or char_length(context_ref) <= 80),
  verified_buyer boolean not null default false, -- sender proved a delivered order with this seller
  message text check (message is null or char_length(message) <= 140),
  is_anonymous boolean not null default false,
  client_request_id text not null check (client_request_id ~ '^[A-Za-z0-9_-]{8,80}$'),
  status text not null default 'sent' check (status in ('sent', 'reversed')),
  created_at timestamptz not null default now(),
  constraint virtual_gift_transactions_cost check (coins_spent = quantity * unit_cost),
  constraint virtual_gift_transactions_no_self check (sender_id <> recipient_id),
  constraint virtual_gift_transactions_request_key unique (sender_id, client_request_id)
);
create index if not exists virtual_gift_transactions_recipient on virtual_gift_transactions (recipient_id, created_at desc);
create index if not exists virtual_gift_transactions_sender on virtual_gift_transactions (sender_id, created_at desc);

-- ----------------------------------------------------------------------------
-- Ledger (append-only)
-- ----------------------------------------------------------------------------
create table if not exists dream_coin_ledger (
  id bigint generated always as identity primary key,
  participant_id uuid not null references participants(id),
  entry_type text not null check (entry_type in ('purchase_credit', 'purchase_reversal', 'gift_debit', 'gift_reversal_credit', 'admin_adjustment')),
  coins integer not null check (coins <> 0),
  balance_after integer not null,
  purchase_id uuid references dream_coin_purchases(id),
  gift_transaction_id uuid references virtual_gift_transactions(id),
  idempotency_key text not null unique,
  note text,
  admin_id uuid,
  created_at timestamptz not null default now()
);
create index if not exists dream_coin_ledger_participant on dream_coin_ledger (participant_id, id desc);

create table if not exists virtual_gift_refunds (
  id uuid primary key default gen_random_uuid(),
  gift_transaction_id uuid not null unique references virtual_gift_transactions(id),
  coins_returned integer not null check (coins_returned > 0),
  reason text not null check (char_length(reason) between 3 and 500),
  admin_id uuid not null,
  created_at timestamptz not null default now()
);

create table if not exists dream_gifting_admin_audit (
  id bigint generated always as identity primary key,
  admin_id uuid not null,
  action text not null,
  target_type text not null,
  target_id text,
  details jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index if not exists dream_gifting_admin_audit_created on dream_gifting_admin_audit (created_at desc);

create or replace function dream_coins_append_only()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  raise exception 'append_only: % rows cannot be changed or deleted', tg_table_name;
end;
$$;

do $$
declare t text;
begin
  foreach t in array array['dream_coin_ledger', 'virtual_gift_refunds', 'dream_gifting_admin_audit'] loop
    execute format('drop trigger if exists %I on %I', t || '_append_only', t);
    execute format('create trigger %I before update or delete on %I for each row execute function dream_coins_append_only()', t || '_append_only', t);
  end loop;
end $$;

-- ----------------------------------------------------------------------------
-- Recognition programmes (non-cash)
-- ----------------------------------------------------------------------------
create table if not exists reward_programs (
  id text primary key check (id ~ '^[a-z0-9_]{2,40}$'),
  name text not null check (char_length(name) between 2 and 60),
  description text check (description is null or char_length(description) <= 500),
  audience text not null default 'any' check (char_length(audience) between 2 and 40),
  -- { "metric": "<key>", "threshold": n, "window_days": n, "min_orders": n }.
  -- Unknown metrics are treated as admin-reviewed, so new programmes need no code.
  criteria jsonb not null default '{}',
  reward_type text not null default 'badge' check (char_length(reward_type) between 2 and 40),
  reward_label text check (reward_label is null or char_length(reward_label) <= 60),
  is_monetary boolean not null default false,
  is_active boolean not null default true,
  sort_order integer not null default 100,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Cash commissions / monetary bonuses are behind a separate approval and
  -- compliance gate: enabling them requires a new migration.
  constraint reward_programs_non_cash check (not is_monetary)
);

insert into reward_programs (id, name, description, audience, criteria, reward_type, reward_label, is_active, sort_order) values
  ('seller_excellence', 'Seller Excellence', 'Sellers with a strong record of confirmed deliveries.', 'seller',
   '{"metric": "confirmed_sales", "threshold": 10, "window_days": 90}', 'badge', 'Excellent Seller badge', true, 10),
  ('reliable_merchant', 'Reliable Merchant', 'At least 95% of orders confirmed by buyers without dispute (minimum 5 orders).', 'seller',
   '{"metric": "delivery_reliability", "threshold": 0.95, "min_orders": 5, "window_days": 180}', 'featured_placement', 'Reliable Merchant feature', true, 20),
  ('most_appreciated', 'Most Appreciated', 'Sellers whose customers sent the most appreciation this month. Recognition only - no prize.', 'seller',
   '{"metric": "recognition_points", "threshold": 1000, "window_days": 30}', 'badge', 'Appreciated Seller badge', true, 30),
  ('merchant_referral', 'Merchant Referral', 'Introduce merchants who join and stay active on One Dream.', 'merchant',
   '{"metric": "merchant_referrals", "threshold": 3}', 'achievement', 'Community Builder', true, 40),
  ('affiliate_performance', 'Affiliate Performance', 'Attributed marketplace sales under an approved affiliate agreement. Not active until agreements are approved.', 'affiliate',
   '{"metric": "affiliate_sales"}', 'achievement', 'Top Affiliate', false, 50),
  ('buyer_recognition', 'Buyer Recognition', 'Verified buyers who thank their sellers and leave helpful feedback.', 'buyer',
   '{"metric": "verified_appreciations", "threshold": 3, "window_days": 90}', 'badge', 'Valued Customer badge', true, 60),
  ('community_contribution', 'Community Contribution', 'Mentorship, helpful content and positive community activity, reviewed by the team.', 'community',
   '{"metric": "admin_review"}', 'badge', 'Community Contributor', true, 70)
on conflict (id) do nothing;

create table if not exists reward_awards (
  id uuid primary key default gen_random_uuid(),
  program_id text not null references reward_programs(id),
  participant_id uuid not null references participants(id),
  period text not null check (period ~ '^[0-9A-Za-z_-]{1,20}$'),    -- e.g. 2026-10
  title text not null check (char_length(title) between 2 and 80),
  details jsonb not null default '{}',
  status text not null default 'awarded' check (status in ('awarded', 'revoked')),
  awarded_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint reward_awards_once_per_period unique (program_id, participant_id, period)
);
create index if not exists reward_awards_participant on reward_awards (participant_id, created_at desc);

-- ----------------------------------------------------------------------------
-- Credit a verified purchase exactly once
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
  new_id uuid;
  total integer;
  new_balance integer;
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
    -- A concurrent request for the same token won; report its result.
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

  return jsonb_build_object('purchase_id', new_id, 'already_credited', false, 'quantity', p_quantity,
    'coins_per_unit', pkg.coins_per_unit, 'total_coins', total, 'consumption_state', 'pending', 'balance', new_balance);
end;
$$;

create or replace function dream_coins_record_consumption(p_purchase_token text, p_state text)
returns void
language plpgsql
set search_path = public
as $$
begin
  if p_state not in ('consumed', 'acknowledged', 'failed') then raise exception 'invalid_state'; end if;
  update dream_coin_purchases set consumption_state = p_state, updated_at = now()
   where purchase_token = p_purchase_token and consumption_state <> 'consumed';
end;
$$;

-- ----------------------------------------------------------------------------
-- Refunds / revocations. p_quantity null = everything not yet reversed.
-- p_event_key identifies one Google voided-purchase event (idempotent).
-- ----------------------------------------------------------------------------
create or replace function dream_coins_reverse_purchase(p_purchase_token text, p_quantity integer, p_event_key text, p_reason text)
returns integer
language plpgsql
set search_path = public
as $$
declare
  p dream_coin_purchases%rowtype;
  qty integer;
  coins integer;
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
  return coins;
end;
$$;

-- ----------------------------------------------------------------------------
-- Send a gift: idempotent per (sender, client_request_id), atomic, rate limited
-- ----------------------------------------------------------------------------
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

  -- Serialises every spend by this sender.
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

  return jsonb_build_object('gift_transaction_id', new_id, 'already_sent', false, 'coins_spent', cost, 'balance', new_balance);
end;
$$;

-- ----------------------------------------------------------------------------
-- Admin: reverse a gift (coins back to sender, recognition removed)
-- ----------------------------------------------------------------------------
create or replace function virtual_gift_reverse(p_gift_transaction_id uuid, p_admin_id uuid, p_reason text)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  t virtual_gift_transactions%rowtype;
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
  insert into dream_gifting_admin_audit (admin_id, action, target_type, target_id, details)
  values (p_admin_id, 'reverse_gift', 'gift', t.id::text, jsonb_build_object('reason', p_reason, 'coins_returned', t.coins_spent));
  return jsonb_build_object('already_reversed', false, 'coins_returned', t.coins_spent, 'sender_balance', new_balance);
end;
$$;

-- ----------------------------------------------------------------------------
-- Admin: audited coin correction (positive or negative)
-- ----------------------------------------------------------------------------
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
  return jsonb_build_object('already_applied', false, 'balance', new_balance);
end;
$$;

create or replace function dream_coins_set_suspension(p_participant_id uuid, p_suspended boolean, p_reason text, p_admin_id uuid)
returns void
language plpgsql
set search_path = public
as $$
begin
  insert into dream_coin_balances as b (participant_id, gifting_suspended, suspended_reason)
  values (p_participant_id, p_suspended, case when p_suspended then p_reason end)
  on conflict (participant_id) do update
    set gifting_suspended = excluded.gifting_suspended, suspended_reason = excluded.suspended_reason, updated_at = now();
  insert into dream_gifting_admin_audit (admin_id, action, target_type, target_id, details)
  values (p_admin_id, case when p_suspended then 'suspend_gifting' else 'restore_gifting' end, 'participant', p_participant_id::text,
          jsonb_build_object('reason', p_reason));
end;
$$;

-- ----------------------------------------------------------------------------
-- Server-only access
-- ----------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['dream_coin_packages', 'dream_coin_purchases', 'dream_coin_balances', 'virtual_gift_catalogue',
                           'virtual_gift_transactions', 'dream_coin_ledger', 'virtual_gift_refunds', 'dream_gifting_admin_audit',
                           'reward_programs', 'reward_awards'] loop
    execute format('alter table %I enable row level security', t);
    execute format('revoke all on table %I from anon, authenticated, public', t);
    execute format('grant all on table %I to service_role', t);
  end loop;
end $$;

do $$
declare f text;
begin
  foreach f in array array[
    'dream_coins_append_only()',
    'dream_coins_credit_purchase(uuid, text, text, text, text, integer, boolean, timestamptz)',
    'dream_coins_record_consumption(text, text)',
    'dream_coins_reverse_purchase(text, integer, text, text)',
    'virtual_gift_send(uuid, uuid, text, integer, text, text, text, boolean, text, boolean, integer, integer)',
    'virtual_gift_reverse(uuid, uuid, text)',
    'dream_coins_admin_adjust(uuid, integer, text, uuid, text)',
    'dream_coins_set_suspension(uuid, boolean, text, uuid)'] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $$;

-- ----------------------------------------------------------------------------
-- Verification - every row must be ok = true
-- ----------------------------------------------------------------------------
with checks(check_name, ok) as (
  select 'table ' || t, to_regclass('public.' || t) is not null
    from unnest(array['dream_coin_packages', 'dream_coin_purchases', 'dream_coin_balances', 'virtual_gift_catalogue',
                      'virtual_gift_transactions', 'dream_coin_ledger', 'virtual_gift_refunds', 'dream_gifting_admin_audit',
                      'reward_programs', 'reward_awards']) t
  union all select 'RLS on ' || t, coalesce((select relrowsecurity from pg_class where oid = to_regclass('public.' || t)), false)
    from unnest(array['dream_coin_purchases', 'dream_coin_balances', 'virtual_gift_transactions', 'dream_coin_ledger', 'reward_awards']) t
  union all select 'anon cannot read ' || t, not has_table_privilege('anon', 'public.' || t, 'select')
    from unnest(array['dream_coin_purchases', 'dream_coin_balances', 'virtual_gift_transactions', 'dream_coin_ledger']) t
  union all select '7 coin packages seeded', (select count(*) from dream_coin_packages where id in
    ('dream_coins_100', 'dream_coins_250', 'dream_coins_600', 'dream_coins_1300', 'dream_coins_2800', 'dream_coins_7500', 'dream_coins_16000')) = 7
  union all select 'gift catalogue seeded', (select count(*) from virtual_gift_catalogue) >= 7
  union all select 'purchase token unique', exists (select 1 from pg_constraint where conname = 'dream_coin_purchases_purchase_token_key')
  union all select 'ledger idempotency unique', exists (select 1 from pg_constraint where conname = 'dream_coin_ledger_idempotency_key_key')
  union all select 'no self-gifting', exists (select 1 from pg_constraint where conname = 'virtual_gift_transactions_no_self')
  union all select 'reward programmes non-cash', exists (select 1 from pg_constraint where conname = 'reward_programs_non_cash')
  union all select 'ledger append-only trigger', exists (select 1 from pg_trigger where tgname = 'dream_coin_ledger_append_only')
  union all select 'function ' || f, to_regproc('public.' || f) is not null
    from unnest(array['dream_coins_credit_purchase', 'dream_coins_record_consumption', 'dream_coins_reverse_purchase',
                      'virtual_gift_send', 'virtual_gift_reverse', 'dream_coins_admin_adjust', 'dream_coins_set_suspension']) f
  union all select 'anon cannot credit coins', not has_function_privilege('anon',
    'public.dream_coins_credit_purchase(uuid,text,text,text,text,integer,boolean,timestamptz)', 'execute')
  union all select 'authenticated cannot send gifts directly', not has_function_privilege('authenticated',
    'public.virtual_gift_send(uuid,uuid,text,integer,text,text,text,boolean,text,boolean,integer,integer)', 'execute')
)
select * from checks;
