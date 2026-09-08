-- ============================================================================
-- Participant withdrawal schema + atomic balance enforcement
-- ============================================================================
-- Companion to supabase/fix_payments_schema.sql and fix_merchant_schema.sql -
-- same idempotent, safe-to-re-run pattern.
--
-- Before this, public/js/supabase-config.js's requestWithdrawal() inserted
-- directly into participant_withdrawals from the browser with a
-- client-computed, attacker-controllable amount_usd - the only balance
-- check was in user-dashboard.html's JavaScript. Nothing server-side ever
-- recomputed the participant's real earned balance
-- (total_votes * $1/vote - already-withdrawn) before writing the row.
--
-- request_participant_withdrawal() below is the atomic version: it locks
-- the participant row, recomputes earned/withdrawn/available with the exact
-- same formula public/js/supabase-config.js uses (calcEarnings /
-- calcTotalWithdrawn - keep these in sync if that formula ever changes),
-- and only then inserts - closing both the amount-tampering hole and the
-- same read-then-write race already fixed for merchant withdrawals.
-- ============================================================================

create extension if not exists pgcrypto;

-- No NOT NULL here (unlike currency's NOT NULL DEFAULT elsewhere in these
-- scripts) - these two have no sensible default to backfill existing rows
-- with if the column turns out to be missing on a table that already has data.
alter table participant_withdrawals add column if not exists username text;
alter table participant_withdrawals add column if not exists amount_usd numeric;
alter table participant_withdrawals add column if not exists payment_method text;
alter table participant_withdrawals add column if not exists payment_details text;
alter table participant_withdrawals add column if not exists status text not null default 'pending';
alter table participant_withdrawals add column if not exists created_at timestamptz not null default now();

create index if not exists participant_withdrawals_username_idx on participant_withdrawals (username);

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
  -- Lock the participant row so two concurrent withdrawal requests can't
  -- both read the same starting balance and both pass the check below.
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
  where username = v_username and status <> 'rejected';

  v_available := v_earned - v_withdrawn;

  if p_amount <= 0 or p_amount > v_available then
    raise exception 'insufficient_balance';
  end if;

  insert into participant_withdrawals (username, amount_usd, payment_method, payment_details, status, created_at)
  values (v_username, p_amount, p_method, p_details, 'pending', now())
  returning id into v_id;

  return query select v_id, v_available - p_amount;
end;
$$;
