-- ============================================================================
-- P9 (PROTECTED - NOT APPLIED): naira seller wallet and naira withdrawals.
-- ============================================================================
-- Run only with the owner's explicit approval, AFTER P8. Goes with
-- P9_naira_seller_wallet.diff (wallet API, admin withdrawals API and portal,
-- app wallet screen).
--
-- Naira earnings (orders whose frozen snapshot settles in NGN) are paid out in
-- naira through the EXISTING manual withdrawal workflow: the seller enters a
-- method and bank details, the request reserves the amount at once, an admin
-- approves and marks it paid exactly as today. No new payout rail, no
-- automatic transfer.
--
-- participant_withdrawals for a naira request:
--   currency = 'NGN', amount_ngn = what the seller is owed (authoritative),
--   amount_usd = a USD equivalent at request time, for totals and alerts only.
-- seller_earnings_summary() (P8) ignores NGN rows; the vote wallet only counts
-- source = 'votes', so neither is affected.
--
-- Rollback: drop the two functions below. NGN withdrawal rows already created
-- stay readable; pay or reject them before rolling back.
-- ============================================================================

alter table participant_withdrawals add column if not exists amount_ngn numeric(14,2);
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'participant_withdrawals_ngn_amount') then
    alter table participant_withdrawals add constraint participant_withdrawals_ngn_amount
      check (currency <> 'NGN' or (amount_ngn is not null and amount_ngn > 0));
  end if;
end $$;

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
             select round(a.commission_micro / 1000000.0, 2) from affiliate_attributions a
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

  select rate into v_rate from currency_rates where quote = 'NGN' order by source_published_at desc limit 1;

  insert into participant_withdrawals (username, amount_usd, amount_ngn, currency, payment_method, payment_details, status, created_at, source)
  values (v_username, case when v_rate > 0 then greatest(round(p_amount / v_rate, 2), 0.01) else 0.01 end,
          p_amount, 'NGN', p_method, p_details, 'pending', now(), 'marketplace')
  returning id into v_id;

  return query select v_id, v_available - p_amount;
end;
$$;

revoke all on function seller_earnings_summary_ngn(text) from public, anon, authenticated;
revoke all on function request_seller_withdrawal_ngn(uuid, numeric, text, text) from public, anon, authenticated;
grant execute on function seller_earnings_summary_ngn(text) to service_role;
grant execute on function request_seller_withdrawal_ngn(uuid, numeric, text, text) to service_role;

-- Verification - every row must be ok = true
with checks(check_name, ok) as (
  select 'P8 applied first', exists (select 1 from information_schema.columns where table_name = 'participant_withdrawals' and column_name = 'currency')
  union all select 'naira summary exists', to_regprocedure('public.seller_earnings_summary_ngn(text)') is not null
  union all select 'naira withdrawal exists', to_regprocedure('public.request_seller_withdrawal_ngn(uuid,numeric,text,text)') is not null
  union all select 'naira withdrawal is server-only', not has_function_privilege('anon', 'public.request_seller_withdrawal_ngn(uuid,numeric,text,text)', 'execute')
)
select * from checks order by ok, check_name;
