-- ============================================================================
-- Multi-currency marketplace listings (owner decision, 17 October 2026)
-- ============================================================================
-- Additive. Run after add_affiliate_marketplace.sql.
--
-- Rules:
--   * The SELLER chooses the listing currency. The asking price stays exactly
--     as entered until the seller edits it; buyers only see equivalents.
--   * The currency decides the checkout route and the settlement currency:
--       NGN            -> Paystack, charged in NGN, seller settled in NGN
--       USD and others -> USDT, charged the USD equivalent, seller settled in USD
--     (configurable per currency in marketplace_currencies; new currencies can
--     be added without code).
--   * Conversion happens once, in a checkout quote with an expiry. When the
--     order is written its financial snapshot is frozen (order_financial_snapshots,
--     append-only) and nothing is ever recalculated from a later rate.
--   * Dream Coins, digital products and every Google Play product are not
--     affected: they stay in USD.
--
-- Until the protected checkout patch (P7) is applied, sellers can only list in
-- USD (currency_settings.listing_currencies_enabled = false), because the
-- current checkout charges price_usd.
--
-- Also makes the partner earnings ledger and payouts currency-aware (one
-- balance per source AND currency), so affiliate commission on an NGN sale is
-- owed in NGN. Existing rows are USD. Zero ledger rows exist in production
-- (checked 17 October 2026).
-- ============================================================================

do $$
begin
  if to_regclass('public.affiliate_attributions') is null then raise exception 'Run add_affiliate_marketplace.sql first'; end if;
end $$;

-- ----------------------------------------------------------------------------
-- Currencies and settings
-- ----------------------------------------------------------------------------
create table if not exists marketplace_currencies (
  code text primary key check (code ~ '^[A-Z]{3}$'),
  name text not null,
  symbol text not null,
  minor_units smallint not null default 2 check (minor_units between 0 and 3),
  checkout_route text not null check (checkout_route in ('paystack', 'usdt')),
  settlement_currency text not null check (settlement_currency in ('NGN', 'USD')),
  is_enabled boolean not null default true,
  sort_order integer not null default 100,
  constraint marketplace_currencies_route check (
    (checkout_route = 'paystack' and settlement_currency = 'NGN' and code = 'NGN')
    or (checkout_route = 'usdt' and settlement_currency = 'USD'))
);

insert into marketplace_currencies (code, name, symbol, minor_units, checkout_route, settlement_currency, sort_order) values
  ('NGN', 'Nigerian naira', '₦', 2, 'paystack', 'NGN', 10),
  ('USD', 'US dollar', '$', 2, 'usdt', 'USD', 20),
  ('GBP', 'British pound', '£', 2, 'usdt', 'USD', 30),
  ('EUR', 'Euro', '€', 2, 'usdt', 'USD', 40),
  ('GHS', 'Ghanaian cedi', 'GH₵', 2, 'usdt', 'USD', 50)
on conflict (code) do nothing;

create table if not exists currency_settings (
  id boolean primary key default true check (id),
  -- Sellers may choose a currency other than USD. Switch on only with P7.
  listing_currencies_enabled boolean not null default false,
  quote_ttl_seconds integer not null default 900 check (quote_ttl_seconds between 60 and 86400),
  usdt_quote_ttl_seconds integer not null default 3600 check (usdt_quote_ttl_seconds between 60 and 86400),
  -- The provider (open.er-api.com) publishes once a day: refuse rates older than this.
  max_rate_age_seconds integer not null default 93600 check (max_rate_age_seconds between 60 and 604800),
  -- Refuse a new rate that jumps more than this from the previous one (bad feed protection).
  max_rate_jump_percent numeric(5,2) not null default 15 check (max_rate_jump_percent between 1 and 100),
  updated_at timestamptz not null default now(),
  updated_by uuid
);
insert into currency_settings (id) values (true) on conflict (id) do nothing;

-- Rates: units of `quote` per 1 USD, as published by the source.
create table if not exists currency_rates (
  id bigint generated always as identity primary key,
  quote text not null references marketplace_currencies(code),
  rate numeric(24,12) not null check (rate > 0),
  source text not null,
  source_published_at timestamptz not null,
  fetched_at timestamptz not null default now(),
  constraint currency_rates_once unique (quote, source, source_published_at)
);
create index if not exists currency_rates_latest on currency_rates (quote, source_published_at desc);

