-- ============================================================================
-- P7 activation (PROTECTED - NOT APPLIED): payment methods follow the
-- listing currency.
-- ============================================================================
-- Run only with the owner's explicit approval, AFTER P7_multicurrency_checkout.diff
-- and P7_client_cart_quote.diff are deployed and P8 is applied, immediately
-- before switching listing_currencies_enabled on (admin portal, Currencies).
--
-- Effect on EXISTING listings (2 in production at the time of writing, both
-- USD with ["paystack","usdt"]): every non-naira listing becomes USDT-only,
-- because only naira is paid through Paystack. Tell sellers first; a seller
-- who wants card/bank payments relists in naira.
--
-- The single-listing routes (create-payment-intent.js, verify-order.js and
-- the website popup that uses verify-order) check payment_methods, so after
-- this they stop offering Paystack for USD listings without any code change.
--
-- Rollback: update catalogue_items set payment_methods = '["paystack","usdt"]'
-- where listing_currency = 'USD'; (after switching listing currencies off).
-- ============================================================================

update catalogue_items ci
   set payment_methods = to_jsonb(array[mc.checkout_route])
  from marketplace_currencies mc
 where mc.code = ci.listing_currency
   and ci.status <> 'deleted'
   and ci.payment_methods is distinct from to_jsonb(array[mc.checkout_route]);

-- Verification - every row must be ok = true
with checks(check_name, ok) as (
  select 'naira listings pay by Paystack only', not exists (select 1 from catalogue_items where listing_currency = 'NGN' and status <> 'deleted' and payment_methods <> '["paystack"]'::jsonb)
  union all select 'other listings pay in USDT only', not exists (select 1 from catalogue_items where listing_currency <> 'NGN' and status <> 'deleted' and payment_methods <> '["usdt"]'::jsonb)
  union all select 'P8 applied', exists (select 1 from information_schema.columns where table_name = 'participant_withdrawals' and column_name = 'currency')
)
select * from checks order by ok, check_name;
