-- ============================================================================
-- One Dream activation bundle, 19 Oct 2026 (owner-approved: "execute all").
-- Paste the whole file into the Supabase SQL editor and run it ONCE.
-- It runs in one transaction: if any statement fails nothing is changed.
-- Every row of the final result must say ok = true.
--
-- Contents, in the order docs/protected-patches/README.md requires:
--   1. supabase/fix_p8_p9_review.sql            (P8/P9 review fixes; re-runnable)
--   2. P6_pending_checkouts.sql                 (paid carts whose buyer never returned)
--   3. P3_reseller_checkout.sql                 (reseller price at checkout)
--   4. P4_partner_boosts.sql                    (partners may boost partner listings)
--   5. P7_multicurrency_checkout.sql            (payment methods follow listing currency)
--   6. an index for the ads frequency cap
-- The matching code is already deployed. After this, turn the switches on in
-- the admin portal (see docs/nextSteps.MD, Part 1).
-- ============================================================================

begin;

-- >>>>>>>>>> supabase/fix_p8_p9_review.sql
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
  -- Rounded to the cent with a $0.01 floor, so a tiny withdrawal never shows
  -- as $0.00. amount_ngn (what is paid) is exact; amount_usd is reporting only.
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

-- >>>>>>>>>> docs/protected-patches/P6_pending_checkouts.sql
-- ============================================================================
-- P6 (PROTECTED - NOT APPLIED): complete paid carts whose buyer never returned
-- ============================================================================
-- Pairs with P6_store_buyer_details_at_payment_intent.diff (protected
-- pages/api/catalogue/cart-payment-intent.js) and the new, unprotected job
-- pages/api/admin/earnings/complete-unreturned.js.
--
-- Today the orders for a Paystack cart are only written when the buyer's
-- app/page returns and calls cart-checkout. If they pay and close it, the
-- charge succeeds but no order exists. Paystack metadata carries the cart
-- lines but not the buyer's name, phone or delivery address (deliberately:
-- that is private to the seller). P6 keeps those details here, on our own
-- server, from the moment the payment reference is created, so the job can
-- run the exact same verified completion as cart-checkout.
--
-- Rows hold personal data: server-only, and deleted by the job after 60 days.
-- Rollback: revert the diff; drop table catalogue_pending_checkouts.
-- ============================================================================

create table if not exists catalogue_pending_checkouts (
  payment_ref text primary key,
  buyer jsonb not null,                 -- buyer_name, buyer_email, buyer_whatsapp, delivery_address, notes
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  completed_by text                     -- 'buyer' | 'reconciliation'
);
create index if not exists catalogue_pending_checkouts_open on catalogue_pending_checkouts (created_at) where completed_at is null;

alter table catalogue_pending_checkouts enable row level security;
revoke all on table catalogue_pending_checkouts from anon, authenticated, public;
grant all on table catalogue_pending_checkouts to service_role;

-- >>>>>>>>>> docs/protected-patches/P3_reseller_checkout.sql
-- ============================================================================
-- P3 (PROTECTED - NOT APPLIED): checkout charges an authorised reseller's price
-- ============================================================================
-- Pairs with P3_reseller_checkout.diff (lib/catalogueCart.js,
-- pages/api/catalogue/cart-payment-intent.js, pages/api/catalogue/cart-checkout.js).
-- Changes the protected order table and create_cart_checkout(). Run only with
-- the owner's explicit approval, AFTER supabase/add_affiliate_marketplace.sql,
-- then deploy the patched code, then switch on
-- earnings_settings.resale_checkout_enabled.
--
-- On a reseller sale the order records the price the buyer paid, the floor it
-- was sold against and the platform fee on the margin. seller_net_usd becomes
-- the floor less commission (the seller's own earnings); the reseller's margin
-- less commission is credited by affiliate_attribute_resale_orders(). The
-- floor is stored on the order for accounting and is never returned to buyers.
--
-- Rollback: switch resale_checkout_enabled off (cart lines with a reseller then
-- show "This reseller offer is no longer available"), redeploy the unpatched
-- code, and re-run create_cart_checkout from supabase/add_seller_earnings.sql.
-- The added columns can stay (nullable, unused).
-- ============================================================================

alter table catalogue_orders add column if not exists resale_membership_id uuid references affiliate_memberships(id);
alter table catalogue_orders add column if not exists resale_price_usd numeric(12,2);
alter table catalogue_orders add column if not exists resale_floor_usd numeric(12,2);
alter table catalogue_orders add column if not exists resale_platform_fee_usd numeric(12,2);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'catalogue_orders_resale_complete') then
    alter table catalogue_orders add constraint catalogue_orders_resale_complete check (
      resale_membership_id is null or (resale_price_usd is not null and resale_floor_usd is not null
                                       and resale_price_usd >= resale_floor_usd and resale_platform_fee_usd is not null));
  end if;
end $$;

-- Same as the latest definition (supabase/add_seller_earnings.sql: delivery_address,
-- fee_cap_usd, commission fields), plus the four resale columns. Before applying,
-- compare with the live definition: select pg_get_functiondef('create_cart_checkout(jsonb,jsonb)'::regprocedure);
create or replace function create_cart_checkout(p_checkout jsonb, p_orders jsonb)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v_c catalogue_checkouts%rowtype;
  v_id uuid;
  v_claim text;