-- ----------------------------------------------------------------------------
-- Listings: the seller's own currency and price
-- ----------------------------------------------------------------------------
alter table catalogue_items add column if not exists listing_currency text not null default 'USD' references marketplace_currencies(code);
-- Price in the listing currency's minor units (kobo, cents, pence...). For USD
-- listings it always equals price_usd. For other currencies price_usd holds
-- only an indicative USD equivalent (search and sorting), never what is charged.
alter table catalogue_items add column if not exists listing_price_minor bigint check (listing_price_minor is null or listing_price_minor > 0);
update catalogue_items set listing_price_minor = round(price_usd * 100)::bigint
 where listing_price_minor is null and listing_currency = 'USD' and price_usd > 0;

-- Listings edited through the existing listing form (price_usd) keep their
-- minor-unit price in step while they are USD listings. Non-USD listings are
-- priced only through listing_price_minor.
create or replace function catalogue_items_sync_usd_price()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.listing_currency = 'USD' and new.price_usd is not null and new.price_usd > 0 then
    new.listing_price_minor := round(new.price_usd * 100)::bigint;
  end if;
  return new;
end;
$$;
drop trigger if exists catalogue_items_sync_usd_price on catalogue_items;
create trigger catalogue_items_sync_usd_price before insert or update of price_usd, listing_currency on catalogue_items
  for each row execute function catalogue_items_sync_usd_price();

-- ----------------------------------------------------------------------------
-- Checkout quotes and frozen order snapshots
-- ----------------------------------------------------------------------------
create table if not exists checkout_quotes (
  id uuid primary key default gen_random_uuid(),
  client_key text not null unique check (client_key ~ '^[A-Za-z0-9_-]{8,80}$'),
  checkout_currency text not null check (checkout_currency in ('NGN', 'USD')),
  checkout_route text not null check (checkout_route in ('paystack', 'usdt')),
  lines jsonb not null,                       -- per line: listing price, rate, converted amounts, commission, earnings
  subtotal_minor bigint not null check (subtotal_minor > 0),
  service_fee_minor bigint not null default 0 check (service_fee_minor >= 0),
  total_minor bigint not null,
  rates jsonb not null default '{}',          -- {GBP: {rate, source, published_at, id}}
  quoted_at timestamptz not null default now(),
  expires_at timestamptz not null,
  status text not null default 'open' check (status in ('open', 'used', 'expired')),
  payment_ref text unique,
  used_at timestamptz,
  constraint checkout_quotes_total check (total_minor = subtotal_minor + service_fee_minor)
);
create index if not exists checkout_quotes_open on checkout_quotes (expires_at) where status = 'open';

create table if not exists order_financial_snapshots (
  order_id uuid primary key,
  quote_id uuid references checkout_quotes(id),
  listing_currency text not null,
  listing_unit_minor bigint not null,
  quantity integer not null check (quantity > 0),
  listing_line_minor bigint not null,
  rate_per_usd numeric(24,12),               -- listing currency per USD (null when no conversion)
  rate_source text,
  rate_published_at timestamptz,
  checkout_currency text not null check (checkout_currency in ('NGN', 'USD')),
  charged_minor bigint not null check (charged_minor > 0),   -- this line's share of the buyer's payment, before the service fee
  commission_percent numeric(5,2) not null,
  commission_minor bigint not null check (commission_minor >= 0),
  seller_earnings_minor bigint not null,
  settlement_currency text not null check (settlement_currency in ('NGN', 'USD')),
  usd_equivalent_micro bigint not null,      -- reporting and USD budgets only
  created_at timestamptz not null default now(),
  constraint order_financial_snapshots_split check (commission_minor + seller_earnings_minor = charged_minor)
);
drop trigger if exists order_financial_snapshots_append_only on order_financial_snapshots;
create trigger order_financial_snapshots_append_only before update or delete on order_financial_snapshots
  for each row execute function dream_coins_append_only();

-- ----------------------------------------------------------------------------
-- Order money in its settlement currency (snapshot if present, else legacy USD)
-- Amounts in micro units of that currency (1e-6), matching the earnings ledger.
-- ----------------------------------------------------------------------------
create or replace function order_money(p_order_id uuid,
  out currency text, out gross_micro bigint, out platform_micro bigint,
  out usd_gross_micro bigint, out usd_platform_micro bigint)
language plpgsql
stable
set search_path = public
as $$
declare
  s order_financial_snapshots%rowtype;
  o jsonb;
  scale bigint;
