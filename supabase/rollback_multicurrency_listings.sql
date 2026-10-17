-- ============================================================================
-- Rollback for add_multicurrency_listings.sql and fix_multicurrency_review.sql.
-- Removes only their objects.
-- ============================================================================
-- First choice is always the switch, not this script: keep
-- currency_settings.listing_currencies_enabled off (admin portal, Currencies).
--
-- Refuses to run once anything priced or settled in another currency exists
-- (a non-USD listing, a paid quote, a frozen order snapshot, or a non-USD
-- ledger, attribution, reward or payout row). Those are financial records
-- and need owner approval and an export before anything is dropped.
--
-- If P8 / P9 were applied, roll those back first (see
-- docs/protected-patches/README.md).
--
-- After it runs, re-run these (all idempotent) to restore the previous
-- definitions of the functions this migration replaced:
--   supabase/add_earnings_and_payouts.sql
--   supabase/add_gift_revenue_sharing.sql
--   supabase/add_affiliate_marketplace.sql
-- ============================================================================

do $$
begin
  if to_regclass('public.order_financial_snapshots') is not null and exists (select 1 from order_financial_snapshots) then
    raise exception 'Orders have frozen multi-currency snapshots - export them and get approval first';
  end if;
  if to_regclass('public.checkout_quotes') is not null and exists (select 1 from checkout_quotes where payment_ref is not null) then
    raise exception 'A checkout quote was paid - export it and get approval first';
  end if;
  if exists (select 1 from information_schema.columns where table_name = 'catalogue_items' and column_name = 'listing_currency')
     and exists (select 1 from catalogue_items where listing_currency <> 'USD') then
    raise exception 'Listings are priced in other currencies - move them back to USD first';
  end if;
  if exists (select 1 from information_schema.columns where table_name = 'partner_ledger' and column_name = 'currency')
     and (exists (select 1 from partner_ledger where currency <> 'USD')
          or exists (select 1 from affiliate_attributions where currency <> 'USD')
          or exists (select 1 from referral_rewards where currency <> 'USD')
          or exists (select 1 from payout_requests where currency <> 'USD')) then
    raise exception 'Earnings exist in naira - settle and export them first';
  end if;
end $$;

-- Functions with new signatures (the previous ones come back from the re-runs above)
drop function if exists seller_earnings_by_currency(text);
drop function if exists order_money(uuid);
drop function if exists payout_request_create(text, uuid, text, bigint, text, text);
drop function if exists partner_balances(text, uuid);
drop function if exists partner_ledger_move(text, uuid, text, text, text, bigint, text, text, text, text, text, uuid, text);
drop function if exists partner_ledger_post(text, uuid, text, text, bigint, text, text, text, text, text, uuid, text);

-- Currency columns on the earnings tables
drop index if exists partner_ledger_party;
alter table if exists affiliate_offers drop column if exists amount_currency;
alter table if exists payout_requests drop column if exists currency;
alter table if exists referral_rewards drop column if exists currency;
alter table if exists affiliate_attributions drop column if exists currency;
alter table if exists partner_ledger drop column if exists currency;

-- Quotes, snapshots, listing currency
drop table if exists order_financial_snapshots;
drop function if exists order_financial_snapshots_verify();
drop table if exists checkout_quotes;
drop function if exists checkout_quotes_freeze();
drop trigger if exists catalogue_items_sync_usd_price on catalogue_items;
drop function if exists catalogue_items_sync_usd_price();
alter table catalogue_items drop column if exists listing_price_minor;
alter table catalogue_items drop column if exists listing_currency;
drop table if exists currency_rates;
drop table if exists currency_settings;
drop table if exists marketplace_currencies;
