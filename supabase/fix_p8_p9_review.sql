-- ============================================================================
-- Corrections to P8 and P9 (both already applied in production, 18 Oct 2026)
-- ============================================================================
-- Run once in the Supabase SQL editor. Idempotent: it only replaces three
-- functions; no table or data changes.
--
--  1. request_seller_withdrawal_ngn(): a naira withdrawal needs a recent NGN
--     rate (within currency_settings.max_rate_age_seconds). Without one it is
--     refused with rate_unavailable. It no longer records a made-up $0.01.
--  2. seller_earnings_summary() and seller_earnings_summary_ngn(): the
--     seller-funded affiliate deduction is a SUM over the order's
--     attributions, never a scalar pick, so it can't fail on several rows.
--     affiliate_attributions.order_id is unique, so it is never applied twice.
-- ============================================================================

create or replace function seller_earnings_summary(p_username text)
returns table(
  completed_gross_usd numeric,
  commission_usd numeric,
  withdrawable_earned_usd numeric,
  pending_net_usd numeric,
  on_hold_net_usd numeric,
  pending_count integer,
  withdrawals_pending_usd numeric,
  withdrawals_paid_usd numeric,
  available_usd numeric
)
language sql
stable
set search_path = public
as $$
  with o as (
    select co.status, co.amount_usd, co.commission_usd,
           co.seller_net_usd - coalesce((
             -- Summed (never a scalar pick), and an order can carry only one
             -- attribution (affiliate_attributions.order_id is unique), so
             -- the deduction is never applied twice.
             select round(sum(a.commission_micro) / 1000000.0, 2) from affiliate_attributions a
              where a.order_id = co.id and a.funding = 'seller' and a.source = 'affiliate'
                and a.currency = 'USD'
                and a.status in ('pending', 'held', 'available')), 0) as seller_net_usd
      from catalogue_orders co
     where co.seller_username = p_username and co.commission_percent is not null
       and not exists (select 1 from order_financial_snapshots s
                        where s.order_id = co.id and s.settlement_currency <> 'USD')
  ), w as (
    select status, amount_usd
      from participant_withdrawals
     where username = p_username and source = 'marketplace' and currency = 'USD'
  )
  select
    coalesce((select sum(amount_usd) from o where status in ('buyer_confirmed', 'released')), 0),
    coalesce((select sum(commission_usd) from o where status in ('buyer_confirmed', 'released')), 0),
    coalesce((select sum(seller_net_usd) from o where status in ('buyer_confirmed', 'released')), 0),
    coalesce((select sum(seller_net_usd) from o where status in ('paid', 'pending_verification')), 0),
    coalesce((select sum(seller_net_usd) from o where status = 'disputed'), 0),
    (select count(*)::int from o where status in ('paid', 'pending_verification')),
    coalesce((select sum(amount_usd) from w where status in ('pending', 'processing')), 0),
    coalesce((select sum(amount_usd) from w where status in ('claimed', 'paid')), 0),
    coalesce((select sum(seller_net_usd) from o where status in ('buyer_confirmed', 'released')), 0)
      - coalesce((select sum(amount_usd) from w where status <> 'rejected'), 0);
$$;

create or replace function seller_earnings_summary_ngn(p_username text)
returns table(
  completed_gross_ngn numeric,
  commission_ngn numeric,
  withdrawable_earned_ngn numeric,
  pending_net_ngn numeric,
  on_hold_net_ngn numeric,
  pending_count integer,
  withdrawals_pending_ngn numeric,
  withdrawals_paid_ngn numeric,
  available_ngn numeric
)
language sql
stable
set search_path = public
as $$
  with o as (
    select co.status,
           s.charged_minor / 100.0 as gross,
           s.commission_minor / 100.0 as commission,
           s.seller_earnings_minor / 100.0 - coalesce((
             -- Summed, never a scalar pick; one attribution per order at most.
             select round(sum(a.commission_micro) / 1000000.0, 2) from affiliate_attributions a
              where a.order_id = co.id and a.funding = 'seller' and a.source = 'affiliate'
                and a.currency = 'NGN'
                and a.status in ('pending', 'held', 'available')), 0) as net
      from catalogue_orders co
      join order_financial_snapshots s on s.order_id = co.id and s.settlement_currency = 'NGN'
     where co.seller_username = p_username
  ), w as (
    select status, amount_ngn
      from participant_withdrawals
     where username = p_username and source = 'marketplace' and currency = 'NGN'
  )
  select
    coalesce((select sum(gross) from o where status in ('buyer_confirmed', 'released')), 0),
    coalesce((select sum(commission) from o where status in ('buyer_confirmed', 'released')), 0),
    coalesce((select sum(net) from o where status in ('buyer_confirmed', 'released')), 0),
    coalesce((select sum(net) from o where status in ('paid', 'pending_verification')), 0),
    coalesce((select sum(net) from o where status = 'disputed'), 0),
    (select count(*)::int from o where status in ('paid', 'pending_verification')),
    coalesce((select sum(amount_ngn) from w where status in ('pending', 'processing')), 0),
    coalesce((select sum(amount_ngn) from w where status in ('claimed', 'paid')), 0),
    coalesce((select sum(net) from o where status in ('buyer_confirmed', 'released')), 0)
      - coalesce((select sum(amount_ngn) from w where status <> 'rejected'), 0);