begin
  select * into s from order_financial_snapshots where order_id = p_order_id;
  if found then
    select (10 ^ (6 - minor_units))::bigint into scale from marketplace_currencies where code = s.settlement_currency;
    currency := s.settlement_currency;
    gross_micro := s.charged_minor * coalesce(scale, 10000);
    platform_micro := s.commission_minor * coalesce(scale, 10000);
    usd_gross_micro := s.usd_equivalent_micro;
    usd_platform_micro := case when s.charged_minor > 0 then (s.usd_equivalent_micro * s.commission_minor / s.charged_minor) else 0 end;
    return;
  end if;
  select to_jsonb(co) into o from catalogue_orders co where co.id = p_order_id;
  currency := 'USD';
  gross_micro := round(coalesce((o->>'amount_usd')::numeric, 0) * 1000000)::bigint;
  platform_micro := round(coalesce((o->>'commission_usd')::numeric, 0) * 1000000)::bigint;
  usd_gross_micro := gross_micro;
  usd_platform_micro := platform_micro;
end;
$$;

/** Seller earnings per settlement currency (read only; the protected wallet keeps working as before). */
create or replace function seller_earnings_by_currency(p_username text)
returns table (currency text, pending_micro bigint, on_hold_micro bigint, withdrawable_micro bigint, orders integer)
language sql
stable
set search_path = public
as $$
  with o as (
    select co.status,
           coalesce(s.settlement_currency, 'USD') as currency,
           case when s.order_id is not null
                then s.seller_earnings_minor * (10 ^ (6 - mc.minor_units))::bigint
                else round(coalesce(co.seller_net_usd, 0) * 1000000)::bigint end as net_micro
      from catalogue_orders co
      left join order_financial_snapshots s on s.order_id = co.id
      left join marketplace_currencies mc on mc.code = s.settlement_currency
     where co.seller_username = p_username
  )
  select currency,
         coalesce(sum(net_micro) filter (where status in ('paid', 'pending_verification')), 0)::bigint,
         coalesce(sum(net_micro) filter (where status = 'disputed'), 0)::bigint,
         coalesce(sum(net_micro) filter (where status in ('buyer_confirmed', 'released')), 0)::bigint,
         count(*)::int
    from o group by currency;
$$;

-- ----------------------------------------------------------------------------
-- Currency-aware earnings ledger, attributions, rewards and payouts
-- ----------------------------------------------------------------------------
alter table partner_ledger add column if not exists currency text not null default 'USD' check (currency in ('NGN', 'USD'));
alter table affiliate_attributions add column if not exists currency text not null default 'USD' check (currency in ('NGN', 'USD'));
alter table referral_rewards add column if not exists currency text not null default 'USD' check (currency in ('NGN', 'USD'));
alter table payout_requests add column if not exists currency text not null default 'USD' check (currency in ('NGN', 'USD'));
-- Reseller floors / ceilings / prices are in the listing's currency.
alter table affiliate_offers add column if not exists amount_currency text not null default 'USD' references marketplace_currencies(code);
drop index if exists partner_ledger_party;
create index if not exists partner_ledger_party on partner_ledger (party_type, party_id, source, currency);

drop function if exists partner_ledger_post(text, uuid, text, text, bigint, text, text, text, text, text, uuid);
create or replace function partner_ledger_post(
  p_party_type text, p_party_id uuid, p_source text, p_bucket text, p_amount bigint, p_entry text,
  p_ref_type text, p_ref_id text, p_key text, p_note text default null, p_admin uuid default null, p_currency text default 'USD')
returns boolean
language plpgsql
set search_path = public
as $$
declare inserted bigint;
begin
  if p_amount is null or p_amount = 0 or p_party_id is null then return false; end if;
  insert into partner_ledger (party_type, party_id, source, bucket, amount_micro, entry_type, ref_type, ref_id, idempotency_key, note, admin_id, currency)
  values (p_party_type, p_party_id, p_source, p_bucket, p_amount, p_entry, p_ref_type, p_ref_id, p_key, left(p_note, 500), p_admin, coalesce(p_currency, 'USD'))
  on conflict (idempotency_key) do nothing
  returning id into inserted;
  return inserted is not null;
end;
$$;

drop function if exists partner_ledger_move(text, uuid, text, text, text, bigint, text, text, text, text, text, uuid);
create or replace function partner_ledger_move(
  p_party_type text, p_party_id uuid, p_source text, p_from text, p_to text, p_amount bigint, p_entry text,
  p_ref_type text, p_ref_id text, p_key text, p_note text default null, p_admin uuid default null, p_currency text default 'USD')
