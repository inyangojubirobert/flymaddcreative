-- ============================================================================
-- Merchant affiliate marketplace (docs/MERCHANT_AFFILIATE_FRAMEWORK.md)
-- ============================================================================
-- Additive. Run after add_earnings_and_payouts.sql.
--
-- One seller-controlled offer engine for four earning models:
--   referral    tracked link to a seller's listing        -> commission
--   storefront  partner's branded storefront (/m/<handle>) -> commission
--   resale      seller-authorised reseller price           -> margin above the floor
--   creative    service listings bought through the normal marketplace
--               (creative_engagements) + an optional performance offer
--
-- Orders are only READ. Attribution is recorded before payment
-- (affiliate_intents, keyed by the payment reference) and matched on the
-- server against verified orders (affiliate_match_intents), so it does not
-- depend on the buyer's app returning after payment.
--
-- Money:
--   platform-funded commission accrues now (capped by One Dream's own
--     commission on the order and the monthly budget);
--   seller-funded commission is recorded but only accrues once P1 is applied
--     (earnings_settings.seller_funded_settlement_enabled), because the
--     seller's payout must be reduced by the same amount;
--   resale margin needs P3 (checkout charging the reseller price).
-- Earnings become withdrawable when the order is withdrawable for the seller
-- under the existing rules (buyer_confirmed / released), and are held while
-- the order is disputed.
-- ============================================================================

do $$
begin
  if to_regclass('public.partner_ledger') is null then raise exception 'Run add_earnings_and_payouts.sql first'; end if;
end $$;

