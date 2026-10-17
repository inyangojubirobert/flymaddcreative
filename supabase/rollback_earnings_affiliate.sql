-- ============================================================================
-- Rollback for add_affiliate_marketplace.sql, add_gift_revenue_sharing.sql and
-- add_earnings_and_payouts.sql (in that order). Removes only those objects.
-- ============================================================================
-- First choice is always the switches, not this script: in the admin portal
-- (Partners & Payouts) turn off gift_earnings_enabled and payouts_enabled.
-- History stays intact and auditable.
--
-- This script refuses to run once any monetary record exists (ledger rows or
-- payout requests): those are financial history and must be exported and
-- settled with owner approval before anything is dropped.
--
-- After it runs, re-run supabase/add_dream_coins_gifting.sql (idempotent) to
-- restore the original Dream Coins functions; coin balances, purchases, gifts
-- and the coin ledger are untouched throughout.
-- ============================================================================

do $$
begin
  if to_regclass('public.partner_ledger') is not null and exists (select 1 from partner_ledger) then
    raise exception 'Earnings ledger has records - export them and get approval before dropping these tables';
  end if;
  if to_regclass('public.payout_requests') is not null and exists (select 1 from payout_requests) then
    raise exception 'Payout requests exist - settle and export them first';
  end if;
end $$;

-- Affiliate marketplace
drop function if exists affiliate_release_held(uuid, uuid, text);
drop function if exists affiliate_reverse_attribution(uuid, uuid, text);
drop function if exists referral_rewards_process();
drop function if exists affiliate_advance(integer);
drop function if exists affiliate_match_intents(integer);
drop function if exists affiliate_attribute_resale_orders(integer);
drop function if exists affiliate_attribute_order(uuid, uuid, uuid[]);
drop function if exists affiliate_record_intent(text, text, text, uuid[]);
drop function if exists affiliate_record_click(text, uuid, text);
drop function if exists affiliate_set_resale_price(uuid, uuid, numeric);
drop function if exists affiliate_join_offer(uuid, uuid, text, numeric);
drop function if exists affiliate_platform_spend_this_month();
drop table if exists creative_engagements;
drop table if exists referral_rewards;
drop table if exists affiliate_attributions;
drop table if exists affiliate_intents;
drop table if exists affiliate_clicks;
drop table if exists affiliate_links;
drop table if exists affiliate_collection_items;
drop table if exists affiliate_collections;
drop table if exists affiliate_creatives;
drop table if exists affiliate_resale_price_changes;
drop table if exists affiliate_memberships;
drop table if exists affiliate_offers;
drop table if exists affiliate_partners;

-- Gift revenue sharing
drop function if exists play_settlement_mark_funds(uuid, uuid, text);
drop function if exists play_settlement_import(text, text, jsonb, uuid);
drop function if exists coin_lots_reconcile(text[], uuid);
drop function if exists coin_lot_set_region(uuid, text);
drop function if exists gift_component_reverse(uuid, uuid, integer, text, text);
drop function if exists gift_record_earnings(uuid);
drop function if exists coin_lots_take(uuid, integer);
drop function if exists gift_component_post(uuid, uuid, text, uuid, text, bigint, boolean, text, text, text);
drop function if exists gift_split(bigint, numeric, numeric);
drop function if exists coin_lot_value_base(coin_lots, text);
drop table if exists gift_earning_components;
drop table if exists gift_earnings;
drop table if exists gift_lot_allocations;
drop table if exists coin_lots;
drop table if exists play_settlement_lines;
drop table if exists play_settlement_batches;

-- Earnings & payouts
drop function if exists payout_request_decide(uuid, text, uuid, text, text);
drop function if exists payout_request_create(text, uuid, text, bigint, text);
drop function if exists partner_balances(text, uuid);
drop function if exists partner_ledger_move(text, uuid, text, text, text, bigint, text, text, text, text, text, uuid);
drop function if exists partner_ledger_post(text, uuid, text, text, bigint, text, text, text, text, text, uuid);
drop table if exists earnings_admin_audit;
drop table if exists payout_events;
drop table if exists payout_requests;
drop table if exists payee_profiles;
drop table if exists partner_ledger;
drop table if exists merchant_participant_links;
drop table if exists earnings_settings;