returns boolean
language plpgsql
set search_path = public
as $$
begin
  if p_amount is null or p_amount = 0 then return false; end if;
  if not partner_ledger_post(p_party_type, p_party_id, p_source, p_from, -p_amount, p_entry, p_ref_type, p_ref_id, p_key || ':from', p_note, p_admin, p_currency) then
    return false;
  end if;
  perform partner_ledger_post(p_party_type, p_party_id, p_source, p_to, p_amount, p_entry, p_ref_type, p_ref_id, p_key || ':to', p_note, p_admin, p_currency);
  return true;
end;
$$;

drop function if exists partner_balances(text, uuid);
create or replace function partner_balances(p_party_type text, p_party_id uuid)
returns table (source text, currency text, pending bigint, available bigint, reserved bigint, paid bigint)
language sql
stable
set search_path = public
as $$
  select l.source, l.currency,
         coalesce(sum(l.amount_micro) filter (where l.bucket = 'pending'), 0)::bigint,
         coalesce(sum(l.amount_micro) filter (where l.bucket = 'available'), 0)::bigint,
         coalesce(sum(l.amount_micro) filter (where l.bucket = 'reserved'), 0)::bigint,
         coalesce(sum(l.amount_micro) filter (where l.bucket = 'paid'), 0)::bigint
    from partner_ledger l
   where l.party_type = p_party_type and l.party_id = p_party_id
   group by l.source, l.currency;
$$;

drop function if exists payout_request_create(text, uuid, text, bigint, text);
create or replace function payout_request_create(
  p_party_type text, p_party_id uuid, p_source text, p_amount bigint, p_client_request_id text, p_currency text default 'USD')
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
  minimum bigint;
begin
  perform pg_advisory_xact_lock(hashtext('payout:' || p_party_type || ':' || p_party_id || ':' || p_source || ':' || p_currency));

  select * into existing from payout_requests
   where party_type = p_party_type and party_id = p_party_id and client_request_id = p_client_request_id;
  if found then return jsonb_build_object('request_id', existing.id, 'already_requested', true, 'status', existing.status); end if;

  select * into s from earnings_settings where id;
  if not s.payouts_enabled then raise exception 'payouts_disabled'; end if;
  -- The minimum is set in USD; for NGN it is converted at the latest published rate.
  minimum := case when p_currency = 'USD' then s.min_payout_micro
                  else (s.min_payout_micro * coalesce((select rate from currency_rates where quote = p_currency order by source_published_at desc limit 1), 1))::bigint end;
  if p_amount is null or p_amount < minimum then raise exception 'below_minimum'; end if;

  select * into payee from payee_profiles where party_type = p_party_type and party_id = p_party_id;
  if not found then raise exception 'payee_profile_required'; end if;
  if payee.kyc_status <> 'verified' then raise exception 'payee_not_verified'; end if;
  if payee.date_of_birth > (current_date - interval '18 years') then raise exception 'payee_under_18'; end if;

  select coalesce(sum(amount_micro), 0) into avail from partner_ledger
   where party_type = p_party_type and party_id = p_party_id and source = p_source and currency = p_currency and bucket = 'available';
  if p_amount > avail then raise exception 'insufficient_available_balance'; end if;

  insert into payout_requests (party_type, party_id, source, amount_micro, client_request_id, payee_snapshot, currency)
  values (p_party_type, p_party_id, p_source, p_amount, p_client_request_id,
          jsonb_build_object('legal_name', payee.legal_name, 'country', payee.country, 'payout_method', payee.payout_method, 'payout_details', payee.payout_details),
          p_currency)
  returning id into new_id;

  perform partner_ledger_move(p_party_type, p_party_id, p_source, 'available', 'reserved', p_amount, 'payout_reserve',
                              'payout', new_id::text, 'payout:' || new_id || ':reserve', null, null, p_currency);
  insert into payout_events (request_id, event, details) values (new_id, 'requested', jsonb_build_object('amount_micro', p_amount, 'currency', p_currency));
  return jsonb_build_object('request_id', new_id, 'already_requested', false, 'status', 'requested');
end;
$$;

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
                                'payout', r.id::text, 'payout:' || r.id || ':paid', p_reference, p_admin, r.currency);
  elsif next_status in ('failed', 'rejected', 'cancelled') then
    perform partner_ledger_move(r.party_type, r.party_id, r.source, 'reserved', 'available', r.amount_micro, 'payout_release',
                                'payout', r.id::text, 'payout:' || r.id || ':release', p_reason, p_admin, r.currency);
  end if;
  insert into payout_events (request_id, event, admin_id, details)
  values (r.id, next_status, p_admin, jsonb_build_object('reference', p_reference, 'reason', p_reason));
  return jsonb_build_object('request_id', r.id, 'status', next_status);