-- ----------------------------------------------------------------------------
-- Partners, offers, memberships
-- ----------------------------------------------------------------------------
create table if not exists affiliate_partners (
  id uuid primary key default gen_random_uuid(),
  participant_id uuid not null unique references participants(id),
  handle text not null unique check (handle ~ '^[a-z0-9][a-z0-9_-]{2,29}$'),
  display_name text not null check (char_length(display_name) between 2 and 60),
  bio text check (bio is null or char_length(bio) <= 500),
  avatar_url text check (avatar_url is null or avatar_url ~ '^https://'),
  status text not null default 'active' check (status in ('active', 'suspended')),
  suspended_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists affiliate_offers (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null unique references catalogue_items(id),
  seller_username text not null,
  allow_referral boolean not null default true,
  allow_storefront boolean not null default true,
  allow_resale boolean not null default false,
  funding text not null default 'seller' check (funding in ('seller', 'platform')),
  commission_percent numeric(5,2) not null default 10 check (commission_percent between 0 and 90),
  resale_floor_usd numeric(12,2) check (resale_floor_usd is null or resale_floor_usd > 0),
  resale_ceiling_usd numeric(12,2),
  fulfilment text not null default 'seller' check (fulfilment in ('seller', 'reseller')),
  -- Who handles what when a reseller fulfils: {"delivery": "...", "returns": "...", "disputes": "..."}
  reseller_responsibilities jsonb not null default '{}',
  approval text not null default 'auto' check (approval in ('auto', 'manual')),
  -- Presentation the partner may change; specs, stock, warranty and delivery terms always come from the listing.
  creative_rules jsonb not null default '{"own_media": true, "own_description": true}',
  status text not null default 'active' check (status in ('active', 'paused', 'ended')),
  terms_version integer not null default 1,
  seller_accepted_terms_version integer,
  seller_accepted_at timestamptz,
  starts_at timestamptz,
  ends_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint affiliate_offers_some_model check (allow_referral or allow_storefront or allow_resale),
  constraint affiliate_offers_resale check (not allow_resale or resale_floor_usd is not null),
  constraint affiliate_offers_ceiling check (resale_ceiling_usd is null or resale_ceiling_usd >= resale_floor_usd),
  constraint affiliate_offers_reseller_fulfilment check (
    fulfilment = 'seller' or (reseller_responsibilities ? 'delivery' and reseller_responsibilities ? 'returns' and reseller_responsibilities ? 'disputes'))
);
create index if not exists affiliate_offers_seller on affiliate_offers (seller_username);

create table if not exists affiliate_memberships (
  id uuid primary key default gen_random_uuid(),
  offer_id uuid not null references affiliate_offers(id),
  partner_id uuid not null references affiliate_partners(id),
  model text not null check (model in ('referral', 'storefront', 'resale')),
  status text not null default 'requested' check (status in ('requested', 'approved', 'rejected', 'revoked')),
  resale_price_usd numeric(12,2),
  terms_version integer not null,
  decided_at timestamptz,
  decided_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint affiliate_memberships_once unique (offer_id, partner_id),
  constraint affiliate_memberships_resale_price check (model <> 'resale' or resale_price_usd is not null)
);
create index if not exists affiliate_memberships_partner on affiliate_memberships (partner_id);

create table if not exists affiliate_resale_price_changes (
  id bigint generated always as identity primary key,
  membership_id uuid not null references affiliate_memberships(id),
  old_price_usd numeric(12,2),
  new_price_usd numeric(12,2) not null,
  created_at timestamptz not null default now()
);

create table if not exists affiliate_creatives (
  id uuid primary key default gen_random_uuid(),
  membership_id uuid not null references affiliate_memberships(id),
  kind text not null check (kind in ('image', 'video', 'text')),
  media_url text check (media_url is null or media_url ~ '^https://'),
  cloudinary_public_id text,
  title text check (title is null or char_length(title) <= 120),
  body text check (body is null or char_length(body) <= 1000),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  reject_reason text,
  reviewed_by uuid,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  constraint affiliate_creatives_content check (kind = 'text' and body is not null or kind <> 'text' and media_url is not null)
);

create table if not exists affiliate_collections (
  id uuid primary key default gen_random_uuid(),
  partner_id uuid not null references affiliate_partners(id),
  title text not null check (char_length(title) between 2 and 60),
  slug text not null check (slug ~ '^[a-z0-9-]{2,40}$'),
  sort_order integer not null default 100,
  created_at timestamptz not null default now(),
  constraint affiliate_collections_slug unique (partner_id, slug)
);

create table if not exists affiliate_collection_items (
  collection_id uuid not null references affiliate_collections(id) on delete cascade,
  membership_id uuid not null references affiliate_memberships(id),
  sort_order integer not null default 100,
  primary key (collection_id, membership_id)
);

-- ----------------------------------------------------------------------------
-- Links, clicks, intents, attributions
-- ----------------------------------------------------------------------------
create table if not exists affiliate_links (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^[A-Za-z0-9]{6,16}$'),
  partner_id uuid not null references affiliate_partners(id),
  target text not null check (target in ('membership', 'storefront', 'collection')),
  membership_id uuid references affiliate_memberships(id),
  collection_id uuid references affiliate_collections(id),
  clicks integer not null default 0,
  created_at timestamptz not null default now(),
  constraint affiliate_links_target check (
    (target = 'membership' and membership_id is not null) or (target = 'collection' and collection_id is not null) or target = 'storefront')
);

create table if not exists affiliate_clicks (
  id uuid primary key default gen_random_uuid(),
  link_id uuid not null references affiliate_links(id),
  partner_id uuid not null references affiliate_partners(id),
  membership_id uuid not null references affiliate_memberships(id),
  item_id uuid not null,
  visitor_hash text,
  created_at timestamptz not null default now()
);
create index if not exists affiliate_clicks_partner on affiliate_clicks (partner_id, created_at desc);

create table if not exists affiliate_intents (
  id uuid primary key default gen_random_uuid(),
  payment_ref text not null unique,       -- Paystack reference or USDT tx hash
  method text not null check (method in ('paystack', 'usdt')),
  buyer_email_hash text,                  -- md5(lower(email)); required for USDT (hashes are public on-chain)
  click_ids uuid[] not null check (cardinality(click_ids) between 1 and 20),
  status text not null default 'pending' check (status in ('pending', 'matched', 'expired')),
  matched_orders integer not null default 0,
  created_at timestamptz not null default now(),
  matched_at timestamptz,
  constraint affiliate_intents_usdt_email check (method <> 'usdt' or buyer_email_hash is not null)
);
create index if not exists affiliate_intents_pending on affiliate_intents (created_at) where status = 'pending';

create table if not exists affiliate_attributions (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null unique,          -- one product affiliate per order line
  intent_id uuid references affiliate_intents(id),
  click_id uuid references affiliate_clicks(id),
  partner_id uuid not null references affiliate_partners(id),
  membership_id uuid not null references affiliate_memberships(id),
  offer_id uuid not null references affiliate_offers(id),
  model text not null check (model in ('referral', 'storefront', 'resale')),
  funding text not null check (funding in ('seller', 'platform')),
  source text not null check (source in ('affiliate', 'resale')),
  gross_micro bigint not null,
  platform_commission_micro bigint not null default 0,
  commission_percent numeric(5,2) not null,
  commission_micro bigint not null check (commission_micro >= 0),
  status text not null check (status in ('pending', 'held', 'available', 'reversed',
    'awaiting_seller_settlement', 'awaiting_resale_checkout', 'over_budget', 'over_cap', 'excluded')),
  status_reason text,
  created_at timestamptz not null default now(),
  released_at timestamptz,
  reversed_at timestamptz
);
create index if not exists affiliate_attributions_partner on affiliate_attributions (partner_id, created_at desc);
create index if not exists affiliate_attributions_open on affiliate_attributions (status) where status in ('pending', 'held');

create table if not exists referral_rewards (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('seller', 'buyer')),
  merchant_id uuid not null references referral_merchants(id),
  referred_participant_id uuid not null references participants(id),
  order_id uuid not null,
  amount_micro bigint not null check (amount_micro > 0),
  status text not null default 'available' check (status in ('available', 'reversed')),
  created_at timestamptz not null default now(),
  constraint referral_rewards_order unique (kind, order_id)
);
create unique index if not exists referral_rewards_buyer_once on referral_rewards (referred_participant_id) where kind = 'buyer';

