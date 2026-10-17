-- ============================================================================
-- Rollback for add_dream_coins_gifting.sql
-- ============================================================================
-- Removes ONLY the Dream Coins / gifting / recognition objects. No existing
-- table is touched.
--
-- First choice is always the switch, not this script: set
-- DREAM_COINS_ENABLED=false in Vercel (stops new coin sales immediately;
-- balances and history stay intact and auditable).
--
-- Run this only if NO real (non-test) purchase has been credited. The guard
-- below refuses otherwise: real purchase and ledger records are financial
-- history and must be exported and kept before anything is dropped.
-- ============================================================================

do $$
begin
  if to_regclass('public.dream_coin_purchases') is not null
     and exists (select 1 from dream_coin_purchases where not is_test) then
    raise exception 'Real Dream Coin purchases exist - export them and get approval before dropping these tables';
  end if;
end $$;

drop function if exists dream_coins_set_suspension(uuid, boolean, text, uuid);
drop function if exists dream_coins_admin_adjust(uuid, integer, text, uuid, text);
drop function if exists virtual_gift_reverse(uuid, uuid, text);
drop function if exists virtual_gift_send(uuid, uuid, text, integer, text, text, text, boolean, text, boolean, integer, integer);
drop function if exists dream_coins_reverse_purchase(text, integer, text, text);
drop function if exists dream_coins_record_consumption(text, text);
drop function if exists dream_coins_credit_purchase(uuid, text, text, text, text, integer, boolean, timestamptz);

drop table if exists reward_awards;
drop table if exists reward_programs;
drop table if exists dream_gifting_admin_audit;
drop table if exists virtual_gift_refunds;
drop table if exists dream_coin_ledger;
drop table if exists virtual_gift_transactions;
drop table if exists virtual_gift_catalogue;
drop table if exists dream_coin_balances;
drop table if exists dream_coin_purchases;
drop table if exists dream_coin_packages;
drop function if exists dream_coins_append_only();