end;
$$;

/** Platform money committed this calendar month, in USD (NGN items counted at their order's snapshot rate). */
create or replace function affiliate_platform_spend_this_month()
returns bigint
language sql
stable
set search_path = public
as $$
  select coalesce((select sum(case when a.currency = 'USD' or m.gross_micro = 0 then a.commission_micro
                                   else a.commission_micro * m.usd_gross_micro / m.gross_micro end)
                     from affiliate_attributions a cross join lateral order_money(a.order_id) m
                    where a.funding = 'platform' and a.status in ('pending', 'held', 'available')
                      and a.created_at >= date_trunc('month', now())), 0)
       + coalesce((select sum(case when r.currency = 'USD' or m.gross_micro = 0 then r.amount_micro
                                   else r.amount_micro * m.usd_gross_micro / m.gross_micro end)
                     from referral_rewards r cross join lateral order_money(r.order_id) m
                    where r.status = 'available' and r.created_at >= date_trunc('month', now())), 0);
$$;

/** Attribution in the order's settlement currency (replaces the USD-only version). */
create or replace function affiliate_attribute_order(p_order_id uuid, p_intent uuid, p_click_ids uuid[])
returns text
language plpgsql
set search_path = public
as $$
declare
  s earnings_settings%rowtype;
  ord jsonb;
  money record;
  ck record;
  o affiliate_offers%rowtype;
  m affiliate_memberships%rowtype;
  partner_username text;
  partner_email text;
  merchant_email text;
  v_model text;
  v_source text := 'affiliate';
  v_commission bigint := 0;
  v_status text := 'pending';
  v_reason text;
  v_usd bigint;
  partner_month bigint;
  inserted uuid;
