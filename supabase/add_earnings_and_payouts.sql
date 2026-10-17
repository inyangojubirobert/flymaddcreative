-- ============================================================================
-- Partner & creator earnings: shared ledger, payees, payout requests
-- ============================================================================
-- Additive. Run after add_dream_coins_gifting.sql and before
-- add_gift_revenue_sharing.sql and add_affiliate_marketplace.sql.
--
-- One append-only ledger holds every monetary earning that is NOT a seller's
-- marketplace sale: Dream Coin gift earnings (recipients and their referring
-- merchants), marketplace affiliate commission, reseller margin and
-- referral rewards. Each row moves money between buckets for one party and
-- one source, so every source keeps its own balance:
--
--   pending   earned, not yet withdrawable (proceeds not settled / order not released)
--   available withdrawable
--   reserved  inside an open payout request
--   paid      paid out
--
-- Nothing here touches participant_withdrawals, merchant withdrawals, seller
-- earnings, Paystack, USDT or Google Play code. Payout requests are a new,
-- separate queue and stay switched off (earnings_settings.payouts_enabled)
-- until the payout provider, legal review and owner authorisation are in place.
--
-- Server-only: RLS on with no policies, no client-role privileges.
-- Verify with the query at the bottom (every row ok = true).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Settings (single row). Every value is snapshotted onto the records it
-- affects, so later edits never change past earnings.
-- ----------------------------------------------------------------------------
create table if not exists earnings_settings (
  id boolean primary key default true check (id),
  -- Activation gates (all off until the owner switches them on)
  gift_earnings_enabled boolean not null default false,          -- gifts create monetary earnings
  payouts_enabled boolean not null default false,                -- payout requests can be created
  seller_funded_settlement_enabled boolean not null default false, -- P1 applied: seller-funded commission deducted from seller earnings
  resale_checkout_enabled boolean not null default false,        -- P3 applied: checkout charges reseller prices
  -- Dream Coin gift revenue sharing (owner decision 17 Oct 2026)
  gift_value_basis text not null default 'net' check (gift_value_basis in ('net', 'gross')),
  gift_recipient_percent numeric(5,2) not null default 50 check (gift_recipient_percent between 0 and 100),
  gift_merchant_percent numeric(5,2) not null default 10 check (gift_merchant_percent between 0 and 100),
  gift_merchant_months integer not null default 12 check (gift_merchant_months between 0 and 120),
  -- Provisional estimate used only until Google's earnings report reconciles a
  -- lot. Defaults to the standard 30% service fee so provisional earnings are
  -- never overstated; lots enrolled in the 15% tier reconcile upward.
  gift_provisional_fee_percent numeric(5,2) not null default 30 check (gift_provisional_fee_percent between 0 and 100),
  -- Marketplace affiliate defaults (provisional rules, framework section 12)
  affiliate_max_commission_percent numeric(5,2) not null default 30 check (affiliate_max_commission_percent between 0 and 90),
  affiliate_attribution_days integer not null default 7 check (affiliate_attribution_days between 1 and 90),
  platform_share_max_percent numeric(5,2) not null default 50 check (platform_share_max_percent between 0 and 100),
  platform_monthly_budget_micro bigint not null default 0 check (platform_monthly_budget_micro >= 0),
  partner_monthly_cap_micro bigint check (partner_monthly_cap_micro is null or partner_monthly_cap_micro > 0),
  seller_referral_percent numeric(5,2) not null default 20 check (seller_referral_percent between 0 and 100),
  seller_referral_months integer not null default 6 check (seller_referral_months between 0 and 60),
  buyer_referral_reward_micro bigint not null default 0 check (buyer_referral_reward_micro >= 0),
  -- Payouts
  min_payout_micro bigint not null default 5000000 check (min_payout_micro > 0),
  updated_at timestamptz not null default now(),
  updated_by uuid,
  constraint earnings_settings_gift_split check (gift_recipient_percent + gift_merchant_percent <= 100)
);
insert into earnings_settings (id) values (true) on conflict (id) do nothing;