begin
  select id into v_id from catalogue_checkouts where payment_ref = p_checkout->>'payment_ref';
  if v_id is not null then
    return jsonb_build_object('checkout_id', v_id, 'created', false);
  end if;

  if jsonb_typeof(p_orders) <> 'array' or jsonb_array_length(p_orders) = 0 then
    raise exception 'cart_checkout_no_orders';
  end if;

  v_c := jsonb_populate_record(null::catalogue_checkouts, p_checkout);

  if v_c.payment_method = 'usdt' then
    v_claim := claim_usdt_payment(v_c.payment_ref, 'catalogue_cart', v_c.payment_ref);
    if v_claim not in ('claimed', 'already_claimed') then
      raise exception 'usdt_payment_%', v_claim;
    end if;
  end if;

  insert into catalogue_checkouts (
    payment_ref, payment_method, network, buyer_name, buyer_email, buyer_whatsapp, notes, delivery_address,
    lines, subtotal_usd, service_fee_usd, total_usd, fee_percent, fee_cap_ngn, fee_cap_usd,
    currency, amount_ngn, exchange_rate, status
  ) values (
    v_c.payment_ref, v_c.payment_method, v_c.network, v_c.buyer_name, v_c.buyer_email, v_c.buyer_whatsapp, v_c.notes, v_c.delivery_address,
    v_c.lines, v_c.subtotal_usd, v_c.service_fee_usd, v_c.total_usd, v_c.fee_percent, v_c.fee_cap_ngn, v_c.fee_cap_usd,
    v_c.currency, v_c.amount_ngn, v_c.exchange_rate, coalesce(v_c.status, 'paid')
  ) returning id into v_id;

  insert into catalogue_orders (
    item_id, seller_username, buyer_name, buyer_email, buyer_whatsapp, notes, delivery_address,
    amount_usd, unit_price_usd, quantity, commission_percent, commission_usd, seller_net_usd,
    payment_method, currency, exchange_rate, amount_ngn,
    payment_ref, tx_hash, status, buyer_token, created_at, checkout_id,
    resale_membership_id, resale_price_usd, resale_floor_usd, resale_platform_fee_usd
  )
  select o.item_id, o.seller_username, o.buyer_name, o.buyer_email, o.buyer_whatsapp, o.notes, o.delivery_address,
         o.amount_usd, o.unit_price_usd, coalesce(o.quantity, 1), o.commission_percent, o.commission_usd, o.seller_net_usd,
         o.payment_method, o.currency, o.exchange_rate, o.amount_ngn,
         o.payment_ref, o.tx_hash, o.status, o.buyer_token, coalesce(o.created_at, now()), v_id,
         o.resale_membership_id, o.resale_price_usd, o.resale_floor_usd, o.resale_platform_fee_usd
    from jsonb_populate_recordset(null::catalogue_orders, p_orders) o;

  return jsonb_build_object('checkout_id', v_id, 'created', true);
exception
  when unique_violation then
    select id into v_id from catalogue_checkouts where payment_ref = p_checkout->>'payment_ref';
    if v_id is null then raise; end if;
    return jsonb_build_object('checkout_id', v_id, 'created', false);
end;
$$;

revoke all on function create_cart_checkout(jsonb, jsonb) from public, anon, authenticated;
grant execute on function create_cart_checkout(jsonb, jsonb) to service_role;

-- >>>>>>>>>> docs/protected-patches/P4_partner_boosts.sql
-- ============================================================================
-- P4 (PROTECTED - NOT APPLIED): partners may boost a listing they hold an
-- approved affiliate partnership for.
-- ============================================================================
-- Changes the protected function ads_assert_publishable() from
-- supabase/add_advertising.sql (advertising billing / publishing rules) and
-- pairs with P4_partner_boosts.diff (pages/api/ads/campaigns.js).
--
-- Advertising a partner STOREFRONT or a partner LINK needs no change at all:
-- ad packages that allow external links can already point to
-- https://www.flymaddcreative.online/m/<handle> or /r/<code>, and the link
-- checker follows the redirect. P4 is only for BOOSTS of someone else's
-- listing, which today must be the advertiser's own.
--
-- The boost is still paid for by the partner with their own package; the
-- seller is not charged and their listing content is unchanged. If the
-- partnership is revoked, the next publish check stops the boost.
-- Rollback: re-run ads_assert_publishable from supabase/add_advertising.sql.
-- ============================================================================

create or replace function ads_assert_publishable(p_campaign_id uuid)
returns void
language plpgsql
set search_path = public
as $$
declare
  c advertising_campaigns%rowtype;
  e advertising_entitlements%rowtype;
  v_unapproved integer;
  v_username text;