begin
  select * into s from earnings_settings where id;
  select to_jsonb(co) into ord from catalogue_orders co where co.id = p_order_id;
  if ord is null then return 'order_missing'; end if;
  if exists (select 1 from affiliate_attributions where order_id = p_order_id) then return 'already_attributed'; end if;
  select * into money from order_money(p_order_id);

  select c.*, ap.participant_id into ck
    from affiliate_clicks c join affiliate_partners ap on ap.id = c.partner_id
   where c.id = any(p_click_ids) and c.item_id = (ord->>'item_id')::uuid
     and c.created_at <= (ord->>'created_at')::timestamptz
     and c.created_at >= (ord->>'created_at')::timestamptz - make_interval(days => s.affiliate_attribution_days)
     and ap.status = 'active'
   order by c.created_at desc limit 1;
  if not found then return 'no_matching_click'; end if;

  select * into m from affiliate_memberships where id = ck.membership_id;
  select * into o from affiliate_offers where id = m.offer_id;
  if m.status <> 'approved' then return 'membership_inactive'; end if;

  select username, email into partner_username, partner_email from participants where id = ck.participant_id;
  select rm.email into merchant_email from merchant_participant_links mpl join referral_merchants rm on rm.id = mpl.merchant_id
   where mpl.participant_id = ck.participant_id;
  v_model := m.model;

  if lower(partner_username) = lower(ord->>'seller_username') then
    v_status := 'excluded'; v_reason := 'partner_is_seller';
  elsif lower(coalesce(partner_email, '')) = lower(coalesce(ord->>'buyer_email', '-'))
     or lower(coalesce(merchant_email, '')) = lower(coalesce(ord->>'buyer_email', '-')) then
    v_status := 'excluded'; v_reason := 'partner_is_buyer';
  elsif v_model = 'resale' then
    if s.resale_checkout_enabled and (ord->>'resale_membership_id') = m.id::text then
      v_source := 'resale';
      v_commission := greatest(0, round(((ord->>'resale_price_usd')::numeric - (ord->>'resale_floor_usd')::numeric)
                                        * coalesce((ord->>'quantity')::integer, 1) * 1000000)::bigint
                                  - round(coalesce((ord->>'resale_platform_fee_usd')::numeric, 0) * 1000000)::bigint);
    elsif o.allow_referral then
      v_model := 'referral';
    else
      v_status := 'awaiting_resale_checkout'; v_reason := 'reseller pricing needs P3';
    end if;
  end if;

  if v_status = 'pending' and v_source = 'affiliate' then
    v_commission := floor(money.gross_micro * o.commission_percent / 100)::bigint;
    if o.funding = 'seller' then
      v_commission := least(v_commission, greatest(0, money.gross_micro - money.platform_micro));
      if not s.seller_funded_settlement_enabled then
        v_status := 'awaiting_seller_settlement'; v_reason := 'seller-funded commission needs P1';
      end if;
    else
      v_commission := least(v_commission, floor(money.platform_micro * s.platform_share_max_percent / 100)::bigint);
      v_usd := case when money.gross_micro > 0 then v_commission * money.usd_gross_micro / money.gross_micro else 0 end;
      if affiliate_platform_spend_this_month() + v_usd > s.platform_monthly_budget_micro then
        v_status := 'over_budget'; v_reason := 'monthly platform budget reached'; v_commission := 0;
      end if;
    end if;
  end if;

  if v_status = 'pending' and s.partner_monthly_cap_micro is not null then
    -- The cap is in USD: compare USD equivalents.
    select coalesce(sum(case when a.currency = 'USD' or om.gross_micro = 0 then a.commission_micro
                             else a.commission_micro * om.usd_gross_micro / om.gross_micro end), 0) into partner_month
      from affiliate_attributions a cross join lateral order_money(a.order_id) om
     where a.partner_id = ck.partner_id and a.status in ('pending', 'held', 'available') and a.created_at >= date_trunc('month', now());
    if partner_month + (case when money.gross_micro > 0 then v_commission * money.usd_gross_micro / money.gross_micro else 0 end) > s.partner_monthly_cap_micro then
      v_status := 'over_cap'; v_reason := 'partner monthly cap reached'; v_commission := 0;
    end if;
  end if;
  if v_status = 'pending' and v_commission = 0 then v_status := 'excluded'; v_reason := coalesce(v_reason, 'zero commission'); end if;

  insert into affiliate_attributions (order_id, intent_id, click_id, partner_id, membership_id, offer_id, model, funding, source,
    gross_micro, platform_commission_micro, commission_percent, commission_micro, status, status_reason, currency)
  values (p_order_id, p_intent, ck.id, ck.partner_id, m.id, o.id, v_model, o.funding, v_source,
    money.gross_micro, money.platform_micro, o.commission_percent,
    case when v_status in ('pending', 'awaiting_seller_settlement') then v_commission else 0 end, v_status, v_reason, money.currency)
  on conflict (order_id) do nothing
  returning id into inserted;
  if inserted is null then return 'already_attributed'; end if;

  if v_status = 'pending' then
    perform partner_ledger_post('participant', ck.participant_id, v_source, 'pending', v_commission, 'accrue',
                                'attribution', inserted::text, 'attribution:' || inserted || ':accrue', null, null, money.currency);
  end if;
  return v_status;
end;
$$;

create or replace function affiliate_advance(p_limit integer default 500)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  a record;
  participant uuid;
  released integer := 0;
  held integer := 0;
  rewards integer;
begin
  for a in select at.*, co.status as order_status from affiliate_attributions at
             join catalogue_orders co on co.id = at.order_id
            where at.status in ('pending', 'held') order by at.created_at limit p_limit for update of at loop
    select participant_id into participant from affiliate_partners where id = a.partner_id;
    if a.order_status in ('buyer_confirmed', 'released') then
      perform partner_ledger_move('participant', participant, a.source, 'pending', 'available', a.commission_micro, 'release',
                                  'attribution', a.id::text, 'attribution:' || a.id || ':release', null, null, a.currency);
      update affiliate_attributions set status = 'available', released_at = now() where id = a.id;
      released := released + 1;
    elsif a.order_status = 'disputed' and a.status <> 'held' then
      update affiliate_attributions set status = 'held', status_reason = 'order disputed' where id = a.id;
      held := held + 1;
    elsif a.order_status in ('paid', 'pending_verification') and a.status = 'held' then
      update affiliate_attributions set status = 'pending', status_reason = null where id = a.id;
    end if;
  end loop;
  rewards := referral_rewards_process();
  return jsonb_build_object('released', released, 'held', held, 'referral_rewards', rewards);
end;
$$;

create or replace function referral_rewards_process()
returns integer
language plpgsql
set search_path = public
as $$
declare
  s earnings_settings%rowtype;
  o record;
  money record;
  seller record;
  buyer record;
  order_budget bigint;
  used bigint;
  amount bigint;
  amount_usd bigint;
  n integer := 0;
  rid uuid;
