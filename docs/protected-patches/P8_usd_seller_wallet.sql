-- ============================================================================
-- P8 (PROTECTED - NOT APPLIED): the USD seller wallet counts USD-settled
-- orders only. Supersedes P1 (it includes P1's seller-funded deduction).
-- ============================================================================
-- Changes the protected function seller_earnings_summary() (from
-- supabase/add_seller_earnings.sql), which drives the seller wallet and
-- request_seller_withdrawal(). Run only with the owner's explicit approval,
-- AFTER supabase/add_multicurrency_listings.sql, and in the same release as
-- P7: once P7 writes naira orders, their legacy USD columns hold USD
-- *equivalents* for reports, and without P8 they would be paid out of the
-- USD wallet.
--
-- Effect:
--   * Orders whose frozen snapshot settles in NGN are left out. Their money is
--     in the naira wallet (P9). Orders without a snapshot (everything before
--     P7, and USD single-listing purchases) are USD, as today.
--   * P1's rule: an order's net is reduced by the seller-funded commission of
--     an ACCRUED USD attribution on it. Attributions recorded before P1
--     ('awaiting_seller_settlement') are never deducted. With
--     seller_funded_settlement_enabled off nothing accrues seller-funded, so
--     this deducts nothing - applying P8 is safe whether or not P1's switch
--     is ever turned on.
--   * Withdrawals: only USD ones (participant_withdrawals.currency, added
--     here, defaults to 'USD' so every existing row stays USD).
--
-- Unchanged: the result columns, so request_seller_withdrawal() and
-- pages/api/onedream/marketplace-wallet.js need no change for the USD wallet.
--
-- Rollback: re-run section 4 of supabase/add_seller_earnings.sql (original
-- definition), or P1 if P1 was in force. Only safe while no NGN-settled
-- order exists, i.e. before listing_currencies_enabled is switched on.
-- ============================================================================

alter table participant_withdrawals add column if not exists currency text not null default 'USD';
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'participant_withdrawals_currency_check') then
    alter table participant_withdrawals add constraint participant_withdrawals_currency_check check (currency in ('USD', 'NGN'));
  end if;
end $$;

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
             select round(a.commission_micro / 1000000.0, 2) from affiliate_attributions a
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

revoke all on function seller_earnings_summary(text) from public, anon, authenticated;
grant execute on function seller_earnings_summary(text) to service_role;

-- Verification - every row must be ok = true
with checks(check_name, ok) as (
  select 'withdrawals have a currency', not exists (select 1 from participant_withdrawals where currency is null)
  union all select 'existing withdrawals stay USD', not exists (select 1 from participant_withdrawals where currency <> 'USD')
  union all select 'summary is server-only', not has_function_privilege('anon', 'public.seller_earnings_summary(text)', 'execute')
)
select * from checks order by ok, check_name;
