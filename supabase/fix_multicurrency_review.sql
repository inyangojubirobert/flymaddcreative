-- ============================================================================
-- Multi-currency: fixes from the review of add_multicurrency_listings.sql
-- ============================================================================
-- Run AFTER supabase/add_multicurrency_listings.sql. Idempotent: safe to run
-- again. Production had no quotes, snapshots, rates, ledger rows, payouts or
-- attributions when this was written (checked 17 Oct 2026), and every money
-- switch is off, so the new constraints apply to empty tables.
--
--  1. Payout minimum in naira: no fallback rate. Without a fresh NGN rate
--     the request is refused (rate_unavailable) instead of using 1. Only
--     USD and NGN are accepted.
--  2. Ledger moves are all-or-nothing: if the credit side isn't posted after
--     the debit was, the whole transaction is rolled back. Negative amounts
--     are refused; zero is still a no-op.
--  3. Reseller commission is computed only for USD-settled orders. The
--     reseller fields are USD; a resale order in another currency is recorded
--     as awaiting (no commission) instead of mixing currencies. Resale offers
--     must be USD.
--  4. Frozen order snapshots:
--       - must belong to a real order and to a paid quote (quote_id required);
--       - every figure must equal that quote's line for the order's listing,
--         and the order's checkout must carry the quote's payment reference;
--       - currencies must be compatible (route and settlement follow the
--         listing currency; settlement = checkout currency; no rate when
--         nothing is converted);
--       - one snapshot per order (primary key) - duplicates are refused.
--     Quotes are frozen once created: amounts, lines, rates, currency and
--     expiry can't change, and a payment reference can only be set once.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Payout minimum: no fallback rate
-- ----------------------------------------------------------------------------
create or replace function payout_request_create(
  p_party_type text, p_party_id uuid, p_source text, p_amount bigint, p_client_request_id text, p_currency text default 'USD')
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  s earnings_settings%rowtype;
  cs currency_settings%rowtype;
  payee payee_profiles%rowtype;
  existing payout_requests%rowtype;
  avail bigint;
  new_id uuid;
  minimum bigint;
  v_rate numeric;
begin
  if p_currency is null or p_currency not in ('USD', 'NGN') then raise exception 'unsupported_currency'; end if;
  perform pg_advisory_xact_lock(hashtext('payout:' || p_party_type || ':' || p_party_id || ':' || p_source || ':' || p_currency));

  select * into existing from payout_requests
   where party_type = p_party_type and party_id = p_party_id and client_request_id = p_client_request_id;
  if found then return jsonb_build_object('request_id', existing.id, 'already_requested', true, 'status', existing.status); end if;

  select * into s from earnings_settings where id;
  if not s.payouts_enabled then raise exception 'payouts_disabled'; end if;
  -- The minimum is set in USD. For NGN it is converted at the latest
  -- published rate, which must be recent; there is no fallback.
  if p_currency = 'USD' then
    minimum := s.min_payout_micro;
  else
    select * into cs from currency_settings where id;
    select r.rate into v_rate from currency_rates r
     where r.quote = p_currency
       and r.source_published_at >= now() - make_interval(secs => coalesce(cs.max_rate_age_seconds, 93600))
     order by r.source_published_at desc limit 1;
    if v_rate is null or v_rate <= 0 then raise exception 'rate_unavailable'; end if;
    minimum := ceil(s.min_payout_micro * v_rate)::bigint;
  end if;
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

  if not partner_ledger_move(p_party_type, p_party_id, p_source, 'available', 'reserved', p_amount, 'payout_reserve',
                             'payout', new_id::text, 'payout:' || new_id || ':reserve', null, null, p_currency) then
    raise exception 'ledger_move_failed';
  end if;
  insert into payout_events (request_id, event, details) values (new_id, 'requested', jsonb_build_object('amount_micro', p_amount, 'currency', p_currency));
  return jsonb_build_object('request_id', new_id, 'already_requested', false, 'status', 'requested');
end;
$$;

-- ----------------------------------------------------------------------------
-- 2. Ledger moves: both sides or neither
-- ----------------------------------------------------------------------------
-- Returns false (posting nothing) only when this exact move was already
-- made - the idempotent replay. A debit without its credit raises, which
-- rolls back the caller's whole transaction.
create or replace function partner_ledger_move(
  p_party_type text, p_party_id uuid, p_source text, p_from text, p_to text, p_amount bigint, p_entry text,
  p_ref_type text, p_ref_id text, p_key text, p_note text default null, p_admin uuid default null, p_currency text default 'USD')