begin
  select * into s from earnings_settings where id;
  for o in select co.* from catalogue_orders co
            where co.status in ('buyer_confirmed', 'released') and coalesce(co.updated_at, co.created_at) > now() - interval '60 days'
              and not exists (select 1 from referral_rewards rr where rr.order_id = co.id)
            order by co.created_at limit 1000 loop
    rid := null;
    select * into money from order_money(o.id);
    order_budget := floor(money.platform_micro * s.platform_share_max_percent / 100)::bigint;
    select coalesce(sum(commission_micro), 0) into used from affiliate_attributions
     where order_id = o.id and funding = 'platform' and status in ('pending', 'held', 'available');

    select p.id, p.created_at, ml.merchant_id, rm.email as merchant_email into seller
      from participants p join merchant_referral_links ml on ml.id = p.referred_by_merchant_link_id
      join referral_merchants rm on rm.id = ml.merchant_id
     where lower(p.username) = lower(o.seller_username);
    if found and s.seller_referral_percent > 0
       and o.created_at < seller.created_at + make_interval(months => s.seller_referral_months)
       and not exists (select 1 from affiliate_attributions at join affiliate_partners ap on ap.id = at.partner_id
                        join merchant_participant_links mpl on mpl.participant_id = ap.participant_id
                        where at.order_id = o.id and mpl.merchant_id = seller.merchant_id and at.status in ('pending', 'held', 'available'))
       and not exists (select 1 from merchant_participant_links mpl where mpl.merchant_id = seller.merchant_id and mpl.participant_id = seller.id)
       and lower(seller.merchant_email) <> lower(coalesce(o.buyer_email, '-')) then
      amount := least(floor(money.platform_micro * s.seller_referral_percent / 100)::bigint, greatest(0, order_budget - used));
      amount_usd := case when money.gross_micro > 0 then amount * money.usd_gross_micro / money.gross_micro else 0 end;
      if amount > 0 and affiliate_platform_spend_this_month() + amount_usd <= s.platform_monthly_budget_micro then
        insert into referral_rewards (kind, merchant_id, referred_participant_id, order_id, amount_micro, currency)
        values ('seller', seller.merchant_id, seller.id, o.id, amount, money.currency)
        on conflict do nothing returning id into rid;
        if rid is not null then
          perform partner_ledger_post('merchant', seller.merchant_id, 'referral', 'available', amount, 'accrue',
                                      'referral_reward', rid::text, 'referral:' || rid, null, null, money.currency);
          used := used + amount; n := n + 1;
        end if;
      end if;
    end if;

    rid := null;
    if s.buyer_referral_reward_micro > 0 and not exists (select 1 from affiliate_attributions where order_id = o.id) then
      select p.id, ml.merchant_id, rm.email as merchant_email into buyer
        from participants p join merchant_referral_links ml on ml.id = p.referred_by_merchant_link_id
        join referral_merchants rm on rm.id = ml.merchant_id
       where lower(p.email) = lower(coalesce(o.buyer_email, '-'));
      if found and lower(buyer.merchant_email) <> lower(o.buyer_email)
         and not exists (select 1 from referral_rewards where kind = 'buyer' and referred_participant_id = buyer.id) then
        -- The buyer reward is set in USD and paid in USD.
        amount := least(s.buyer_referral_reward_micro,
                        greatest(0, case when money.gross_micro > 0 then (order_budget - used) * money.usd_gross_micro / money.gross_micro else 0 end));
        if amount > 0 and affiliate_platform_spend_this_month() + amount <= s.platform_monthly_budget_micro then
          insert into referral_rewards (kind, merchant_id, referred_participant_id, order_id, amount_micro, currency)
          values ('buyer', buyer.merchant_id, buyer.id, o.id, amount, 'USD')
          on conflict do nothing returning id into rid;
          if rid is not null then
            perform partner_ledger_post('merchant', buyer.merchant_id, 'referral', 'available', amount, 'accrue',
                                        'referral_reward', rid::text, 'referral:' || rid, null, null, 'USD');
            n := n + 1;
          end if;
        end if;
      end if;
    end if;
  end loop;
  return n;
end;
$$;

create or replace function affiliate_reverse_attribution(p_id uuid, p_admin uuid, p_reason text)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  a affiliate_attributions%rowtype;
  participant uuid;