$$;

create or replace function request_seller_withdrawal_ngn(
  p_participant_id uuid,
  p_amount numeric,
  p_method text,
  p_details text
)
returns table(withdrawal_id uuid, available_balance numeric)
language plpgsql
set search_path = public
as $$
declare
  v_username text;
  v_available numeric;
  v_rate numeric;
  v_id uuid;
begin
  -- Same participant-row lock as request_seller_withdrawal(): one seller's
  -- requests (in either currency) are serialised.
  select username into v_username from participants where id = p_participant_id for update;
  if v_username is null then
    raise exception 'participant_not_found';
  end if;

  select s.available_ngn into v_available from seller_earnings_summary_ngn(v_username) s;

  if p_amount is null or p_amount <= 0 or round(p_amount, 2) <> p_amount or p_amount > v_available then
    raise exception 'insufficient_balance';
  end if;

  -- The USD equivalent (totals and alerts only) needs a recent NGN rate.
  -- No rate, no withdrawal: nothing is ever recorded at a made-up value.
  select r.rate into v_rate from currency_rates r
   where r.quote = 'NGN'
     and r.source_published_at >= now() - make_interval(secs => coalesce((select max_rate_age_seconds from currency_settings where id), 93600))
   order by r.source_published_at desc limit 1;
  if v_rate is null or v_rate <= 0 then
    raise exception 'rate_unavailable';
  end if;

  insert into participant_withdrawals (username, amount_usd, amount_ngn, currency, payment_method, payment_details, status, created_at, source)
  values (v_username, greatest(round(p_amount / v_rate, 2), 0.01),
          p_amount, 'NGN', p_method, p_details, 'pending', now(), 'marketplace')
  returning id into v_id;

  return query select v_id, v_available - p_amount;
end;
$$;

revoke all on function seller_earnings_summary(text) from public, anon, authenticated;
revoke all on function seller_earnings_summary_ngn(text) from public, anon, authenticated;
revoke all on function request_seller_withdrawal_ngn(uuid, numeric, text, text) from public, anon, authenticated;
grant execute on function seller_earnings_summary(text) to service_role;
grant execute on function seller_earnings_summary_ngn(text) to service_role;
grant execute on function request_seller_withdrawal_ngn(uuid, numeric, text, text) to service_role;

-- Verification - every row must be ok = true
with checks(check_name, ok) as (
  select 'naira withdrawal refuses without a rate', pg_get_functiondef('public.request_seller_withdrawal_ngn(uuid,numeric,text,text)'::regprocedure) like '%rate_unavailable%'
  union all select 'no made-up USD equivalent', pg_get_functiondef('public.request_seller_withdrawal_ngn(uuid,numeric,text,text)'::regprocedure) not like '%else 0.01%'
  union all select 'USD wallet sums the deduction', pg_get_functiondef('public.seller_earnings_summary(text)'::regprocedure) like '%sum(a.commission_micro)%'
  union all select 'naira wallet sums the deduction', pg_get_functiondef('public.seller_earnings_summary_ngn(text)'::regprocedure) like '%sum(a.commission_micro)%'
  union all select 'one attribution per order', exists (select 1 from pg_indexes where tablename = 'affiliate_attributions' and indexdef ilike '%unique%(order_id)%')
  union all select 'functions are server-only', not has_function_privilege('anon', 'public.request_seller_withdrawal_ngn(uuid,numeric,text,text)', 'execute')
)
select * from checks order by ok, check_name;