returns boolean
language plpgsql
set search_path = public
as $$
begin
  if p_amount is null or p_amount = 0 then return false; end if;   -- nothing to move (e.g. a fully reversed gift)
  if p_amount < 0 then raise exception 'ledger_move_amount_invalid'; end if;
  if p_from = p_to then raise exception 'ledger_move_same_bucket'; end if;
  if p_currency is null or p_currency not in ('USD', 'NGN') then raise exception 'unsupported_currency'; end if;
  if not partner_ledger_post(p_party_type, p_party_id, p_source, p_from, -p_amount, p_entry, p_ref_type, p_ref_id, p_key || ':from', p_note, p_admin, p_currency) then
    -- Already moved: the credit must already exist too.
    if not exists (select 1 from partner_ledger where idempotency_key = p_key || ':to') then
      raise exception 'ledger_move_incomplete:%', p_key;
    end if;
    return false;
  end if;
  if not partner_ledger_post(p_party_type, p_party_id, p_source, p_to, p_amount, p_entry, p_ref_type, p_ref_id, p_key || ':to', p_note, p_admin, p_currency) then
    raise exception 'ledger_move_credit_not_posted:%', p_key;
  end if;
  return true;
end;
$$;

-- ----------------------------------------------------------------------------
-- 3. Reseller commission: USD-settled orders only; resale offers are USD
-- ----------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'affiliate_offers_resale_usd') then
    alter table affiliate_offers add constraint affiliate_offers_resale_usd check (not allow_resale or amount_currency = 'USD');
  end if;
end $$;

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
    -- Reseller prices and floors are USD: only a USD-settled order is split.
    if s.resale_checkout_enabled and (ord->>'resale_membership_id') = m.id::text and money.currency = 'USD' then
      v_source := 'resale';
      v_commission := greatest(0, round(((ord->>'resale_price_usd')::numeric - (ord->>'resale_floor_usd')::numeric)
                                        * coalesce((ord->>'quantity')::integer, 1) * 1000000)::bigint
                                  - round(coalesce((ord->>'resale_platform_fee_usd')::numeric, 0) * 1000000)::bigint);
    elsif o.allow_referral then
      v_model := 'referral';
    elsif money.currency <> 'USD' then
      v_status := 'awaiting_resale_checkout'; v_reason := 'reseller pricing is USD only';
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

-- ----------------------------------------------------------------------------
-- 4. Quotes are frozen; snapshots must match a paid quote exactly
-- ----------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'checkout_quotes_route') then
    alter table checkout_quotes add constraint checkout_quotes_route
      check ((checkout_currency = 'NGN' and checkout_route = 'paystack') or (checkout_currency = 'USD' and checkout_route = 'usdt'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'checkout_quotes_lines') then
    alter table checkout_quotes add constraint checkout_quotes_lines
      check (jsonb_typeof(lines) = 'array' and jsonb_array_length(lines) between 1 and 20);
  end if;
end $$;

create or replace function checkout_quotes_freeze()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.client_key is distinct from old.client_key or new.checkout_currency is distinct from old.checkout_currency
     or new.checkout_route is distinct from old.checkout_route or new.lines is distinct from old.lines
     or new.subtotal_minor is distinct from old.subtotal_minor or new.service_fee_minor is distinct from old.service_fee_minor
     or new.total_minor is distinct from old.total_minor or new.rates is distinct from old.rates
     or new.quoted_at is distinct from old.quoted_at or new.expires_at is distinct from old.expires_at then
    raise exception 'checkout_quote_frozen';
  end if;
  if old.payment_ref is not null and new.payment_ref is distinct from old.payment_ref then
    raise exception 'checkout_quote_already_bound';
  end if;
  return new;
end;
$$;
drop trigger if exists checkout_quotes_freeze on checkout_quotes;
create trigger checkout_quotes_freeze before update on checkout_quotes
  for each row execute function checkout_quotes_freeze();

do $$
begin
  if exists (select 1 from order_financial_snapshots where quote_id is null) then
    raise exception 'Snapshots without a quote exist - review them before tightening';
  end if;
end $$;
alter table order_financial_snapshots alter column quote_id set not null;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'order_financial_snapshots_order_fk') then
    alter table order_financial_snapshots add constraint order_financial_snapshots_order_fk
      foreign key (order_id) references catalogue_orders(id);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'order_financial_snapshots_listing_currency_fk') then
    alter table order_financial_snapshots add constraint order_financial_snapshots_listing_currency_fk
      foreign key (listing_currency) references marketplace_currencies(code);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'order_financial_snapshots_consistent') then
    alter table order_financial_snapshots add constraint order_financial_snapshots_consistent check (
      settlement_currency = checkout_currency
      and listing_unit_minor > 0
      and listing_line_minor = listing_unit_minor * quantity
      and seller_earnings_minor >= 0
      and usd_equivalent_micro > 0
      -- naira is never converted; every other currency is paid in US dollars
      and ((listing_currency = 'NGN') = (checkout_currency = 'NGN'))
      -- a rate is recorded exactly when the price was converted
      and ((listing_currency = checkout_currency) = (rate_per_usd is null))
      and (listing_currency <> checkout_currency or charged_minor = listing_line_minor)
    );
  end if;
