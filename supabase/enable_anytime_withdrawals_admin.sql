-- ============================================================================
-- Anytime participant withdrawals, payout audit trail, admin accounts, and
-- participant/admin support messages.
-- ============================================================================
-- Run this file in the Supabase SQL editor AFTER
-- supabase/fix_participant_withdrawals_schema.sql.
--
-- This migration intentionally does NOT alter the earning formula or the
-- atomic balance check. It removes only the old "on/after the 28th" date
-- restriction, so a participant can request an available balance at any time.
-- A pending, processing, or claimed request still reserves its amount; only a
-- rejected request returns the amount to the participant's available balance.
-- ============================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Admin accounts. This is a separate account type: do not reuse participant
-- or merchant credentials for administration.
-- ---------------------------------------------------------------------------
create table if not exists admin_users (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  display_name text not null default 'Administrator',
  password_hash text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists admin_users_email_lower_key
  on admin_users (lower(email));

-- ---------------------------------------------------------------------------
-- Payout evidence on participant withdrawal requests. `claimed` is the final
-- state set only after an administrator confirms that a fiat or crypto payout
-- has actually been sent. Its reference, amount, currency, and network form
-- the audit trail for the transaction.
-- ---------------------------------------------------------------------------
alter table participant_withdrawals add column if not exists payout_type text;
alter table participant_withdrawals add column if not exists payout_currency text;
alter table participant_withdrawals add column if not exists payout_network text;
alter table participant_withdrawals add column if not exists payout_reference text;
alter table participant_withdrawals add column if not exists payout_amount numeric;
alter table participant_withdrawals add column if not exists payout_confirmed_at timestamptz;
alter table participant_withdrawals add column if not exists claimed_at timestamptz;
alter table participant_withdrawals add column if not exists claimed_by uuid references admin_users(id);
alter table participant_withdrawals add column if not exists admin_note text;

alter table participant_withdrawals
  drop constraint if exists participant_withdrawals_status_check;
alter table participant_withdrawals
  add constraint participant_withdrawals_status_check
  -- `paid` is retained for historical rows; new confirmed payouts use
  -- `claimed` so the admin, transaction reference, and payout type are
  -- recorded together.
  check (status in ('pending', 'processing', 'paid', 'claimed', 'rejected'));

alter table participant_withdrawals
  drop constraint if exists participant_withdrawals_payout_type_check;
alter table participant_withdrawals
  add constraint participant_withdrawals_payout_type_check
  check (payout_type is null or payout_type in ('fiat', 'crypto'));

create index if not exists participant_withdrawals_status_created_at_idx
  on participant_withdrawals (status, created_at desc);
create index if not exists participant_withdrawals_claimed_by_idx
  on participant_withdrawals (claimed_by)
  where claimed_by is not null;

-- ---------------------------------------------------------------------------
-- Private participant/admin conversation. `system` entries are created when
-- the administrator changes the payout state, so payment confirmation is
-- visible to the participant without relying on an external notification API.
-- ---------------------------------------------------------------------------
create table if not exists support_messages (
  id uuid primary key default gen_random_uuid(),
  participant_id uuid not null references participants(id) on delete cascade,
  admin_id uuid references admin_users(id) on delete set null,
  withdrawal_id uuid references participant_withdrawals(id) on delete set null,
  sender_type text not null check (sender_type in ('participant', 'admin', 'system')),
  message_type text not null default 'general'
    check (message_type in ('general', 'enquiry', 'payout_notification')),
  body text not null check (char_length(trim(body)) between 1 and 2000),
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists support_messages_participant_created_idx
  on support_messages (participant_id, created_at asc);
create index if not exists support_messages_withdrawal_idx
  on support_messages (withdrawal_id)
  where withdrawal_id is not null;

-- All reads/writes go through server routes using the service role. There are
-- deliberately no anon/authenticated policies: a participant must never be
-- able to read another participant's payout data or impersonate an admin.
alter table admin_users enable row level security;
alter table support_messages enable row level security;

-- Withdrawal history and payout details are private financial data. The web
-- dashboard and mobile app now read them through GET /api/onedream/withdraw,
-- which authenticates the participant and uses the service role. Remove the
-- earlier broad SELECT policy so neither the public anon key nor a browser
-- console can read everyone else's payment details.
alter table participant_withdrawals enable row level security;
drop policy if exists participant_withdrawals_select_all on participant_withdrawals;

-- ---------------------------------------------------------------------------
-- Replace the old function with the same atomic balance calculation but no
-- calendar/date restriction. `FOR UPDATE` prevents concurrent requests from
-- claiming the same available balance.
-- ---------------------------------------------------------------------------
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
  reward_rate_usd constant numeric := 1.00;
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
  where username = v_username and status <> 'rejected';

  v_available := v_earned - v_withdrawn;

  if p_amount <= 0 or p_amount > v_available then
    raise exception 'insufficient_balance';
  end if;

  insert into participant_withdrawals (
    username, amount_usd, payment_method, payment_details, status, created_at
  ) values (
    v_username, p_amount, p_method, p_details, 'pending', now()
  )
  returning id into v_id;

  return query select v_id, v_available - p_amount;
end;
$$;

-- ---------------------------------------------------------------------------
-- Create the first administrator after running the migration. Replace both
-- placeholder values before executing this statement. Use a unique password,
-- then remove the statement from your SQL-editor history if appropriate.
--
-- insert into admin_users (email, display_name, password_hash)
-- values (
--   lower('admin@example.com'),
--   'FlyMadd Administrator',
--   crypt('replace-with-a-long-unique-password', gen_salt('bf', 12))
-- );
-- ============================================================================
