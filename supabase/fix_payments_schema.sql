-- ============================================================================
-- Payments schema reconciliation for FlyMadd Creative / One Dream Initiative
-- ============================================================================
-- Safe to run against the existing production database: every statement is
-- idempotent (CREATE ... IF NOT EXISTS / ADD COLUMN IF NOT EXISTS / CREATE OR
-- REPLACE), so re-running this script does nothing destructive.
--
-- IMPORTANT finding from the first run of this script: `payments` already
-- existed in this database but had no `payment_intent_id` column at all.
-- That means every insert the app code has ever made into `payments`
-- (vote.js, paymentWebhook.js) has been failing silently in production -
-- this is very likely the actual root cause of "payments are broken",
-- separate from and on top of the currency bug. Because of that, this
-- version no longer assumes ANY column exists on a pre-existing table -
-- every column the app code touches gets `add column if not exists` before
-- anything indexes or constrains it.
--
-- What this fixes:
--   1. payments was missing payment_intent_id (and possibly other columns)
--      entirely, so payment rows were never being written. Adds every
--      column the app code writes/reads on payments, votes, usdt_payments,
--      crypto_votes and catalogue_orders.
--   2. No idempotency key on payments -> a retried/duplicated request could
--      credit votes twice for one charge. Adds a UNIQUE index on
--      payments.payment_intent_id.
--   3. usdt_payments.tx_hash had no UNIQUE constraint, but
--      verify-usdt-payment.js already does an upsert with
--      `onConflict: 'tx_hash'` - that call fails/no-ops without this index.
--   4. payments/catalogue_orders only stored a single ambiguous `amount` +
--      `currency` column, which is how a raw NGN amount ended up mislabeled
--      as USD in paymentWebhook.js. Adds explicit amount_usd / amount_ngn /
--      exchange_rate columns everywhere money is recorded.
--   5. `increment_votes` was called with two different, incompatible
--      parameter signatures (verify-usdt-payment.js used
--      p_participant_id/p_vote_count, verify-crypto-payment.js used
--      pid/votes) but was never defined in this repo. Creates one canonical
--      function and the app code has been aligned to call it consistently.
--   6. Adds an `exchange_rates` cache table so the live USD->NGN lookup
--      (open.er-api.com) survives serverless cold starts instead of
--      re-fetching on every request.
--
-- If a statement errors, everything before it in this run is rolled back
-- (Supabase's SQL editor runs the whole script as one transaction). Fix the
-- reported issue and re-run the whole script - every line is safe to repeat.
-- ============================================================================

create extension if not exists pgcrypto;

-- ----------------------------------------------------------------------------
-- exchange_rates: cache for the live open.er-api.com USD->NGN rate
-- ----------------------------------------------------------------------------
create table if not exists exchange_rates (
  id bigint generated always as identity primary key,
  base text not null,
  target text not null,
  rate numeric not null,
  fetched_at timestamptz not null default now()
);

create index if not exists exchange_rates_lookup_idx
  on exchange_rates (base, target, fetched_at desc);

-- ----------------------------------------------------------------------------
-- payments: one row per completed/attempted deposit (Paystack, crypto, mock)
-- ----------------------------------------------------------------------------
create table if not exists payments (
  id uuid primary key default gen_random_uuid()
);

-- Every column the app code reads or writes on `payments`, added
-- defensively - if `payments` pre-existed with some of these already,
-- each line below simply no-ops for that column.
alter table payments add column if not exists participant_id uuid references participants(id);
alter table payments add column if not exists amount numeric;
alter table payments add column if not exists amount_usd numeric;
alter table payments add column if not exists amount_ngn numeric;
alter table payments add column if not exists exchange_rate numeric;
alter table payments add column if not exists currency text not null default 'NGN';
alter table payments add column if not exists payment_method text;
alter table payments add column if not exists payment_intent_id text;
alter table payments add column if not exists status text not null default 'pending';
alter table payments add column if not exists metadata jsonb;
alter table payments add column if not exists verified_at timestamptz;
alter table payments add column if not exists created_at timestamptz not null default now();

-- If this next statement fails with "could not create unique index ...
-- contains duplicate key values", there are already duplicate
-- payment_intent_id rows (likely NULLs from before payment_intent_id
-- existed - a plain unique index allows any number of NULLs through, so
-- that alone won't trigger this). Inspect real duplicates with:
--
--   select payment_intent_id, count(*) from payments
--   where payment_intent_id is not null
--   group by payment_intent_id having count(*) > 1;
--
-- then decide case by case which duplicate to keep before retrying below.
create unique index if not exists payments_payment_intent_id_key
  on payments (payment_intent_id);

create index if not exists payments_participant_id_idx on payments (participant_id);

-- ----------------------------------------------------------------------------
-- votes: one row per credited vote, linked back to the payment that paid for it
-- ----------------------------------------------------------------------------
create table if not exists votes (
  id uuid primary key default gen_random_uuid()
);

alter table votes add column if not exists participant_id uuid references participants(id);
alter table votes add column if not exists payment_id uuid references payments(id);
alter table votes add column if not exists voter_ip text;
alter table votes add column if not exists voter_user_agent text;
alter table votes add column if not exists created_at timestamptz not null default now();

create index if not exists votes_payment_id_idx on votes (payment_id);
create index if not exists votes_participant_id_idx on votes (participant_id);

-- ----------------------------------------------------------------------------
-- usdt_payments: BSC/Tron USDT deposits
-- ----------------------------------------------------------------------------
create table if not exists usdt_payments (
  id uuid primary key default gen_random_uuid()
);

alter table usdt_payments add column if not exists user_id uuid references participants(id);
alter table usdt_payments add column if not exists network text;
alter table usdt_payments add column if not exists tx_hash text;
alter table usdt_payments add column if not exists amount numeric;
alter table usdt_payments add column if not exists from_address text;
alter table usdt_payments add column if not exists to_address text;
alter table usdt_payments add column if not exists status text not null default 'pending';
alter table usdt_payments add column if not exists block_number bigint;
alter table usdt_payments add column if not exists vote_count integer;
alter table usdt_payments add column if not exists verified_at timestamptz;
alter table usdt_payments add column if not exists created_at timestamptz not null default now();

-- Required for the `.upsert(..., { onConflict: 'tx_hash' })` call in
-- verify-usdt-payment.js to work at all - without this constraint Postgres
-- has nothing to conflict on and the upsert either errors or silently
-- inserts duplicates. Same duplicate-check caveat as payments above applies
-- if this fails - inspect with:
--
--   select tx_hash, count(*) from usdt_payments
--   where tx_hash is not null group by tx_hash having count(*) > 1;
create unique index if not exists usdt_payments_tx_hash_key
  on usdt_payments (tx_hash);

-- ----------------------------------------------------------------------------
-- crypto_votes: pending/confirmed multi-chain crypto vote payments
-- ----------------------------------------------------------------------------
create table if not exists crypto_votes (
  id uuid primary key default gen_random_uuid()
);

alter table crypto_votes add column if not exists participant_id uuid references participants(id);
alter table crypto_votes add column if not exists user_id uuid references participants(id);
alter table crypto_votes add column if not exists network text;
alter table crypto_votes add column if not exists tx_hash text;
alter table crypto_votes add column if not exists vote_count integer;
alter table crypto_votes add column if not exists expected_amount numeric;
alter table crypto_votes add column if not exists status text not null default 'pending';
alter table crypto_votes add column if not exists confirmed_at timestamptz;
alter table crypto_votes add column if not exists created_at timestamptz not null default now();

-- ----------------------------------------------------------------------------
-- catalogue_orders: marketplace checkout (Paystack / USDT) on catalogue-product.html
-- ----------------------------------------------------------------------------
-- Not created here (assumed to already exist, since catalogue-product.html
-- and supabase-config.js are live features) - only the columns this fix adds.
alter table catalogue_orders add column if not exists amount_ngn numeric;
alter table catalogue_orders add column if not exists exchange_rate numeric;
alter table catalogue_orders add column if not exists currency text default 'NGN';
alter table catalogue_orders add column if not exists payment_ref text;
alter table catalogue_orders add column if not exists updated_at timestamptz;

-- Prevents the same Paystack reference from creating two order rows if the
-- create-order call is retried after a network hiccup. Postgres allows
-- multiple NULLs through a unique index, so USDT orders (payment_ref = null)
-- are unaffected. Same duplicate-check caveat as above if this fails.
create unique index if not exists catalogue_orders_payment_ref_key
  on catalogue_orders (payment_ref);

-- ----------------------------------------------------------------------------
-- increment_votes: atomic vote-count bump used by verify-usdt-payment.js and
-- verify-crypto-payment.js. Single canonical signature - both call sites in
-- the app now use p_participant_id / p_vote_count.
-- ----------------------------------------------------------------------------
create or replace function increment_votes(p_participant_id uuid, p_vote_count integer)
returns void
language sql
as $$
  update participants
  set total_votes = coalesce(total_votes, 0) + p_vote_count,
      updated_at = now()
  where id = p_participant_id;
$$;