begin
  select * into a from affiliate_attributions where id = p_id for update;
  if not found then raise exception 'attribution_not_found'; end if;
  if a.status = 'reversed' then return jsonb_build_object('already_reversed', true); end if;
  select participant_id into participant from affiliate_partners where id = a.partner_id;
  if a.status in ('pending', 'held', 'available') then
    perform partner_ledger_post('participant', participant, a.source, case when a.status = 'available' then 'available' else 'pending' end,
                                -a.commission_micro, 'reverse', 'attribution', a.id::text, 'attribution:' || a.id || ':reverse', p_reason, p_admin, a.currency);
  end if;
  update affiliate_attributions set status = 'reversed', status_reason = left(p_reason, 300), reversed_at = now() where id = a.id;
  insert into earnings_admin_audit (admin_id, action, target_type, target_id, details)
  values (p_admin, 'reverse_attribution', 'attribution', a.id::text, jsonb_build_object('reason', p_reason, 'amount_micro', a.commission_micro, 'currency', a.currency));
  return jsonb_build_object('already_reversed', false, 'amount_micro', a.commission_micro, 'currency', a.currency);
end;
$$;

create or replace function affiliate_release_held(p_id uuid, p_admin uuid, p_note text)
returns void
language plpgsql
set search_path = public
as $$
declare
  a affiliate_attributions%rowtype;
  participant uuid;
begin
  select * into a from affiliate_attributions where id = p_id for update;
  if not found or a.status <> 'held' then raise exception 'not_held'; end if;
  select participant_id into participant from affiliate_partners where id = a.partner_id;
  perform partner_ledger_move('participant', participant, a.source, 'pending', 'available', a.commission_micro, 'release',
                              'attribution', a.id::text, 'attribution:' || a.id || ':release', p_note, p_admin, a.currency);
  update affiliate_attributions set status = 'available', released_at = now(), status_reason = left(p_note, 300) where id = a.id;
  insert into earnings_admin_audit (admin_id, action, target_type, target_id, details)
  values (p_admin, 'release_held_attribution', 'attribution', a.id::text, jsonb_build_object('note', p_note));
end;
$$;

-- ----------------------------------------------------------------------------
-- Server-only access
-- ----------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['marketplace_currencies', 'currency_settings', 'currency_rates', 'checkout_quotes', 'order_financial_snapshots'] loop
    execute format('alter table %I enable row level security', t);
    execute format('revoke all on table %I from anon, authenticated, public', t);
    execute format('grant all on table %I to service_role', t);
  end loop;
end $$;

do $$
declare f text;
begin
  foreach f in array array[
    'order_money(uuid)', 'seller_earnings_by_currency(text)', 'catalogue_items_sync_usd_price()',
    'partner_ledger_post(text, uuid, text, text, bigint, text, text, text, text, text, uuid, text)',
    'partner_ledger_move(text, uuid, text, text, text, bigint, text, text, text, text, text, uuid, text)',
    'partner_balances(text, uuid)', 'payout_request_create(text, uuid, text, bigint, text, text)',
    'payout_request_decide(uuid, text, uuid, text, text)', 'affiliate_platform_spend_this_month()',
    'affiliate_attribute_order(uuid, uuid, uuid[])', 'affiliate_advance(integer)', 'referral_rewards_process()',
    'affiliate_reverse_attribution(uuid, uuid, text)', 'affiliate_release_held(uuid, uuid, text)'] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $$;

-- ----------------------------------------------------------------------------
-- Verification - every row must be ok = true
-- ----------------------------------------------------------------------------
with checks(check_name, ok) as (
  select 'table ' || t, to_regclass('public.' || t) is not null
    from unnest(array['marketplace_currencies', 'currency_settings', 'currency_rates', 'checkout_quotes', 'order_financial_snapshots']) t
  union all select 'NGN settles in NGN via Paystack', exists (select 1 from marketplace_currencies where code = 'NGN' and checkout_route = 'paystack' and settlement_currency = 'NGN')
  union all select 'every listing has a currency', not exists (select 1 from catalogue_items where listing_currency is null)
  union all select 'USD listings priced in minor units', not exists (select 1 from catalogue_items where listing_currency = 'USD' and price_usd > 0 and listing_price_minor is null)
  union all select 'listing currencies off until P7', not (select listing_currencies_enabled from currency_settings where id)
  union all select 'ledger has a currency', exists (select 1 from information_schema.columns where table_name = 'partner_ledger' and column_name = 'currency')
  union all select 'snapshots append-only', exists (select 1 from pg_trigger where tgname = 'order_financial_snapshots_append_only')
  union all select 'anon cannot read quotes', not has_table_privilege('anon', 'public.checkout_quotes', 'select')
)
select * from checks;