-- ----------------------------------------------------------------------------
-- One merchant account <-> one participant account (unified merchant identity).
-- referral_merchants keeps its own login; linking lets one person see every
-- earning stream in one dashboard and lets the rules spot self-dealing.
-- ----------------------------------------------------------------------------
create table if not exists merchant_participant_links (
  merchant_id uuid primary key references referral_merchants(id),
  participant_id uuid not null unique references participants(id),
  linked_at timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- Ledger (append-only)
-- ----------------------------------------------------------------------------
create table if not exists partner_ledger (
  id bigint generated always as identity primary key,
  party_type text not null check (party_type in ('participant', 'merchant')),
  party_id uuid not null,
  source text not null check (source in ('gift_recipient', 'gift_referral', 'affiliate', 'resale', 'referral')),
  bucket text not null check (bucket in ('pending', 'available', 'reserved', 'paid')),
  amount_micro bigint not null check (amount_micro <> 0),        -- USD millionths, signed
  entry_type text not null check (entry_type in ('accrue', 'reconcile', 'release', 'reverse', 'payout_reserve', 'payout_paid', 'payout_release', 'adjust')),
  ref_type text,
  ref_id text,
  idempotency_key text not null unique,
  note text,
  admin_id uuid,
  created_at timestamptz not null default now()
);
create index if not exists partner_ledger_party on partner_ledger (party_type, party_id, source);
create index if not exists partner_ledger_ref on partner_ledger (ref_type, ref_id);

do $$
begin
  if to_regproc('public.dream_coins_append_only') is null then
    raise exception 'Run add_dream_coins_gifting.sql first';
  end if;
end $$;
drop trigger if exists partner_ledger_append_only on partner_ledger;
create trigger partner_ledger_append_only before update or delete on partner_ledger
  for each row execute function dream_coins_append_only();

/** Posts one ledger row; a repeated key is a no-op. Returns true when written. */
create or replace function partner_ledger_post(
  p_party_type text, p_party_id uuid, p_source text, p_bucket text, p_amount bigint, p_entry text,
  p_ref_type text, p_ref_id text, p_key text, p_note text default null, p_admin uuid default null)
returns boolean
language plpgsql
set search_path = public
as $$
declare inserted bigint;
begin
  if p_amount is null or p_amount = 0 or p_party_id is null then return false; end if;
  insert into partner_ledger (party_type, party_id, source, bucket, amount_micro, entry_type, ref_type, ref_id, idempotency_key, note, admin_id)
  values (p_party_type, p_party_id, p_source, p_bucket, p_amount, p_entry, p_ref_type, p_ref_id, p_key, left(p_note, 500), p_admin)
  on conflict (idempotency_key) do nothing
  returning id into inserted;
  return inserted is not null;
end;
$$;

/** Moves an amount between two buckets of the same party and source (two rows, one key). */
create or replace function partner_ledger_move(
  p_party_type text, p_party_id uuid, p_source text, p_from text, p_to text, p_amount bigint, p_entry text,
  p_ref_type text, p_ref_id text, p_key text, p_note text default null, p_admin uuid default null)
returns boolean
language plpgsql
set search_path = public
as $$
begin
  if p_amount is null or p_amount = 0 then return false; end if;
  if not partner_ledger_post(p_party_type, p_party_id, p_source, p_from, -p_amount, p_entry, p_ref_type, p_ref_id, p_key || ':from', p_note, p_admin) then
    return false;
  end if;
  perform partner_ledger_post(p_party_type, p_party_id, p_source, p_to, p_amount, p_entry, p_ref_type, p_ref_id, p_key || ':to', p_note, p_admin);
  return true;
end;
$$;

create or replace function partner_balances(p_party_type text, p_party_id uuid)
returns table (source text, pending bigint, available bigint, reserved bigint, paid bigint)
language sql
stable
set search_path = public
as $$
  select l.source,
         coalesce(sum(l.amount_micro) filter (where l.bucket = 'pending'), 0)::bigint,
         coalesce(sum(l.amount_micro) filter (where l.bucket = 'available'), 0)::bigint,
         coalesce(sum(l.amount_micro) filter (where l.bucket = 'reserved'), 0)::bigint,
         coalesce(sum(l.amount_micro) filter (where l.bucket = 'paid'), 0)::bigint
    from partner_ledger l
   where l.party_type = p_party_type and l.party_id = p_party_id
   group by l.source;
$$;

-- ----------------------------------------------------------------------------
-- Payees (identity & payout eligibility)
-- ----------------------------------------------------------------------------
create table if not exists payee_profiles (
  id uuid primary key default gen_random_uuid(),
  party_type text not null check (party_type in ('participant', 'merchant')),
  party_id uuid not null,
  legal_name text not null check (char_length(legal_name) between 2 and 120),
  country text not null check (country ~ '^[A-Z]{2}$'),
  date_of_birth date not null,
  payout_method text not null check (char_length(payout_method) between 2 and 40),
  -- Masked / minimal: e.g. {"bank": "GTBank", "account_last4": "1234"}. Full
  -- account numbers belong with the payout provider, not in this table.
  payout_details jsonb not null default '{}',
  kyc_status text not null default 'submitted' check (kyc_status in ('submitted', 'verified', 'rejected')),
  kyc_note text,
  verified_by uuid,
  verified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint payee_profiles_party unique (party_type, party_id)
);

-- ----------------------------------------------------------------------------
-- Payout requests (separate from every existing withdrawal flow)
-- ----------------------------------------------------------------------------
create table if not exists payout_requests (
  id uuid primary key default gen_random_uuid(),
  party_type text not null check (party_type in ('participant', 'merchant')),
  party_id uuid not null,
  source text not null check (source in ('gift_recipient', 'gift_referral', 'affiliate', 'resale', 'referral')),
  amount_micro bigint not null check (amount_micro > 0),
  status text not null default 'requested' check (status in ('requested', 'approved', 'paid', 'failed', 'rejected', 'cancelled')),
  client_request_id text not null check (client_request_id ~ '^[A-Za-z0-9_-]{8,80}$'),
  payee_snapshot jsonb not null,
  external_reference text,
  failure_reason text,
  decided_by uuid,
  decided_at timestamptz,
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint payout_requests_idempotent unique (party_type, party_id, client_request_id)
);
create index if not exists payout_requests_status on payout_requests (status, created_at);

create table if not exists payout_events (
  id bigint generated always as identity primary key,
  request_id uuid not null references payout_requests(id),
  event text not null,
  admin_id uuid,
  details jsonb not null default '{}',
  created_at timestamptz not null default now()
);
drop trigger if exists payout_events_append_only on payout_events;
create trigger payout_events_append_only before update or delete on payout_events
  for each row execute function dream_coins_append_only();

create table if not exists earnings_admin_audit (
  id bigint generated always as identity primary key,
  admin_id uuid not null,
  action text not null,
  target_type text not null,
  target_id text,
  details jsonb not null default '{}',
  created_at timestamptz not null default now()
);
drop trigger if exists earnings_admin_audit_append_only on earnings_admin_audit;
create trigger earnings_admin_audit_append_only before update or delete on earnings_admin_audit
  for each row execute function dream_coins_append_only();

/**
 * Creates a payout request: payouts switched on, payee verified and 18+,
 * minimum met, amount within the available balance of that source.
 * Serialised per party+source; idempotent per client_request_id.
 */
create or replace function payout_request_create(
  p_party_type text, p_party_id uuid, p_source text, p_amount bigint, p_client_request_id text)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  s earnings_settings%rowtype;
  payee payee_profiles%rowtype;
  existing payout_requests%rowtype;
  avail bigint;
  new_id uuid;
begin
  perform pg_advisory_xact_lock(hashtext('payout:' || p_party_type || ':' || p_party_id || ':' || p_source));

  select * into existing from payout_requests
   where party_type = p_party_type and party_id = p_party_id and client_request_id = p_client_request_id;
  if found then return jsonb_build_object('request_id', existing.id, 'already_requested', true, 'status', existing.status); end if;

  select * into s from earnings_settings where id;
  if not s.payouts_enabled then raise exception 'payouts_disabled'; end if;
  if p_amount is null or p_amount < s.min_payout_micro then raise exception 'below_minimum'; end if;

  select * into payee from payee_profiles where party_type = p_party_type and party_id = p_party_id;
  if not found then raise exception 'payee_profile_required'; end if;
  if payee.kyc_status <> 'verified' then raise exception 'payee_not_verified'; end if;
  if payee.date_of_birth > (current_date - interval '18 years') then raise exception 'payee_under_18'; end if;

  select coalesce(sum(amount_micro), 0) into avail from partner_ledger
   where party_type = p_party_type and party_id = p_party_id and source = p_source and bucket = 'available';
  if p_amount > avail then raise exception 'insufficient_available_balance'; end if;

  insert into payout_requests (party_type, party_id, source, amount_micro, client_request_id, payee_snapshot)
  values (p_party_type, p_party_id, p_source, p_amount, p_client_request_id,
          jsonb_build_object('legal_name', payee.legal_name, 'country', payee.country, 'payout_method', payee.payout_method, 'payout_details', payee.payout_details))
  returning id into new_id;

  perform partner_ledger_move(p_party_type, p_party_id, p_source, 'available', 'reserved', p_amount, 'payout_reserve',
                              'payout', new_id::text, 'payout:' || new_id || ':reserve');
  insert into payout_events (request_id, event, details) values (new_id, 'requested', jsonb_build_object('amount_micro', p_amount));
  return jsonb_build_object('request_id', new_id, 'already_requested', false, 'status', 'requested');
end;
$$;

/** Admin transitions. reject / cancel / mark_failed return the money to available. */
create or replace function payout_request_decide(p_request_id uuid, p_action text, p_admin uuid, p_reference text, p_reason text)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  r payout_requests%rowtype;
  next_status text;
begin
  select * into r from payout_requests where id = p_request_id for update;
  if not found then raise exception 'payout_not_found'; end if;

  if p_action = 'approve' and r.status = 'requested' then next_status := 'approved';
  elsif p_action = 'mark_paid' and r.status = 'approved' then next_status := 'paid';
  elsif p_action = 'mark_failed' and r.status = 'approved' then next_status := 'failed';
  elsif p_action = 'reject' and r.status in ('requested', 'approved') then next_status := 'rejected';
  elsif p_action = 'cancel' and r.status = 'requested' then next_status := 'cancelled';
  else raise exception 'invalid_transition: % from %', p_action, r.status;
  end if;
  if next_status = 'paid' and coalesce(btrim(p_reference), '') = '' then raise exception 'reference_required'; end if;

  update payout_requests
     set status = next_status, decided_by = coalesce(p_admin, decided_by), decided_at = now(),
         external_reference = coalesce(nullif(btrim(p_reference), ''), external_reference),
         failure_reason = case when next_status in ('failed', 'rejected') then left(p_reason, 500) else failure_reason end,
         paid_at = case when next_status = 'paid' then now() else paid_at end,
         updated_at = now()
   where id = r.id;

  if next_status = 'paid' then
    perform partner_ledger_move(r.party_type, r.party_id, r.source, 'reserved', 'paid', r.amount_micro, 'payout_paid',
                                'payout', r.id::text, 'payout:' || r.id || ':paid', p_reference, p_admin);
  elsif next_status in ('failed', 'rejected', 'cancelled') then
    perform partner_ledger_move(r.party_type, r.party_id, r.source, 'reserved', 'available', r.amount_micro, 'payout_release',
                                'payout', r.id::text, 'payout:' || r.id || ':release', p_reason, p_admin);
  end if;
  insert into payout_events (request_id, event, admin_id, details)
  values (r.id, next_status, p_admin, jsonb_build_object('reference', p_reference, 'reason', p_reason));
  return jsonb_build_object('request_id', r.id, 'status', next_status);
end;
$$;

-- ----------------------------------------------------------------------------
-- Server-only access
-- ----------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['earnings_settings', 'merchant_participant_links', 'partner_ledger', 'payee_profiles',
                           'payout_requests', 'payout_events', 'earnings_admin_audit'] loop
    execute format('alter table %I enable row level security', t);
    execute format('revoke all on table %I from anon, authenticated, public', t);
    execute format('grant all on table %I to service_role', t);
  end loop;
end $$;

do $$
declare f text;
begin
  foreach f in array array[
    'partner_ledger_post(text, uuid, text, text, bigint, text, text, text, text, text, uuid)',
    'partner_ledger_move(text, uuid, text, text, text, bigint, text, text, text, text, text, uuid)',
    'partner_balances(text, uuid)',
    'payout_request_create(text, uuid, text, bigint, text)',
    'payout_request_decide(uuid, text, uuid, text, text)'] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $$;

-- ----------------------------------------------------------------------------
-- Verification - every row must be ok = true
-- ----------------------------------------------------------------------------
with checks(check_name, ok) as (
  select 'table ' || t, to_regclass('public.' || t) is not null
    from unnest(array['earnings_settings', 'merchant_participant_links', 'partner_ledger', 'payee_profiles',
                      'payout_requests', 'payout_events', 'earnings_admin_audit']) t
  union all select 'settings row', exists (select 1 from earnings_settings where id)
  union all select 'payouts off by default', not (select payouts_enabled from earnings_settings where id)
  union all select 'gift earnings off by default', not (select gift_earnings_enabled from earnings_settings where id)
  union all select 'ledger append-only', exists (select 1 from pg_trigger where tgname = 'partner_ledger_append_only')
  union all select 'anon cannot read ledger', not has_table_privilege('anon', 'public.partner_ledger', 'select')
  union all select 'authenticated cannot request payouts', not has_function_privilege('authenticated',
    'public.payout_request_create(text,uuid,text,bigint,text)', 'execute')
)
select * from checks;