end $$;

-- Every figure must come from the paid quote for this order's listing, and
-- the order's checkout must be the payment the quote was bound to.
create or replace function order_financial_snapshots_verify()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  q checkout_quotes%rowtype;
  c marketplace_currencies%rowtype;
  v_item uuid;
  v_checkout_ref text;
  line jsonb;
begin
  select * into q from checkout_quotes where id = new.quote_id;
  if not found then raise exception 'snapshot_quote_missing'; end if;
  if q.payment_ref is null then raise exception 'snapshot_quote_unpaid'; end if;
  if q.checkout_currency <> new.checkout_currency then raise exception 'snapshot_currency_mismatch'; end if;

  select co.item_id, cc.payment_ref into v_item, v_checkout_ref
    from catalogue_orders co left join catalogue_checkouts cc on cc.id = co.checkout_id
   where co.id = new.order_id;
  if v_item is null then raise exception 'snapshot_order_missing'; end if;
  if v_checkout_ref is distinct from q.payment_ref then raise exception 'snapshot_payment_mismatch'; end if;

  select l into line from jsonb_array_elements(q.lines) l where l->>'item_id' = v_item::text limit 1;
  if line is null then raise exception 'snapshot_line_missing'; end if;
  if (line->>'quantity')::integer <> new.quantity
     or line->>'listing_currency' <> new.listing_currency
     or (line->>'listing_unit_minor')::bigint <> new.listing_unit_minor
     or (line->>'listing_line_minor')::bigint <> new.listing_line_minor
     or (line->>'charged_minor')::bigint <> new.charged_minor
     or (line->>'commission_minor')::bigint <> new.commission_minor
     or (line->>'seller_earnings_minor')::bigint <> new.seller_earnings_minor
     or (line->>'usd_equivalent_micro')::bigint <> new.usd_equivalent_micro
     or (line->>'rate_per_usd')::numeric is distinct from new.rate_per_usd
     or line->>'settlement_currency' <> new.settlement_currency then
    raise exception 'snapshot_quote_mismatch';
  end if;

  select * into c from marketplace_currencies where code = new.listing_currency;
  if not found or c.checkout_route <> q.checkout_route or c.settlement_currency <> new.settlement_currency then
    raise exception 'snapshot_route_mismatch';
  end if;
  return new;
end;
$$;
drop trigger if exists order_financial_snapshots_verify on order_financial_snapshots;
create trigger order_financial_snapshots_verify before insert on order_financial_snapshots
  for each row execute function order_financial_snapshots_verify();

-- Server-only
do $$
declare f text;
begin
  foreach f in array array['payout_request_create(text, uuid, text, bigint, text, text)',
    'partner_ledger_move(text, uuid, text, text, text, bigint, text, text, text, text, text, uuid, text)',
    'affiliate_attribute_order(uuid, uuid, uuid[])', 'checkout_quotes_freeze()', 'order_financial_snapshots_verify()'] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $$;

-- ----------------------------------------------------------------------------
-- Verification - every row must be ok = true
-- ----------------------------------------------------------------------------
with checks(check_name, ok) as (
  select 'naira payout minimum has no fallback', pg_get_functiondef('public.payout_request_create(text,uuid,text,bigint,text,text)'::regprocedure) like '%rate_unavailable%'
  union all select 'ledger move is all-or-nothing', pg_get_functiondef('public.partner_ledger_move(text,uuid,text,text,text,bigint,text,text,text,text,text,uuid,text)'::regprocedure) like '%ledger_move_credit_not_posted%'
  union all select 'resale commission USD only', pg_get_functiondef('public.affiliate_attribute_order(uuid,uuid,uuid[])'::regprocedure) like '%money.currency = ''USD''%'
  union all select 'resale offers are USD', exists (select 1 from pg_constraint where conname = 'affiliate_offers_resale_usd')
  union all select 'quotes frozen', exists (select 1 from pg_trigger where tgname = 'checkout_quotes_freeze')
  union all select 'quote route matches currency', exists (select 1 from pg_constraint where conname = 'checkout_quotes_route')
  union all select 'snapshots need a quote', (select attnotnull from pg_attribute where attrelid = 'public.order_financial_snapshots'::regclass and attname = 'quote_id')
  union all select 'snapshots belong to an order', exists (select 1 from pg_constraint where conname = 'order_financial_snapshots_order_fk')
  union all select 'snapshot currencies consistent', exists (select 1 from pg_constraint where conname = 'order_financial_snapshots_consistent')
  union all select 'snapshots verified against the quote', exists (select 1 from pg_trigger where tgname = 'order_financial_snapshots_verify')
  union all select 'listing currencies still off', not (select listing_currencies_enabled from currency_settings where id)
)
select * from checks order by ok, check_name;