begin
  select * into c from advertising_campaigns where id = p_campaign_id;
  select * into e from advertising_entitlements where id = c.entitlement_id;
  if e.status <> 'used' then raise exception 'entitlement_invalid'; end if;
  if c.ends_at is not null and c.ends_at <= now() then raise exception 'campaign_expired'; end if;
  select count(*) into v_unapproved
    from advertising_campaign_media cm join advertising_media m on m.id = cm.media_id
   where cm.campaign_id = c.id and (m.status <> 'approved' or m.delivery_type <> 'upload' or m.owner_id <> c.owner_id);
  if v_unapproved > 0 then raise exception 'media_not_approved'; end if;
  if c.kind = 'ad' and not exists (select 1 from advertising_campaign_media where campaign_id = c.id) then
    raise exception 'creative_required';
  end if;
  if c.destination_type = 'external' and c.destination_checked_at is null then raise exception 'destination_unchecked'; end if;
  if c.destination_type = 'external' and c.destination_checked_at < now() - interval '7 days' then raise exception 'destination_stale'; end if;
  if c.destination_type = 'listing' then
    select username into v_username from participants where id = c.owner_id;
    if not exists (select 1 from catalogue_items where id = c.listing_id and seller_username = v_username and status = 'active')
       -- P4: or an active listing the owner is an approved, active partner for
       and not exists (
         select 1 from affiliate_memberships m
           join affiliate_offers o on o.id = m.offer_id
           join affiliate_partners p on p.id = m.partner_id
           join catalogue_items i on i.id = o.item_id
          where o.item_id = c.listing_id and i.status = 'active' and o.status = 'active'
            and m.status = 'approved' and p.status = 'active' and p.participant_id = c.owner_id) then
      raise exception 'listing_not_owned_or_inactive';
    end if;
  end if;
end;
$$;

revoke all on function ads_assert_publishable(uuid) from public, anon, authenticated;
grant execute on function ads_assert_publishable(uuid) to service_role;

-- >>>>>>>>>> docs/protected-patches/P7_multicurrency_checkout.sql
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

-- >>>>>>>>>> Ads: per-viewer frequency cap lookup (pages/api/ads/serve.js)
create index if not exists advertising_events_viewer_idx on advertising_events (viewer_key, created_at);

commit;

-- >>>>>>>>>> Verification: every row must be ok = true
with checks(check_name, ok) as (
  select 'naira withdrawal refuses without a rate', pg_get_functiondef('public.request_seller_withdrawal_ngn(uuid,numeric,text,text)'::regprocedure) like '%rate_unavailable%'
  union all select 'no made-up USD equivalent', pg_get_functiondef('public.request_seller_withdrawal_ngn(uuid,numeric,text,text)'::regprocedure) not like '%else 0.01%'
  union all select 'USD wallet sums the deduction', pg_get_functiondef('public.seller_earnings_summary(text)'::regprocedure) like '%sum(a.commission_micro)%'
  union all select 'naira wallet sums the deduction', pg_get_functiondef('public.seller_earnings_summary_ngn(text)'::regprocedure) like '%sum(a.commission_micro)%'
  union all select 'one attribution per order', exists (select 1 from pg_indexes where tablename = 'affiliate_attributions' and indexdef ilike '%unique%(order_id)%')
  union all select 'functions are server-only', not has_function_privilege('anon', 'public.request_seller_withdrawal_ngn(uuid,numeric,text,text)', 'execute')
  union all select 'P6 pending checkouts table, server-only', to_regclass('public.catalogue_pending_checkouts') is not null
    and not has_table_privilege('anon', 'public.catalogue_pending_checkouts', 'select')
  union all select 'P3 order resale columns', (select count(*) = 4 from information_schema.columns where table_name = 'catalogue_orders'
    and column_name in ('resale_membership_id', 'resale_price_usd', 'resale_floor_usd', 'resale_platform_fee_usd'))
  union all select 'P3 create_cart_checkout writes resale columns', pg_get_functiondef('public.create_cart_checkout(jsonb,jsonb)'::regprocedure) like '%resale_floor_usd%'
  union all select 'P3 create_cart_checkout keeps commission', pg_get_functiondef('public.create_cart_checkout(jsonb,jsonb)'::regprocedure) like '%seller_net_usd%'
  union all select 'P4 partner boosts allowed', pg_get_functiondef('public.ads_assert_publishable(uuid)'::regprocedure) like '%affiliate_memberships%'
  union all select 'P7 naira listings pay by Paystack only', not exists (select 1 from catalogue_items where listing_currency = 'NGN' and status <> 'deleted' and payment_methods <> '["paystack"]'::jsonb)
  union all select 'P7 GBP, EUR and GHS listings pay in USDT only', not exists (select 1 from catalogue_items where listing_currency not in ('NGN', 'USD') and status <> 'deleted' and payment_methods <> '["usdt"]'::jsonb)
  union all select 'P7 USD listings still offer card', not exists (select 1 from catalogue_items where listing_currency = 'USD' and status <> 'deleted' and not (payment_methods ? 'paystack'))
  union all select 'ads frequency-cap index', exists (select 1 from pg_indexes where indexname = 'advertising_events_viewer_idx')
  union all select 'P8 applied', exists (select 1 from information_schema.columns where table_name = 'participant_withdrawals' and column_name = 'currency')
)
select * from checks order by ok, check_name;