create table if not exists creative_engagements (
  id uuid primary key default gen_random_uuid(),
  seller_username text not null,
  partner_id uuid not null references affiliate_partners(id),
  service_item_id uuid references catalogue_items(id),   -- the partner's service listing
  order_id uuid,                                          -- the seller's purchase of it (normal checkout)
  brief text not null check (char_length(brief) between 5 and 2000),
  deliverables text check (deliverables is null or char_length(deliverables) <= 2000),
  performance_offer_id uuid references affiliate_offers(id),
  status text not null default 'proposed' check (status in ('proposed', 'accepted', 'in_progress', 'delivered', 'completed', 'cancelled')),
  created_by text not null check (created_by in ('seller', 'partner')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- Rules
-- ----------------------------------------------------------------------------

/** Platform money committed this calendar month (platform-funded commission + referral rewards). */
create or replace function affiliate_platform_spend_this_month()
returns bigint
language sql
stable
set search_path = public
as $$
  select coalesce((select sum(commission_micro) from affiliate_attributions
                    where funding = 'platform' and status in ('pending', 'held', 'available')
                      and created_at >= date_trunc('month', now())), 0)
       + coalesce((select sum(amount_micro) from referral_rewards
                    where status = 'available' and created_at >= date_trunc('month', now())), 0);
$$;

/** Joins an offer. Auto-approval follows the seller's setting. */
create or replace function affiliate_join_offer(p_partner uuid, p_offer uuid, p_model text, p_resale_price numeric)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  o affiliate_offers%rowtype;
  pt affiliate_partners%rowtype;
  seller_name text;
  existing affiliate_memberships%rowtype;
  new_id uuid;
  st text;
begin
  select * into pt from affiliate_partners where id = p_partner;
  if not found or pt.status <> 'active' then raise exception 'partner_inactive'; end if;
  select * into o from affiliate_offers where id = p_offer for update;
  if not found or o.status <> 'active' or (o.ends_at is not null and o.ends_at < now()) then raise exception 'offer_unavailable'; end if;
  if o.funding = 'seller' and coalesce(o.seller_accepted_terms_version, 0) <> o.terms_version then raise exception 'offer_not_accepted_by_seller'; end if;
  select username into seller_name from participants where id = pt.participant_id;
  if lower(seller_name) = lower(o.seller_username) then raise exception 'own_listing'; end if;

  if p_model = 'referral' and not o.allow_referral then raise exception 'model_not_allowed'; end if;
  if p_model = 'storefront' and not o.allow_storefront then raise exception 'model_not_allowed'; end if;
  if p_model = 'resale' then
    if not o.allow_resale then raise exception 'model_not_allowed'; end if;
    if p_resale_price is null or p_resale_price < o.resale_floor_usd
       or (o.resale_ceiling_usd is not null and p_resale_price > o.resale_ceiling_usd) then
      raise exception 'resale_price_out_of_range';
    end if;
  elsif p_model not in ('referral', 'storefront') then raise exception 'model_not_allowed';
  end if;

  select * into existing from affiliate_memberships where offer_id = p_offer and partner_id = p_partner;
  if found then
    if existing.status in ('rejected', 'revoked') then raise exception 'membership_closed'; end if;
    return jsonb_build_object('membership_id', existing.id, 'status', existing.status, 'already_member', true);
  end if;

  st := case when o.approval = 'auto' then 'approved' else 'requested' end;
  insert into affiliate_memberships (offer_id, partner_id, model, status, resale_price_usd, terms_version, decided_at)
  values (p_offer, p_partner, p_model, st, case when p_model = 'resale' then p_resale_price end, o.terms_version,
          case when st = 'approved' then now() end)
  returning id into new_id;
  if p_model = 'resale' then
    insert into affiliate_resale_price_changes (membership_id, new_price_usd) values (new_id, p_resale_price);
  end if;
  return jsonb_build_object('membership_id', new_id, 'status', st, 'already_member', false);
end;
$$;

/** Changes a reseller price: within floor/ceiling, at most once a day, logged. */
create or replace function affiliate_set_resale_price(p_partner uuid, p_membership uuid, p_price numeric)
returns void
language plpgsql
set search_path = public
as $$
declare
  m affiliate_memberships%rowtype;
  o affiliate_offers%rowtype;
begin
  select * into m from affiliate_memberships where id = p_membership and partner_id = p_partner for update;
  if not found or m.model <> 'resale' then raise exception 'membership_not_found'; end if;
  select * into o from affiliate_offers where id = m.offer_id;
  if p_price < o.resale_floor_usd or (o.resale_ceiling_usd is not null and p_price > o.resale_ceiling_usd) then
    raise exception 'resale_price_out_of_range';
  end if;
  if exists (select 1 from affiliate_resale_price_changes where membership_id = m.id and created_at > now() - interval '24 hours'
             and old_price_usd is not null) then
    raise exception 'price_change_limit';
  end if;
  insert into affiliate_resale_price_changes (membership_id, old_price_usd, new_price_usd) values (m.id, m.resale_price_usd, p_price);
  update affiliate_memberships set resale_price_usd = p_price, updated_at = now() where id = m.id;
end;
$$;

/**
 * Records a click on a partner link for one item. Storefront and collection
 * links resolve the item to the partner's approved membership for it.
 */
create or replace function affiliate_record_click(p_code text, p_item uuid, p_visitor_hash text)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  lk affiliate_links%rowtype;
  m affiliate_memberships%rowtype;
  o affiliate_offers%rowtype;
  click uuid;
begin
  select * into lk from affiliate_links where code = p_code;
  if not found then raise exception 'link_not_found'; end if;
  if not exists (select 1 from affiliate_partners where id = lk.partner_id and status = 'active') then raise exception 'partner_inactive'; end if;

  if lk.target = 'membership' then
    select * into m from affiliate_memberships where id = lk.membership_id;
  else
    select am.* into m from affiliate_memberships am join affiliate_offers ao on ao.id = am.offer_id
     where am.partner_id = lk.partner_id and ao.item_id = p_item and am.status = 'approved' limit 1;
  end if;
  if m.id is null or m.status <> 'approved' then raise exception 'membership_inactive'; end if;
  select * into o from affiliate_offers where id = m.offer_id;
  if o.status <> 'active' or (p_item is not null and o.item_id <> p_item) then raise exception 'offer_unavailable'; end if;

  insert into affiliate_clicks (link_id, partner_id, membership_id, item_id, visitor_hash)
  values (lk.id, lk.partner_id, m.id, o.item_id, left(p_visitor_hash, 64))
  returning id into click;
  update affiliate_links set clicks = clicks + 1 where id = lk.id;
  return jsonb_build_object('click_id', click, 'item_id', o.item_id, 'membership_id', m.id, 'partner_id', lk.partner_id,
                            'model', m.model, 'resale_price_usd', m.resale_price_usd);
end;
$$;

/** Records a pre-payment intent. A second intent for the same reference is refused. */
create or replace function affiliate_record_intent(p_payment_ref text, p_method text, p_email_hash text, p_click_ids uuid[])
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  existing affiliate_intents%rowtype;
  valid uuid[];
  new_id uuid;
begin
  select array_agg(id) into valid from affiliate_clicks where id = any(p_click_ids);
  if valid is null then raise exception 'no_valid_clicks'; end if;
  select * into existing from affiliate_intents where payment_ref = p_payment_ref;
  if found then
    return jsonb_build_object('intent_id', existing.id, 'already_recorded', true);
  end if;
  insert into affiliate_intents (payment_ref, method, buyer_email_hash, click_ids)
  values (p_payment_ref, p_method, p_email_hash, valid)
  on conflict (payment_ref) do nothing
  returning id into new_id;
  if new_id is null then return jsonb_build_object('already_recorded', true); end if;
  return jsonb_build_object('intent_id', new_id, 'already_recorded', false);
end;
$$;

/** Attributes one verified order to the last valid click for its item. */
create or replace function affiliate_attribute_order(p_order_id uuid, p_intent uuid, p_click_ids uuid[])
returns text
language plpgsql
set search_path = public
as $$
declare
  s earnings_settings%rowtype;
  ord jsonb;
  ck record;
  o affiliate_offers%rowtype;
  m affiliate_memberships%rowtype;
  partner_username text;
  partner_email text;
  merchant_email text;
  v_gross bigint;
  v_platform bigint;
  v_model text;
  v_source text := 'affiliate';
  v_commission bigint := 0;
  v_status text := 'pending';
  v_reason text;
  partner_month bigint;
  inserted uuid;
begin
  select * into s from earnings_settings where id;
  select to_jsonb(co) into ord from catalogue_orders co where co.id = p_order_id;
  if ord is null then return 'order_missing'; end if;
  if exists (select 1 from affiliate_attributions where order_id = p_order_id) then return 'already_attributed'; end if;

  -- Last valid click for this item, inside the window, before the order.
  select c.*, ap.participant_id into ck
    from affiliate_clicks c join affiliate_partners ap on ap.id = c.partner_id
   where c.id = any(p_click_ids) and c.item_id = (ord->>'item_id')::uuid
     and c.created_at <= (ord->>'created_at')::timestamptz
     and c.created_at >= (ord->>'created_at')::timestamptz - make_interval(days => s.affiliate_attribution_days)
     and ap.status = 'active'
   order by c.created_at desc limit 1;
  if not found then return 'no_matching_click'; end if;

  select * into m from affiliate_memberships where id = ck.membership_id;
  select * into o from affiliate_offers where id = m.offer_id;
  if m.status <> 'approved' then return 'membership_inactive'; end if;

  select username, email into partner_username, partner_email from participants where id = ck.participant_id;
  select rm.email into merchant_email from merchant_participant_links mpl join referral_merchants rm on rm.id = mpl.merchant_id
   where mpl.participant_id = ck.participant_id;

  v_gross := round(coalesce((ord->>'amount_usd')::numeric, 0) * 1000000)::bigint;
  v_platform := round(coalesce((ord->>'commission_usd')::numeric, 0) * 1000000)::bigint;
  v_model := m.model;

  if lower(partner_username) = lower(ord->>'seller_username') then
    v_status := 'excluded'; v_reason := 'partner_is_seller';
  elsif lower(coalesce(partner_email, '')) = lower(coalesce(ord->>'buyer_email', '-'))
     or lower(coalesce(merchant_email, '')) = lower(coalesce(ord->>'buyer_email', '-')) then
    v_status := 'excluded'; v_reason := 'partner_is_buyer';
  elsif v_model = 'resale' then
    if s.resale_checkout_enabled and (ord->>'resale_membership_id') = m.id::text then
      -- P3: the order carries the reseller price and the floor it was sold against.
      v_source := 'resale';
      v_commission := greatest(0, round(((ord->>'resale_price_usd')::numeric - (ord->>'resale_floor_usd')::numeric)
                                        * coalesce((ord->>'quantity')::integer, 1) * 1000000)::bigint
                                  - round(coalesce((ord->>'resale_platform_fee_usd')::numeric, 0) * 1000000)::bigint);
    elsif o.allow_referral then
      v_model := 'referral';             -- sold at the seller's price: earns the referral commission
    else
      v_status := 'awaiting_resale_checkout'; v_reason := 'reseller pricing needs P3';
    end if;
  end if;

  if v_status = 'pending' and v_source = 'affiliate' then
    v_commission := floor(v_gross * o.commission_percent / 100)::bigint;
    if o.funding = 'seller' then
      v_commission := least(v_commission, greatest(0, v_gross - v_platform));     -- never more than the seller's net
      if not s.seller_funded_settlement_enabled then
        v_status := 'awaiting_seller_settlement'; v_reason := 'seller-funded commission needs P1';
      end if;
    else
      v_commission := least(v_commission, floor(v_platform * s.platform_share_max_percent / 100)::bigint);
      if affiliate_platform_spend_this_month() + v_commission > s.platform_monthly_budget_micro then
        v_status := 'over_budget'; v_reason := 'monthly platform budget reached'; v_commission := 0;
      end if;
    end if;
  end if;

  if v_status = 'pending' and s.partner_monthly_cap_micro is not null then
    select coalesce(sum(commission_micro), 0) into partner_month from affiliate_attributions
     where partner_id = ck.partner_id and status in ('pending', 'held', 'available') and created_at >= date_trunc('month', now());
    if partner_month + v_commission > s.partner_monthly_cap_micro then
      v_status := 'over_cap'; v_reason := 'partner monthly cap reached'; v_commission := 0;
    end if;
  end if;
  if v_status = 'pending' and v_commission = 0 then v_status := 'excluded'; v_reason := coalesce(v_reason, 'zero commission'); end if;

  insert into affiliate_attributions (order_id, intent_id, click_id, partner_id, membership_id, offer_id, model, funding, source,
    gross_micro, platform_commission_micro, commission_percent, commission_micro, status, status_reason)
  values (p_order_id, p_intent, ck.id, ck.partner_id, m.id, o.id, v_model, o.funding, v_source,
    v_gross, v_platform, o.commission_percent,
    case when v_status in ('pending', 'awaiting_seller_settlement') then v_commission else 0 end, v_status, v_reason)
  on conflict (order_id) do nothing
  returning id into inserted;
  if inserted is null then return 'already_attributed'; end if;

  if v_status = 'pending' then
    perform partner_ledger_post('participant', ck.participant_id, v_source, 'pending', v_commission, 'accrue',
                                'attribution', inserted::text, 'attribution:' || inserted || ':accrue');
  end if;
  return v_status;
end;
$$;

/**
 * P3 orders: a listing sold at a reseller's price belongs to that reseller,
 * with or without a click. Reads the order through to_jsonb so this stays
 * inert until P3 adds catalogue_orders.resale_* columns.
 */
create or replace function affiliate_attribute_resale_orders(p_days integer default 30)
returns integer
language plpgsql
set search_path = public
as $$
declare
  s earnings_settings%rowtype;
  ord jsonb;
  m affiliate_memberships%rowtype;
  participant uuid;
  margin bigint;
  inserted uuid;
  n integer := 0;
begin
  select * into s from earnings_settings where id;
  if not s.resale_checkout_enabled then return 0; end if;
  for ord in select to_jsonb(co) from catalogue_orders co
              where co.created_at > now() - make_interval(days => p_days)
                and not exists (select 1 from affiliate_attributions a where a.order_id = co.id) loop
    continue when ord->>'resale_membership_id' is null;
    select * into m from affiliate_memberships where id = (ord->>'resale_membership_id')::uuid;
    continue when not found;
    select participant_id into participant from affiliate_partners where id = m.partner_id;
    margin := greatest(0, round(((ord->>'resale_price_usd')::numeric - (ord->>'resale_floor_usd')::numeric)
                                * coalesce((ord->>'quantity')::integer, 1) * 1000000)::bigint
                          - round(coalesce((ord->>'resale_platform_fee_usd')::numeric, 0) * 1000000)::bigint);
    insert into affiliate_attributions (order_id, partner_id, membership_id, offer_id, model, funding, source,
      gross_micro, platform_commission_micro, commission_percent, commission_micro, status)
    values ((ord->>'id')::uuid, m.partner_id, m.id, m.offer_id, 'resale', 'seller', 'resale',
      round(coalesce((ord->>'amount_usd')::numeric, 0) * 1000000)::bigint,
      round(coalesce((ord->>'commission_usd')::numeric, 0) * 1000000)::bigint, 0, margin,
      case when margin > 0 then 'pending' else 'excluded' end)
    on conflict (order_id) do nothing
    returning id into inserted;
    if inserted is not null and margin > 0 then
      perform partner_ledger_post('participant', participant, 'resale', 'pending', margin, 'accrue',
                                  'attribution', inserted::text, 'attribution:' || inserted || ':accrue');
      n := n + 1;
    end if;
  end loop;
  return n;
end;
$$;

/** Server-side matching of pre-payment intents against verified orders. */
create or replace function affiliate_match_intents(p_limit integer default 200)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  s earnings_settings%rowtype;
  i affiliate_intents%rowtype;
  o record;
  matched integer := 0;
  expired integer := 0;
  n integer;
begin
  select * into s from earnings_settings where id;
  for i in select * from affiliate_intents where status = 'pending' order by created_at limit p_limit for update skip locked loop
    n := 0;
    for o in
      select co.id, co.buyer_email from catalogue_checkouts ck join catalogue_orders co on co.checkout_id = ck.id
       where ck.payment_ref = i.payment_ref
      union
      select co.id, co.buyer_email from catalogue_orders co where co.payment_ref = i.payment_ref
    loop
      -- USDT hashes are public: only the buyer (who knows the checkout email) can claim one.
      continue when i.buyer_email_hash is not null and i.buyer_email_hash <> md5(lower(coalesce(o.buyer_email, '')));
      perform affiliate_attribute_order(o.id, i.id, i.click_ids);
      n := n + 1;
    end loop;
    if n > 0 then
      update affiliate_intents set status = 'matched', matched_orders = n, matched_at = now() where id = i.id;
      matched := matched + 1;
    elsif i.created_at < now() - make_interval(days => s.affiliate_attribution_days) then
      update affiliate_intents set status = 'expired' where id = i.id;
      expired := expired + 1;
    end if;
  end loop;
  return jsonb_build_object('intents_matched', matched, 'intents_expired', expired,
                            'resale_orders', affiliate_attribute_resale_orders());
end;
$$;

/**
 * Moves attributions with their orders: released when the order is
 * withdrawable for the seller (buyer_confirmed / released), held while it is
 * disputed. Then pays referral rewards on newly confirmed orders.
 */
create or replace function affiliate_advance(p_limit integer default 500)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  a record;
  participant uuid;
  released integer := 0;
  held integer := 0;
  rewards integer;
begin
  for a in select at.*, co.status as order_status from affiliate_attributions at
             join catalogue_orders co on co.id = at.order_id
            where at.status in ('pending', 'held') order by at.created_at limit p_limit for update of at loop
    select participant_id into participant from affiliate_partners where id = a.partner_id;
    if a.order_status in ('buyer_confirmed', 'released') then
      perform partner_ledger_move('participant', participant, a.source, 'pending', 'available', a.commission_micro, 'release',
                                  'attribution', a.id::text, 'attribution:' || a.id || ':release');
      update affiliate_attributions set status = 'available', released_at = now() where id = a.id;
      released := released + 1;
    elsif a.order_status = 'disputed' and a.status <> 'held' then
      update affiliate_attributions set status = 'held', status_reason = 'order disputed' where id = a.id;
      held := held + 1;
    elsif a.order_status in ('paid', 'pending_verification') and a.status = 'held' then
      update affiliate_attributions set status = 'pending', status_reason = null where id = a.id;
    end if;
  end loop;
  rewards := referral_rewards_process();
  return jsonb_build_object('released', released, 'held', held, 'referral_rewards', rewards);
end;
$$;

/** Seller and buyer referral rewards on confirmed orders (platform-funded, budgeted). */
create or replace function referral_rewards_process()
returns integer
language plpgsql
set search_path = public
as $$
declare
  s earnings_settings%rowtype;
  o record;
  seller record;
  buyer record;
  order_budget bigint;
  used bigint;
  amount bigint;
  n integer := 0;
  rid uuid;
begin
  select * into s from earnings_settings where id;
  for o in select co.* from catalogue_orders co
            where co.status in ('buyer_confirmed', 'released') and coalesce(co.updated_at, co.created_at) > now() - interval '60 days'
              and not exists (select 1 from referral_rewards rr where rr.order_id = co.id)
            order by co.created_at limit 1000 loop
    rid := null;
    order_budget := floor(round(coalesce(o.commission_usd, 0) * 1000000) * s.platform_share_max_percent / 100)::bigint;
    select coalesce(sum(commission_micro), 0) into used from affiliate_attributions
     where order_id = o.id and funding = 'platform' and status in ('pending', 'held', 'available');

    -- Seller referral: the merchant who referred the SELLER, for N months from the seller's registration.
    select p.id, p.created_at, ml.merchant_id, rm.email as merchant_email into seller
      from participants p join merchant_referral_links ml on ml.id = p.referred_by_merchant_link_id
      join referral_merchants rm on rm.id = ml.merchant_id
     where lower(p.username) = lower(o.seller_username);
    if found and s.seller_referral_percent > 0
       and o.created_at < seller.created_at + make_interval(months => s.seller_referral_months)
       -- never twice on one order: not if this merchant's own partner account earned on it
       and not exists (select 1 from affiliate_attributions at join affiliate_partners ap on ap.id = at.partner_id
                        join merchant_participant_links mpl on mpl.participant_id = ap.participant_id
                        where at.order_id = o.id and mpl.merchant_id = seller.merchant_id and at.status in ('pending', 'held', 'available'))
       and not exists (select 1 from merchant_participant_links mpl where mpl.merchant_id = seller.merchant_id and mpl.participant_id = seller.id)
       and lower(seller.merchant_email) <> lower(coalesce(o.buyer_email, '-')) then
      amount := least(floor(round(coalesce(o.commission_usd, 0) * 1000000) * s.seller_referral_percent / 100)::bigint,
                      greatest(0, order_budget - used));
      if amount > 0 and affiliate_platform_spend_this_month() + amount <= s.platform_monthly_budget_micro then
        insert into referral_rewards (kind, merchant_id, referred_participant_id, order_id, amount_micro)
        values ('seller', seller.merchant_id, seller.id, o.id, amount)
        on conflict do nothing returning id into rid;
        if rid is not null then
          perform partner_ledger_post('merchant', seller.merchant_id, 'referral', 'available', amount, 'accrue',
                                      'referral_reward', rid::text, 'referral:' || rid);
          used := used + amount; n := n + 1;
        end if;
      end if;
    end if;

    -- Buyer referral: first confirmed purchase of a referred participant, never on top of a product commission.
    rid := null;
    if s.buyer_referral_reward_micro > 0 and not exists (select 1 from affiliate_attributions where order_id = o.id) then
      select p.id, ml.merchant_id, rm.email as merchant_email into buyer
        from participants p join merchant_referral_links ml on ml.id = p.referred_by_merchant_link_id
        join referral_merchants rm on rm.id = ml.merchant_id
       where lower(p.email) = lower(coalesce(o.buyer_email, '-'));
      if found and lower(buyer.merchant_email) <> lower(o.buyer_email)
         and not exists (select 1 from referral_rewards where kind = 'buyer' and referred_participant_id = buyer.id) then
        amount := least(s.buyer_referral_reward_micro, greatest(0, order_budget - used));
        if amount > 0 and affiliate_platform_spend_this_month() + amount <= s.platform_monthly_budget_micro then
          insert into referral_rewards (kind, merchant_id, referred_participant_id, order_id, amount_micro)
          values ('buyer', buyer.merchant_id, buyer.id, o.id, amount)
          on conflict do nothing returning id into rid;
          if rid is not null then
            perform partner_ledger_post('merchant', buyer.merchant_id, 'referral', 'available', amount, 'accrue',
                                        'referral_reward', rid::text, 'referral:' || rid);
            n := n + 1;
          end if;
        end if;
      end if;
    end if;
  end loop;
  return n;
end;
$$;

/** Admin: reverse an attribution (refund, fraud, dispute lost). Takes it back from its current bucket. */
create or replace function affiliate_reverse_attribution(p_id uuid, p_admin uuid, p_reason text)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  a affiliate_attributions%rowtype;
  participant uuid;
begin
  select * into a from affiliate_attributions where id = p_id for update;
  if not found then raise exception 'attribution_not_found'; end if;
  if a.status = 'reversed' then return jsonb_build_object('already_reversed', true); end if;
  select participant_id into participant from affiliate_partners where id = a.partner_id;
  if a.status in ('pending', 'held') then
    perform partner_ledger_post('participant', participant, a.source, 'pending', -a.commission_micro, 'reverse',
                                'attribution', a.id::text, 'attribution:' || a.id || ':reverse', p_reason, p_admin);
  elsif a.status = 'available' then
    perform partner_ledger_post('participant', participant, a.source, 'available', -a.commission_micro, 'reverse',
                                'attribution', a.id::text, 'attribution:' || a.id || ':reverse', p_reason, p_admin);
  end if;
  update affiliate_attributions set status = 'reversed', status_reason = left(p_reason, 300), reversed_at = now() where id = a.id;
  insert into earnings_admin_audit (admin_id, action, target_type, target_id, details)
  values (p_admin, 'reverse_attribution', 'attribution', a.id::text, jsonb_build_object('reason', p_reason, 'amount_micro', a.commission_micro));
  return jsonb_build_object('already_reversed', false, 'amount_micro', a.commission_micro);
end;
$$;

/** Admin: release a held attribution whose dispute was resolved for the seller. */
create or replace function affiliate_release_held(p_id uuid, p_admin uuid, p_note text)
returns void
language plpgsql
set search_path = public
as $$
declare
  a affiliate_attributions%rowtype;
  participant uuid;
begin
  select * into a from affiliate_attributions where id = p_id for update;
  if not found or a.status <> 'held' then raise exception 'not_held'; end if;
  select participant_id into participant from affiliate_partners where id = a.partner_id;
  perform partner_ledger_move('participant', participant, a.source, 'pending', 'available', a.commission_micro, 'release',
                              'attribution', a.id::text, 'attribution:' || a.id || ':release', p_note, p_admin);
  update affiliate_attributions set status = 'available', released_at = now(), status_reason = left(p_note, 300) where id = a.id;
  insert into earnings_admin_audit (admin_id, action, target_type, target_id, details)
  values (p_admin, 'release_held_attribution', 'attribution', a.id::text, jsonb_build_object('note', p_note));
end;
$$;

-- ----------------------------------------------------------------------------
-- Server-only access
-- ----------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['affiliate_partners', 'affiliate_offers', 'affiliate_memberships', 'affiliate_resale_price_changes',
                           'affiliate_creatives', 'affiliate_collections', 'affiliate_collection_items', 'affiliate_links',
                           'affiliate_clicks', 'affiliate_intents', 'affiliate_attributions', 'referral_rewards', 'creative_engagements'] loop
    execute format('alter table %I enable row level security', t);
    execute format('revoke all on table %I from anon, authenticated, public', t);
    execute format('grant all on table %I to service_role', t);
  end loop;
end $$;

do $$
declare f text;
begin
  foreach f in array array[
    'affiliate_platform_spend_this_month()', 'affiliate_join_offer(uuid, uuid, text, numeric)',
    'affiliate_set_resale_price(uuid, uuid, numeric)', 'affiliate_record_click(text, uuid, text)',
    'affiliate_record_intent(text, text, text, uuid[])', 'affiliate_attribute_order(uuid, uuid, uuid[])',
    'affiliate_match_intents(integer)', 'affiliate_attribute_resale_orders(integer)', 'affiliate_advance(integer)', 'referral_rewards_process()',
    'affiliate_reverse_attribution(uuid, uuid, text)', 'affiliate_release_held(uuid, uuid, text)'] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $$;

-- ----------------------------------------------------------------------------
-- Verification - every row must be ok = true
-- ----------------------------------------------------------------------------
with checks(check_name, ok) as (
  select 'table ' || t, to_regclass('public.' || t) is not null
    from unnest(array['affiliate_partners', 'affiliate_offers', 'affiliate_memberships', 'affiliate_creatives',
                      'affiliate_collections', 'affiliate_links', 'affiliate_clicks', 'affiliate_intents',
                      'affiliate_attributions', 'referral_rewards', 'creative_engagements']) t
  union all select 'one attribution per order', exists (select 1 from pg_constraint where conname = 'affiliate_attributions_order_id_key')
  union all select 'one intent per payment reference', exists (select 1 from pg_constraint where conname = 'affiliate_intents_payment_ref_key')
  union all select 'function ' || f, to_regproc('public.' || f) is not null
    from unnest(array['affiliate_join_offer', 'affiliate_record_click', 'affiliate_record_intent', 'affiliate_attribute_order',
                      'affiliate_match_intents', 'affiliate_advance', 'referral_rewards_process', 'affiliate_reverse_attribution']) f
  union all select 'anon cannot read attributions', not has_table_privilege('anon', 'public.affiliate_attributions', 'select')
)
select * from checks;
