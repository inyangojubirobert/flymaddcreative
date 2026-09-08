-- ============================================================================
-- Merchant schema reconciliation - FlyMadd Creative referral program
-- ============================================================================
-- Run supabase/fix_payments_schema.sql FIRST - this file's merchant_referral_rewards.vote_id
-- column references crypto_votes(id), which that script creates.
--
-- Companion to supabase/fix_payments_schema.sql. Run this in the Supabase
-- SQL editor the same way - every statement is idempotent and safe to
-- re-run. Given the payments table was already found missing a column the
-- app code depended on, every column referral_merchants /
-- merchant_referral_links / merchant_referral_rewards code reads or writes
-- is added defensively here too, rather than assumed present.
--
-- What this adds:
--   1. merchant_withdrawals: an actual persisted record of each withdrawal
--      (amount, wallet, status) - previously a withdrawal returned a
--      "processing" status in the API response but nothing was ever written
--      to the database, so there was no audit trail of what was withdrawn.
--   2. withdraw_merchant_tokens(): an atomic, race-safe debit function.
--      pages/api/merchants/[id]/withdraw.js previously read
--      available_tokens, checked it in application code, then wrote back
--      available_tokens - amount as a separate step - two concurrent
--      withdrawal requests could both read the same starting balance, both
--      pass the check, and both debit, going negative. The UPDATE ... WHERE
--      available_tokens >= amount below makes the check-and-debit atomic.
--   3. Defensive `add column if not exists` for every column the merchant
--      code touches, in case referral_merchants / merchant_referral_links /
--      merchant_referral_rewards are missing something the way `payments`
--      was missing payment_intent_id.
--
--   4. credit_merchant_tokens() + merchant_referral_rewards.payment_id: the
--      reward-crediting logic added in lib/merchantRewards.js (called from
--      vote.js, paymentWebhook.js, and the reconcile script after a referred
--      participant's vote is confirmed) uses these. The reward amount is
--      TOKENS_PER_REFERRED_VOTE in that file (defaults to 50, matching the
--      "50 tokens per confirmed vote" copy already shown in
--      merchant-login.html) - override via the MERCHANT_REWARD_TOKENS_PER_VOTE
--      env var if that number is wrong; nothing before this credited a
--      merchant's balance at all, so there's no existing behavior to match.
-- ============================================================================

create extension if not exists pgcrypto;

-- ----------------------------------------------------------------------------
-- referral_merchants: defensive column coverage
-- ----------------------------------------------------------------------------
alter table referral_merchants add column if not exists merchant_name text;
alter table referral_merchants add column if not exists email text;
alter table referral_merchants add column if not exists company_name text;
alter table referral_merchants add column if not exists wallet_address text;
alter table referral_merchants add column if not exists password_hash text;
alter table referral_merchants add column if not exists total_tokens_earned numeric not null default 0;
alter table referral_merchants add column if not exists available_tokens numeric not null default 0;
alter table referral_merchants add column if not exists status text not null default 'active';
alter table referral_merchants add column if not exists created_at timestamptz not null default now();

-- ----------------------------------------------------------------------------
-- merchant_referral_links: defensive column coverage
-- ----------------------------------------------------------------------------
alter table merchant_referral_links add column if not exists merchant_id uuid references referral_merchants(id);
alter table merchant_referral_links add column if not exists link_code text;
alter table merchant_referral_links add column if not exists full_link text;
alter table merchant_referral_links add column if not exists description text;
alter table merchant_referral_links add column if not exists is_active boolean not null default true;
alter table merchant_referral_links add column if not exists clicks_count integer not null default 0;
alter table merchant_referral_links add column if not exists registrations_count integer not null default 0;
alter table merchant_referral_links add column if not exists created_at timestamptz not null default now();

-- ----------------------------------------------------------------------------
-- merchant_referral_rewards: defensive column coverage
-- ----------------------------------------------------------------------------
alter table merchant_referral_rewards add column if not exists participant_id uuid references participants(id);
alter table merchant_referral_rewards add column if not exists vote_id uuid references crypto_votes(id);
alter table merchant_referral_rewards add column if not exists merchant_link_id uuid references merchant_referral_links(id);
alter table merchant_referral_rewards add column if not exists merchant_id uuid references referral_merchants(id);
alter table merchant_referral_rewards add column if not exists tokens_awarded numeric;
alter table merchant_referral_rewards add column if not exists status text not null default 'pending';
alter table merchant_referral_rewards add column if not exists paid_at timestamptz;
alter table merchant_referral_rewards add column if not exists created_at timestamptz not null default now();
alter table merchant_referral_rewards add column if not exists payment_id uuid references payments(id);

-- Idempotency for lib/merchantRewards.js: one reward row per payment, so a
-- retried webhook or reconciliation run can't double-credit a merchant.
-- Multiple NULLs are allowed through (rows created before this column
-- existed, or from a path that doesn't pass a payment_id).
create unique index if not exists merchant_referral_rewards_payment_id_key
  on merchant_referral_rewards (payment_id);

-- ----------------------------------------------------------------------------
-- merchant_withdrawals: audit trail for withdraw_merchant_tokens() below
-- ----------------------------------------------------------------------------
create table if not exists merchant_withdrawals (
  id uuid primary key default gen_random_uuid(),
  merchant_id uuid references referral_merchants(id),
  amount numeric not null,
  wallet_address text,
  status text not null default 'processing',
  created_at timestamptz not null default now()
);

create index if not exists merchant_withdrawals_merchant_id_idx on merchant_withdrawals (merchant_id);

-- ----------------------------------------------------------------------------
-- withdraw_merchant_tokens: atomic balance check + debit
-- ----------------------------------------------------------------------------
create or replace function withdraw_merchant_tokens(p_merchant_id uuid, p_amount numeric)
returns table(new_balance numeric, wallet_address text)
language plpgsql
as $$
declare
  v_new_balance numeric;
  v_wallet text;
  v_exists boolean;
begin
  select exists(select 1 from referral_merchants where id = p_merchant_id) into v_exists;
  if not v_exists then
    raise exception 'merchant_not_found';
  end if;

  update referral_merchants
  set available_tokens = available_tokens - p_amount
  where id = p_merchant_id and available_tokens >= p_amount
  returning available_tokens, wallet_address into v_new_balance, v_wallet;

  if not found then
    raise exception 'insufficient_balance';
  end if;

  return query select v_new_balance, v_wallet;
end;
$$;

create or replace function request_merchant_withdrawal(p_merchant_id uuid, p_amount numeric)
returns table(withdrawal_id uuid, amount numeric, wallet_address text, status text)
language plpgsql
as $$
declare
  v_wallet text;
  v_id uuid;
begin
  update referral_merchants
  set available_tokens = available_tokens - p_amount
  where id = p_merchant_id and available_tokens >= p_amount
  returning referral_merchants.wallet_address into v_wallet;

  if not found then
    raise exception 'insufficient_balance';
  end if;

  insert into merchant_withdrawals (merchant_id, amount, wallet_address, status)
  values (p_merchant_id, p_amount, v_wallet, 'processing')
  returning id into v_id;

  return query select v_id, p_amount, v_wallet, 'processing'::text;
end;
$$;

-- ----------------------------------------------------------------------------
-- credit_merchant_tokens: atomic reward credit (the increment counterpart to
-- withdraw_merchant_tokens' decrement above)
-- ----------------------------------------------------------------------------
create or replace function credit_merchant_tokens(p_merchant_id uuid, p_amount numeric)
returns void
language sql
as $$
  update referral_merchants
  set available_tokens = coalesce(available_tokens, 0) + p_amount,
      total_tokens_earned = coalesce(total_tokens_earned, 0) + p_amount
  where id = p_merchant_id;
$$;
