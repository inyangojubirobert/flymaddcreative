-- ============================================================================
-- P1 (PROTECTED - NOT APPLIED): deduct seller-funded affiliate commission
-- from seller marketplace earnings.
-- ============================================================================
-- Changes the protected function seller_earnings_summary() (from
-- supabase/add_seller_earnings.sql), which drives the seller wallet and
-- request_seller_withdrawal(). Run only with the owner's explicit approval,
-- AFTER supabase/add_affiliate_marketplace.sql, then switch on
-- earnings_settings.seller_funded_settlement_enabled.
--
-- Effect: for each order, the seller's net is reduced by the seller-funded
-- commission of an ACCRUED attribution on that order (status pending, held or
-- available). Attributions recorded before P1 ('awaiting_seller_settlement')
-- are never deducted: those sellers were paid in full, so their partners
-- were never owed that commission. Reversed attributions stop being deducted.
-- The seller-facing order list keeps showing seller_net_usd per order; the
-- wallet totals (this function) are what withdrawals use.
--
-- Rollback: re-run section 4 of supabase/add_seller_earnings.sql (the
-- original definition) and switch seller_funded_settlement_enabled off.
-- Seller-funded attributions that already accrued must then be reversed by
-- admin (affiliate_reverse_attribution), or partners would be paid commission
-- the seller no longer pays.
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
             select round(a.commission_micro / 1000000.0, 2) from affiliate_attributions a
              where a.order_id = co.id and a.funding = 'seller' and a.source = 'affiliate'
                and a.status in ('pending', 'held', 'available')), 0) as seller_net_usd
      from catalogue_orders co
     where co.seller_username = p_username and co.commission_percent is not null
  ), w as (
    select status, amount_usd
      from participant_withdrawals
     where username = p_username and source = 'marketplace'
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
