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
