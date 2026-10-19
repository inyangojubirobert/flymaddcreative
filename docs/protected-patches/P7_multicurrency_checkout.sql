-- ============================================================================
-- P7 activation (PROTECTED - NOT APPLIED): payment methods follow the
-- listing currency.
-- ============================================================================
-- Run only with the owner's explicit approval, AFTER P7_multicurrency_checkout.diff
-- and P7_client_cart_quote.diff are deployed and P8 is applied, immediately
-- before switching listing_currencies_enabled on (admin portal, Currencies).
--
-- Effect on EXISTING listings: naira listings pay by Paystack only; GBP, EUR
-- and GHS listings pay in USDT only. USD listings are left alone and keep
-- card and USDT (changed 19 Oct 2026: USD-only carts don't use quotes).
--
-- Rollback: switch listing currencies off; USD listings were never changed.
-- ============================================================================

update catalogue_items ci
   set payment_methods = to_jsonb(array[mc.checkout_route])
  from marketplace_currencies mc
 where mc.code = ci.listing_currency
   and ci.status <> 'deleted'
   and ci.listing_currency <> 'USD'
   and ci.payment_methods is distinct from to_jsonb(array[mc.checkout_route]);

-- Verification - every row must be ok = true
with checks(check_name, ok) as (
  select 'naira listings pay by Paystack only', not exists (select 1 from catalogue_items where listing_currency = 'NGN' and status <> 'deleted' and payment_methods <> '["paystack"]'::jsonb)
  union all select 'GBP, EUR and GHS listings pay in USDT only', not exists (select 1 from catalogue_items where listing_currency not in ('NGN', 'USD') and status <> 'deleted' and payment_methods <> '["usdt"]'::jsonb)
  union all select 'USD listings still offer card', not exists (select 1 from catalogue_items where listing_currency = 'USD' and status <> 'deleted' and not (payment_methods ? 'paystack'))
  union all select 'P8 applied', exists (select 1 from information_schema.columns where table_name = 'participant_withdrawals' and column_name = 'currency')
)
select * from checks order by ok, check_name;
