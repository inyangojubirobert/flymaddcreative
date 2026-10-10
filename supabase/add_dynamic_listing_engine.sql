-- Dynamic product & service listing engine (additive). Revision 4.
-- STATUS: FOR REVIEW - NOT YET APPLIED TO PRODUCTION.
--
-- Run order:
--   1. supabase/lockdown_catalogue_items_writes.sql (already applied)
--   2. supabase/dry_run_dynamic_listing_engine.sql (rolls back; review report)
--   3. full database backup
--   4. this file, run by the database owner in the Supabase SQL editor
--
-- Revision 4 changes (see docs/LISTING_ENGINE_REV4.md):
--   * only the database owner can change which pricing models checkout
--     accepts (no access for anon, authenticated, service_role); the
--     approver identity is recorded by the database, not supplied by the caller;
--   * product/service details are visible exactly when the listing itself is
--     visible to the caller (same RLS rule, evaluated by the database);
--   * catalogue_items.status is limited to active / paused / deleted;
--   * a draft can only point to a listing owned by the same seller, and the
--     listing's seller cannot be changed while such a draft exists;
--   * every function created here is closed to public API roles.
--
-- Scope boundary: nothing here creates, alters or drops anything on
-- catalogue_orders, usdt_payments, wallets, settlements, commissions,
-- subscriptions, boosts or any payment function/trigger/policy. Checkout
-- (create-payment-intent.js / verify-order.js) reads catalogue_items.price_usd
-- and status only; neither column's type, default or meaning changes here.
--
-- Checkout treats every non-deleted catalogue_items row as purchasable for
-- exactly one unit at price_usd, with no stock, availability, scope or
-- quantity checks. So catalogue_items only ever holds configurations where
-- that is a correct, complete sale:
--   * products: fixed price, or price per unit (one unit);
--   * services: fixed price or per session, with a written scope and terms
--     the seller confirms as the complete offering.
-- Everything else (quotations, hourly/daily/nightly/per-person/per-area/
-- retainer/per-project pricing, minimum orders, stock-limited, preorder,
-- made-to-order, out-of-stock, price ranges, pricing options) is stored in
-- catalogue_listing_drafts, which checkout never reads.
--
-- Additive: existing listing IDs, category IDs/slugs/names/parents, seller
-- records and relationships are preserved. Safe to run more than once.

begin;

-- ALTER TABLE needs a brief ACCESS EXCLUSIVE lock on catalogue_items and
-- catalogue_categories. Without a timeout the migration would queue behind any
-- open transaction and every other request would then queue behind it. With
-- the timeout it fails fast, rolls everything back, and can simply be re-run.
set local lock_timeout = '5s';

-- ---------------------------------------------------------------------------
-- 0. Pre-checks
-- ---------------------------------------------------------------------------
do $$
declare
  bad_price integer;
  bad_status text;
begin
  if to_regclass('public.catalogue_items') is null
     or to_regclass('public.catalogue_categories') is null then
    raise exception 'catalogue_items / catalogue_categories missing - run the catalogue migrations first';
  end if;

  if exists (select 1 from (values ('anon'), ('authenticated'), ('service_role')) r(n)
             where not exists (select 1 from pg_roles where rolname = r.n)) then
    raise exception 'Expected Supabase roles anon, authenticated and service_role are missing';
  end if;

  -- The listing lockdown must already be in place.
  if exists (
    select 1
    from (values ('anon'), ('authenticated')) r(n),
         (values ('INSERT'), ('UPDATE'), ('DELETE'), ('TRUNCATE')) p(n)
    where has_table_privilege(r.n, 'public.catalogue_items', p.n)
  ) then
    raise exception 'anon/authenticated can still write catalogue_items. Run supabase/lockdown_catalogue_items_writes.sql first.';
  end if;

  -- Existing rows must already satisfy the status constraint added in section 5.
  select string_agg(distinct coalesce(status, '<null>'), ', ') into bad_status
  from public.catalogue_items
  where status is null or status not in ('active', 'paused', 'deleted');
  if bad_status is not null then
    raise exception 'Cannot restrict listing status: existing listing(s) have status %. Review them first; nothing was changed.', bad_status;
  end if;

  select count(*) into bad_price
  from public.catalogue_items
  where status is distinct from 'deleted'
    and (price_usd is null
         or price_usd = 'NaN'::numeric
         or price_usd::text in ('Infinity', '-Infinity')
         or price_usd <= 0);

  if bad_price > 0 then
    raise notice 'Found % non-deleted legacy listing(s) without a valid positive price_usd. They are left untouched; any later price or status change requires a valid price.', bad_price;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 1. Pricing models (configurable; the seeds are examples, not a closed list)
-- ---------------------------------------------------------------------------
create table if not exists public.catalogue_pricing_models (
  key text primary key check (key ~ '^[a-z][a-z0-9_]{1,39}$'),
  label text not null check (char_length(btrim(label)) between 1 and 60),
  applies_to text[] not null
    check (cardinality(applies_to) between 1 and 2 and applies_to <@ array['product','service']::text[]),
  unit_hint text,
  requires_unit boolean not null default false,
  requires_price boolean not null default true,
  -- Security-sensitive: true means "one unit at price_usd is a correct and
  -- complete charge under the existing checkout". Can only be changed through
  -- catalogue_set_checkout_compatible() with a recorded approval (section 2).
  checkout_compatible boolean not null default false,
  sort_order integer not null default 100,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

-- Insert-if-missing (not ON CONFLICT) so a rerun never fires the guard
-- trigger for keys that already exist.
insert into public.catalogue_pricing_models
  (key, label, applies_to, unit_hint, requires_unit, requires_price, checkout_compatible, sort_order)
select v.key, v.label, v.applies_to, v.unit_hint, v.requires_unit, v.requires_price, v.checkout_compatible, v.sort_order
from (values
  ('fixed',            'Fixed price',          array['product','service'], null::text, false, true,  true,  10),
  ('per_unit',         'Price per unit',       array['product'],           'unit',     true,  true,  true,  20),
  ('per_session',      'Per session',          array['service'],           'session',  false, true,  true,  30),
  ('per_project',      'Per project',          array['service'],           'project',  false, true,  false, 40),
  ('hourly',           'Hourly rate',          array['service'],           'hour',     false, true,  false, 50),
  ('daily',            'Daily rate',           array['service'],           'day',      false, true,  false, 60),
  ('per_night',        'Per night',            array['service'],           'night',    false, true,  false, 70),
  ('per_person',       'Per person',           array['service'],           'person',   false, true,  false, 80),
  ('per_area',         'Per area',             array['service'],           'sq_metre', true,  true,  false, 90),
  ('monthly_retainer', 'Monthly retainer',     array['service'],           'month',    false, true,  false, 100),
  ('custom_quote',     'Request a quote',      array['product','service'], null::text, false, false, false, 110),
  ('other',            'Other (specify unit)', array['product','service'], null::text, true,  true,  false, 120)
) as v(key, label, applies_to, unit_hint, requires_unit, requires_price, checkout_compatible, sort_order)
where not exists (select 1 from public.catalogue_pricing_models m where m.key = v.key);

-- ---------------------------------------------------------------------------
-- 2. checkout_compatible protection (database-owner workflow)
-- ---------------------------------------------------------------------------
-- Who can change which pricing models checkout accepts:
--   * the database owner (the role that runs this migration - "postgres" in
--     the Supabase SQL editor) and PostgreSQL superusers, by calling
--     catalogue_set_checkout_compatible();
--   * nobody else. anon, authenticated and service_role get no write
--     privileges on catalogue_pricing_models or the approvals table and no
--     EXECUTE on the function (section 11 revokes them; the post-checks in
--     section 12 fail the migration if that is not true).
-- This is a boundary, not an absolute guarantee: the owner and superusers can
-- still alter anything, including dropping the guard triggers.
--
-- The approvals table is an append-only audit of every decision. The
-- approver identity is recorded by the database (session_user/current_user),
-- never taken from a caller-supplied value, and approval_reference is only a
-- human label for the change request.
create table if not exists public.catalogue_checkout_model_approvals (
  id bigserial primary key,
  pricing_model text not null,
  approved_value boolean not null,
  approval_reference text not null check (char_length(btrim(approval_reference)) between 3 and 200),
  recorded_session_user text not null default session_user,
  recorded_current_user text not null default current_user,
  created_at timestamptz not null default now()
);

-- Identity and timestamp are always set by the database; any value supplied
-- by the writer is discarded.
create or replace function public.catalogue_checkout_approvals_set_identity()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $$
begin
  new.recorded_session_user := session_user;
  new.recorded_current_user := current_user;
  new.created_at := now();
  return new;
end;
$$;

-- Used for row updates/deletes and for TRUNCATE.
create or replace function public.catalogue_checkout_approvals_append_only()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $$
begin
  raise exception using errcode = '42501',
    message = 'Checkout model approvals are append-only.';
end;
$$;

drop trigger if exists catalogue_checkout_approvals_set_identity on public.catalogue_checkout_model_approvals;
create trigger catalogue_checkout_approvals_set_identity
  before insert on public.catalogue_checkout_model_approvals
  for each row execute function public.catalogue_checkout_approvals_set_identity();

drop trigger if exists catalogue_checkout_approvals_append_only on public.catalogue_checkout_model_approvals;
create trigger catalogue_checkout_approvals_append_only
  before update or delete on public.catalogue_checkout_model_approvals
  for each row execute function public.catalogue_checkout_approvals_append_only();

drop trigger if exists catalogue_checkout_approvals_no_truncate on public.catalogue_checkout_model_approvals;
create trigger catalogue_checkout_approvals_no_truncate
  before truncate on public.catalogue_checkout_model_approvals
  for each statement execute function public.catalogue_checkout_approvals_append_only();

-- Every model that is currently checkout-compatible gets an audit record, so
-- the trail is complete from the start (initial seeds included).
insert into public.catalogue_checkout_model_approvals (pricing_model, approved_value, approval_reference)
select m.key, true, 'INITIAL-SEED rev4: ' || m.key
from public.catalogue_pricing_models m
where m.checkout_compatible
  and not exists (
    select 1 from public.catalogue_checkout_model_approvals a
    where a.pricing_model = m.key and a.approved_value
  );

create or replace function public.catalogue_pricing_models_guard()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  approved boolean;
  published integer;
begin
  if tg_op = 'DELETE' then
    if exists (select 1 from public.catalogue_items where pricing_model = old.key)
       or exists (select 1 from public.catalogue_listing_drafts where pricing_model = old.key) then
      raise exception using errcode = '23503',
        message = format('Pricing model %s is in use and cannot be deleted. Deactivate it instead.', old.key);
    end if;
    return old;
  end if;

  if tg_op = 'INSERT' then
    if new.checkout_compatible then
      select exists (
        select 1 from public.catalogue_checkout_model_approvals a
        where a.pricing_model = new.key and a.approved_value = true and a.created_at = now()
      ) into approved;
      if not approved then
        raise exception using errcode = '42501',
          message = 'New pricing models start as not checkout-compatible. Use catalogue_set_checkout_compatible() with an approval reference.';
      end if;
    end if;
    return new;
  end if;

  -- UPDATE
  if new.key is distinct from old.key then
    raise exception using errcode = '42501', message = 'Pricing model keys are permanent.';
  end if;

  if new.checkout_compatible is distinct from old.checkout_compatible then
    select exists (
      select 1 from public.catalogue_checkout_model_approvals a
      where a.pricing_model = new.key
        and a.approved_value = new.checkout_compatible
        and a.created_at = now()
    ) into approved;
    if not approved then
      raise exception using errcode = '42501',
        message = 'checkout_compatible can only be changed through catalogue_set_checkout_compatible() with an approval reference.';
    end if;
  end if;

  -- Never leave published listings on a model that no longer supports them.
  if (old.checkout_compatible and not new.checkout_compatible)
     or (old.is_active and not new.is_active)
     or not (old.applies_to <@ new.applies_to)
     or (new.requires_unit and not old.requires_unit) then
    select count(*) into published
    from public.catalogue_items
    where pricing_model = old.key and status is distinct from 'deleted';
    if published > 0 then
      raise exception using errcode = '23514',
        message = format('%s published listing(s) use pricing model %s. Move them to drafts or another model before restricting it.', published, old.key);
    end if;
  end if;

  return new;
end;
$$;

-- The only supported way to change checkout_compatible. SECURITY INVOKER on
-- purpose: it runs with the caller's own privileges, so a role without write
-- access to the tables cannot use it to gain any, and it additionally refuses
-- any caller that is not the table owner (or a member of the owner role), as a
-- second line of defence if EXECUTE were ever granted by mistake.
create or replace function public.catalogue_set_checkout_compatible(
  p_key text,
  p_value boolean,
  p_approval_reference text
)
returns void
language plpgsql
security invoker
set search_path = pg_catalog, public, pg_temp
as $$
declare
  owner_role name;
begin
  select pg_get_userbyid(c.relowner) into owner_role
  from pg_class c
  where c.oid = 'public.catalogue_pricing_models'::regclass;

  if not pg_has_role(current_user, owner_role, 'MEMBER') then
    raise exception using errcode = '42501',
      message = format('Only the database owner (%s) can change checkout compatibility; current role is %s.', owner_role, current_user);
  end if;

  if p_approval_reference is null or char_length(btrim(p_approval_reference)) < 3 then
    raise exception 'An approval reference is required.';
  end if;

  if not exists (select 1 from public.catalogue_pricing_models where key = p_key) then
    raise exception 'Unknown pricing model: %', p_key;
  end if;

  insert into public.catalogue_checkout_model_approvals
    (pricing_model, approved_value, approval_reference)
  values (p_key, p_value, btrim(p_approval_reference));

  update public.catalogue_pricing_models
  set checkout_compatible = p_value
  where key = p_key;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. Measurement units (picker suggestions; sellers may specify their own)
-- ---------------------------------------------------------------------------
create table if not exists public.catalogue_units (
  key text primary key check (key ~ '^[a-z][a-z0-9_]{0,29}$'),
  label text not null check (char_length(btrim(label)) between 1 and 30),
  applies_to text[] not null
    check (cardinality(applies_to) between 1 and 2 and applies_to <@ array['product','service']::text[]),
  sort_order integer not null default 100,
  is_active boolean not null default true
);

insert into public.catalogue_units (key, label, applies_to, sort_order) values
  ('piece',    'piece',    array['product'],           10),
  ('box',      'box',      array['product'],           15),
  ('pack',     'pack',     array['product'],           20),
  ('carton',   'carton',   array['product'],           30),
  ('bag',      'bag',      array['product'],           40),
  ('kg',       'kg',       array['product'],           50),
  ('tonne',    'tonne',    array['product'],           55),
  ('gram',    'gram',     array['product'],           60),
  ('millilitre','ml',     array['product'],           65),
  ('litre',    'litre',    array['product'],           70),
  ('gallon',   'gallon',   array['product'],           75),
  ('centimetre','cm',      array['product','service'], 78),
  ('metre',    'metre',    array['product','service'], 80),
  ('sq_metre', 'sq metre', array['product','service'], 90),
  ('sq_foot',  'sq foot',  array['product','service'], 95),
  ('yard',     'yard',     array['product','service'], 97),
  ('set',      'set',      array['product'],           100),
  ('pair',     'pair',     array['product'],           110),
  ('dozen',    'dozen',    array['product'],           120),
  ('bundle',   'bundle',   array['product'],           130),
  ('truckload','truckload',array['product'],           135),
  ('cubic_metre','cubic metre',array['product'],       138),
  ('roll',     'roll',     array['product'],           140),
  ('sheet',    'sheet',    array['product'],           150),
  ('trip',     'trip',     array['service'],           160),
  ('hour',     'hour',     array['service'],           170),
  ('day',      'day',      array['service'],           180),
  ('night',    'night',    array['service'],           190),
  ('session',  'session',  array['service'],           200),
  ('person',   'person',   array['service'],           210),
  ('project',  'project',  array['service'],           220),
  ('visit',    'visit',    array['service'],           230),
  ('room',     'room',     array['service'],           240),
  ('month',    'month',    array['service'],           250),
  ('licence',  'licence',  array['product'],           260),
  ('download', 'download', array['product'],           270),
  ('subscription_period', 'subscription period', array['product'], 280)
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- 4. Category listing-type settings (IDs, slugs, names, parents unchanged)
-- ---------------------------------------------------------------------------
-- listing_types: which types a category ACCEPTS. Every category, including
-- unconfigured and seller-created ones, accepts both. Narrowing it is an
-- explicit admin decision and is refused if it would strand published
-- listings (guard below).
-- suggested_listing_type: only pre-selects the seller form. Never blocks.
alter table public.catalogue_categories
  add column if not exists listing_types text[] not null default array['product','service']::text[],
  add column if not exists suggested_listing_type text;

do $$
begin
  if not exists (select 1 from pg_constraint
                 where conname = 'catalogue_categories_listing_types_check'
                   and conrelid = 'public.catalogue_categories'::regclass) then
    alter table public.catalogue_categories
      add constraint catalogue_categories_listing_types_check
      check (cardinality(listing_types) between 1 and 2
             and listing_types <@ array['product','service']::text[]);
  end if;

  if not exists (select 1 from pg_constraint
                 where conname = 'catalogue_categories_suggested_listing_type_check'
                   and conrelid = 'public.catalogue_categories'::regclass) then
    alter table public.catalogue_categories
      add constraint catalogue_categories_suggested_listing_type_check
      check (suggested_listing_type is null or suggested_listing_type in ('product','service'));
  end if;
end $$;

-- Form guidance seeded from the labelled Products / Services sections. Only
-- unset rows are touched, so admin edits survive a rerun.
update public.catalogue_categories
set suggested_listing_type = 'service'
where suggested_listing_type is null
  and slug in (
    -- Food & Grocery: Culinary & Catering Services
    'private-chefs-cooks','event-catering-services','catering','home-cooked-meals',
    'cakes-pastries-baking','outdoor-catering-bbq','meal-prep-subscriptions',
    'culinary-training-classes','bartending-beverage-services',
    'food-decoration-presentation','restaurant-kitchen-consulting',
    -- Professional Services: Business, Creative & Tech
    'business-services','graphic-design','web-development','app-development',
    'ai-automation-services','marketing-advertising','social-media-services',
    'photography-services','video-production','music-audio-services',
    'writing-editing','consulting','accounting-finance-services','education-tutoring',
    -- Professional Services: Legal Advice & Services
    'legal-services','business-corporate-law','property-real-estate-law',
    'family-matrimonial-law','criminal-defense-litigation','immigration-visa-law',
    'intellectual-property-law','employment-labour-law','contract-drafting-review',
    'tax-financial-law','dispute-resolution-mediation','wills-probate-estate',
    -- Construction: Property Improvement & Maintenance
    'building-renovation','pop-screeding-finishing','waterproofing-damp-control',
    'landscaping-exterior','building-maintenance-handyman',
    -- Construction: Technical & Professional Services
    'architectural-design','civil-structural-engineering','quantity-surveying',
    'land-surveying-site-prep','building-inspection-supervision',
    -- Artisans, Technicians & Repairs
    'appliance-repairs','phone-tablet-repairs','computer-laptop-repairs',
    'electronics-repairs','generator-repairs','solar-inverter-technicians',
    'electrical-repairs','plumbing-pipe-repairs','ac-refrigeration-repairs',
    'borehole-pump-technicians','cctv-security-technicians',
    'automotive-mechanics','auto-electricians-diagnostics','motorcycle-tricycle-repairs',
    'welding-metal-fabrication','carpentry-furniture-repairs','painting-decorating',
    'tiling-flooring','pop-ceiling-installation','locksmith-key-cutting',
    'upholstery-restoration','tailoring-alterations','shoe-making-repairs',
    'cleaning-maintenance-services','general-handyman'
  );

update public.catalogue_categories
set suggested_listing_type = 'product'
where suggested_listing_type is null
  and slug in (
    'food-groceries','drinks-beverages','snacks-confectionery','baked-goods',
    'farm-produce','meat-seafood'
  );

-- ---------------------------------------------------------------------------
-- 5. Listing columns on catalogue_items (defaults = today's behaviour)
-- ---------------------------------------------------------------------------
-- Every existing row becomes product + fixed, exactly how checkout already
-- treats it. Ambiguous rows are flagged (section 9), never reclassified.
alter table public.catalogue_items
  add column if not exists listing_type text not null default 'product',
  add column if not exists pricing_model text not null default 'fixed',
  add column if not exists price_unit text,
  -- Services only: what the price includes, and where/when/how it is
  -- delivered. Required (with confirmation) before a service is published.
  add column if not exists service_scope text,
  add column if not exists service_terms text,
  add column if not exists service_scope_confirmed boolean not null default false,
  add column if not exists needs_type_review boolean not null default false,
  add column if not exists type_review_reason text,
  add column if not exists type_reviewed_at timestamptz;

do $$
begin
  if not exists (select 1 from pg_constraint
                 where conname = 'catalogue_items_listing_type_check'
                   and conrelid = 'public.catalogue_items'::regclass) then
    alter table public.catalogue_items
      add constraint catalogue_items_listing_type_check
      check (listing_type in ('product','service'));
  end if;

  if not exists (select 1 from pg_constraint
                 where conname = 'catalogue_items_pricing_model_fkey'
                   and conrelid = 'public.catalogue_items'::regclass) then
    alter table public.catalogue_items
      add constraint catalogue_items_pricing_model_fkey
      foreign key (pricing_model) references public.catalogue_pricing_models(key);
  end if;

  if not exists (select 1 from pg_constraint
                 where conname = 'catalogue_items_price_unit_check'
                   and conrelid = 'public.catalogue_items'::regclass) then
    alter table public.catalogue_items
      add constraint catalogue_items_price_unit_check
      check (price_unit is null or char_length(btrim(price_unit)) between 1 and 30);
  end if;

  if not exists (select 1 from pg_constraint
                 where conname = 'catalogue_items_service_text_check'
                   and conrelid = 'public.catalogue_items'::regclass) then
    alter table public.catalogue_items
      add constraint catalogue_items_service_text_check
      check ((service_scope is null or char_length(btrim(service_scope)) between 20 and 2000)
         and (service_terms is null or char_length(btrim(service_terms)) between 10 and 1000));
  end if;

  -- Data integrity only: this limits the stored values to the three the apps
  -- use. It does NOT stop checkout accepting a paused listing - the payment
  -- endpoints treat every non-deleted listing as purchasable (see
  -- docs/PAYMENT_SECURITY_FINDINGS.md, item 3). Existing rows were verified
  -- in section 0, so the constraint is added fully validated.
  if not exists (select 1 from pg_constraint
                 where conname = 'catalogue_items_status_check'
                   and conrelid = 'public.catalogue_items'::regclass) then
    alter table public.catalogue_items
      add constraint catalogue_items_status_check
      check (status is not null and status in ('active', 'paused', 'deleted'));
  end if;
end $$;

create index if not exists catalogue_items_listing_type_idx
  on public.catalogue_items(listing_type);
create index if not exists catalogue_items_pricing_model_idx
  on public.catalogue_items(pricing_model);
create index if not exists catalogue_items_needs_type_review_idx
  on public.catalogue_items(seller_username) where needs_type_review;

-- ---------------------------------------------------------------------------
-- 6. Product and service details (informational display metadata only)
-- ---------------------------------------------------------------------------
-- No stock or availability fields here: checkout cannot reserve inventory
-- or check availability, so published listings make no such claim. Stock,
-- preorder and made-to-order configurations live in drafts.
create table if not exists public.catalogue_product_details (
  item_id uuid primary key references public.catalogue_items(id) on delete cascade,
  condition text check (condition in ('new','used_like_new','used_good','used_fair','refurbished','not_applicable')),
  brand text check (brand is null or char_length(btrim(brand)) between 1 and 80),
  sku text check (sku is null or char_length(btrim(sku)) between 1 and 60),
  fulfillment_methods text[] not null default '{}'::text[]
    check (fulfillment_methods <@ array['delivery','pickup','shipping','digital_delivery']::text[]),
  delivery_areas text check (delivery_areas is null or char_length(delivery_areas) <= 300),
  -- Seller's estimate; shown as an estimate, not enforced.
  estimated_dispatch_days integer check (estimated_dispatch_days is null or estimated_dispatch_days between 0 and 365),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.catalogue_service_details (
  item_id uuid primary key references public.catalogue_items(id) on delete cascade,
  service_modes text[] not null default '{}'::text[]
    check (service_modes <@ array['on_site','at_provider','remote']::text[]),
  service_area text check (service_area is null or char_length(service_area) <= 300),
  typical_duration_minutes integer check (typical_duration_minutes is null or typical_duration_minutes between 1 and 100000),
  experience_years integer check (experience_years is null or experience_years between 0 and 80),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- 7. Configurable category attributes
-- ---------------------------------------------------------------------------
-- category_id null = every category; listing_type null = both types.
-- Unconfigured categories have no rows and fall back to standard fields.
create table if not exists public.catalogue_attribute_definitions (
  id uuid primary key default gen_random_uuid(),
  category_id uuid references public.catalogue_categories(id) on delete cascade,
  listing_type text check (listing_type in ('product','service')),
  key text not null check (key ~ '^[a-z][a-z0-9_]{1,39}$'),
  label text not null check (char_length(btrim(label)) between 1 and 60),
  input_type text not null check (input_type in ('text','number','select','multi_select','boolean')),
  options jsonb not null default '[]'::jsonb check (jsonb_typeof(options) = 'array'),
  unit text check (unit is null or char_length(btrim(unit)) between 1 and 30),
  is_required boolean not null default false,
  allow_other boolean not null default true,
  min_number numeric,
  max_number numeric,
  sort_order integer not null default 100,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  check (min_number is null or max_number is null or min_number <= max_number)
);

create unique index if not exists catalogue_attribute_definitions_scope_key_unique
  on public.catalogue_attribute_definitions (
    coalesce(category_id, '00000000-0000-0000-0000-000000000000'::uuid),
    coalesce(listing_type, 'any'),
    key
  );

create table if not exists public.catalogue_item_attributes (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.catalogue_items(id) on delete cascade,
  attribute_id uuid references public.catalogue_attribute_definitions(id) on delete set null,
  -- "Other / Specify": seller-defined attribute with its own label
  custom_label text check (custom_label is null or char_length(btrim(custom_label)) between 1 and 60),
  value jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (attribute_id is not null or custom_label is not null)
);

create unique index if not exists catalogue_item_attributes_defined_unique
  on public.catalogue_item_attributes (item_id, attribute_id)
  where attribute_id is not null;
create unique index if not exists catalogue_item_attributes_custom_unique
  on public.catalogue_item_attributes (item_id, lower(btrim(custom_label)))
  where custom_label is not null;

-- ---------------------------------------------------------------------------
-- 8. Drafts (private; never read by checkout)
-- ---------------------------------------------------------------------------
create table if not exists public.catalogue_listing_drafts (
  id uuid primary key default gen_random_uuid(),
  seller_username text not null,
  listing_type text not null check (listing_type in ('product','service')),
  category_id uuid references public.catalogue_categories(id) on delete set null,
  title text not null check (char_length(btrim(title)) between 1 and 120),
  description text check (description is null or char_length(description) <= 5000),
  pricing_model text not null references public.catalogue_pricing_models(key),
  price_usd numeric check (price_usd is null or (price_usd <> 'NaN'::numeric
                                                 and price_usd::text not in ('Infinity','-Infinity')
                                                 and price_usd > 0)),
  price_max_usd numeric check (price_max_usd is null or (price_max_usd <> 'NaN'::numeric
                                                         and price_max_usd::text not in ('Infinity','-Infinity')
                                                         and price_max_usd > 0)),
  price_unit text check (price_unit is null or char_length(btrim(price_unit)) between 1 and 30),
  min_order_qty integer check (min_order_qty is null or min_order_qty >= 1),
  max_order_qty integer check (max_order_qty is null or max_order_qty >= 1),
  stock_status text check (stock_status in ('in_stock','limited','made_to_order','preorder','out_of_stock')),
  stock_quantity integer check (stock_quantity is null or stock_quantity >= 0),
  service_scope text check (service_scope is null or char_length(service_scope) <= 2000),
  service_terms text check (service_terms is null or char_length(service_terms) <= 1000),
  product_details jsonb not null default '{}'::jsonb check (jsonb_typeof(product_details) = 'object'),
  service_details jsonb not null default '{}'::jsonb check (jsonb_typeof(service_details) = 'object'),
  attributes jsonb not null default '[]'::jsonb check (jsonb_typeof(attributes) = 'array'),
  pricing_options jsonb not null default '[]'::jsonb check (jsonb_typeof(pricing_options) = 'array'),
  images jsonb not null default '[]'::jsonb check (jsonb_typeof(images) = 'array'),
  promo_video_url text,
  blocking_reasons text[] not null default '{}'::text[],
  -- Set when the API publishes a checkout-compatible draft; the published
  -- row is then governed by the catalogue_items rules.
  published_item_id uuid references public.catalogue_items(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (price_max_usd is null or price_usd is null or price_max_usd >= price_usd),
  check (max_order_qty is null or min_order_qty is null or max_order_qty >= min_order_qty)
);

create index if not exists catalogue_listing_drafts_seller_idx
  on public.catalogue_listing_drafts(seller_username, updated_at desc);

-- Pricing-model guard needs the drafts table, so it is attached here.
drop trigger if exists catalogue_pricing_models_guard on public.catalogue_pricing_models;
create trigger catalogue_pricing_models_guard
  before insert or update or delete on public.catalogue_pricing_models
  for each row execute function public.catalogue_pricing_models_guard();

-- Draft ownership, enforced by the database for every role (the future
-- drafts API must also check the logged-in seller; this is the backstop).
-- 1) a draft can only link to a listing owned by the same seller;
-- 2) a listing's seller cannot be changed while a draft of another seller
--    is linked to it, so the relationship cannot become invalid later.
create index if not exists catalogue_listing_drafts_published_item_idx
  on public.catalogue_listing_drafts(published_item_id)
  where published_item_id is not null;

create or replace function public.catalogue_listing_drafts_owner_guard()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  item_seller text;
begin
  if new.published_item_id is null then
    return new;
  end if;

  -- FOR SHARE: a concurrent seller change on this listing must wait for this
  -- draft to commit (and is then rejected by the listing guard below), or, if
  -- it committed first, this statement reads the new seller.
  select seller_username into item_seller
  from public.catalogue_items where id = new.published_item_id
  for share;

  if not found then
    raise exception using errcode = '23503',
      message = 'The published listing does not exist.';
  end if;

  if item_seller is distinct from new.seller_username then
    raise exception using errcode = '42501',
      message = 'A draft can only be linked to a listing owned by the same seller.';
  end if;

  return new;
end;
$$;

drop trigger if exists catalogue_listing_drafts_owner_guard on public.catalogue_listing_drafts;
create trigger catalogue_listing_drafts_owner_guard
  before insert or update of published_item_id, seller_username on public.catalogue_listing_drafts
  for each row execute function public.catalogue_listing_drafts_owner_guard();

create or replace function public.catalogue_items_seller_change_guard()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  linked integer;
begin
  -- Take the listing's row lock first. If a draft is being linked concurrently
  -- this waits for it to commit, and the count below (a new snapshot) then sees it.
  perform 1 from public.catalogue_items where id = new.id for update;

  select count(*) into linked
  from public.catalogue_listing_drafts d
  where d.published_item_id = new.id
    and d.seller_username is distinct from new.seller_username;

  if linked > 0 then
    raise exception using errcode = '42501',
      message = format('%s linked draft(s) belong to a different seller. Unlink them before changing this listing''s seller.', linked);
  end if;
  return new;
end;
$$;

drop trigger if exists catalogue_items_seller_change_guard on public.catalogue_items;
create trigger catalogue_items_seller_change_guard
  before update of seller_username on public.catalogue_items
  for each row
  when (old.seller_username is distinct from new.seller_username)
  execute function public.catalogue_items_seller_change_guard();

-- ---------------------------------------------------------------------------
-- 9. Flag ambiguous legacy listings for seller review (no reclassification)
-- ---------------------------------------------------------------------------
-- Only listings in categories suggested as product-only are unambiguous.
-- type_reviewed_at keeps a rerun from re-flagging confirmed listings.
-- Not in the listings trigger's column list, so this update runs no checks.
update public.catalogue_items i
set needs_type_review = true,
    type_review_reason = case
      when c.slug = 'other' then 'category_other'
      when c.suggested_listing_type = 'service' then 'category_suggests_service'
      else 'category_mixed'
    end
from public.catalogue_categories c
where c.id = i.category_id
  and i.status is distinct from 'deleted'
  and i.needs_type_review = false
  and i.type_reviewed_at is null
  and (c.slug = 'other' or c.suggested_listing_type is distinct from 'product');

-- ---------------------------------------------------------------------------
-- 10. Write-time guards
-- ---------------------------------------------------------------------------
-- Listings. Only the listings API and (until replaced) the website dashboard
-- write catalogue_items; payment code only reads it.
-- Full validation runs on insert, on ANY status change to a non-deleted
-- status (so paused -> active re-checks a legacy invalid price), and when
-- any purchase-relevant field changes. Title/description/image edits and
-- soft deletion run no checks.
-- Security definer so the checks read the configuration tables the same way
-- regardless of which role performs the write.
create or replace function public.catalogue_items_enforce_listing_rules()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  model public.catalogue_pricing_models%rowtype;
  category_types text[];
begin
  if new.status is not distinct from 'deleted' then
    return new;
  end if;

  if tg_op = 'UPDATE'
     and new.status is not distinct from old.status
     and new.price_usd is not distinct from old.price_usd
     and new.listing_type is not distinct from old.listing_type
     and new.pricing_model is not distinct from old.pricing_model
     and new.price_unit is not distinct from old.price_unit
     and new.category_id is not distinct from old.category_id
     and new.service_scope is not distinct from old.service_scope
     and new.service_terms is not distinct from old.service_terms
     and new.service_scope_confirmed is not distinct from old.service_scope_confirmed then
    return new;
  end if;

  if new.price_usd is null
     or new.price_usd = 'NaN'::numeric
     or new.price_usd::text in ('Infinity', '-Infinity')
     or new.price_usd <= 0 then
    raise exception using errcode = '23514',
      message = 'Listing price must be a positive USD amount.';
  end if;

  select * into model from public.catalogue_pricing_models where key = new.pricing_model;
  if not found or not model.is_active or not (new.listing_type = any(model.applies_to)) then
    raise exception using errcode = '23514',
      message = 'This pricing model is not available for this listing type.';
  end if;
  if not model.checkout_compatible then
    raise exception using errcode = '23514',
      message = 'This pricing model cannot be published yet. Save it as a draft.';
  end if;
  if model.requires_unit and (new.price_unit is null or btrim(new.price_unit) = '') then
    raise exception using errcode = '23514',
      message = 'This pricing model needs a unit.';
  end if;

  if new.listing_type = 'service'
     and (new.service_scope is null
          or new.service_terms is null
          or not new.service_scope_confirmed) then
    raise exception using errcode = '23514',
      message = 'A service can only be published with a defined scope and terms that the seller confirms are the complete offering. Otherwise save it as a draft.';
  end if;

  select listing_types into category_types
  from public.catalogue_categories where id = new.category_id;
  if category_types is not null and not (new.listing_type = any(category_types)) then
    raise exception using errcode = '23514',
      message = 'This category does not accept this listing type.';
  end if;

  return new;
end;
$$;

drop trigger if exists catalogue_items_enforce_listing_rules on public.catalogue_items;
create trigger catalogue_items_enforce_listing_rules
  before insert or update of price_usd, status, listing_type, pricing_model, price_unit,
                             category_id, service_scope, service_terms, service_scope_confirmed
  on public.catalogue_items
  for each row execute function public.catalogue_items_enforce_listing_rules();

-- Categories: narrowing listing_types must not strand published listings.
create or replace function public.catalogue_categories_listing_types_guard()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  stranded integer;
begin
  select count(*) into stranded
  from public.catalogue_items
  where category_id = new.id
    and status is distinct from 'deleted'
    and not (listing_type = any(new.listing_types));
  if stranded > 0 then
    raise exception using errcode = '23514',
      message = format('%s published listing(s) in this category use a listing type it would no longer accept.', stranded);
  end if;
  return new;
end;
$$;

drop trigger if exists catalogue_categories_listing_types_guard on public.catalogue_categories;
create trigger catalogue_categories_listing_types_guard
  before update of listing_types on public.catalogue_categories
  for each row
  when (old.listing_types is distinct from new.listing_types)
  execute function public.catalogue_categories_listing_types_guard();

-- ---------------------------------------------------------------------------
-- 11. Functions, row-level security and grants for the new objects
-- ---------------------------------------------------------------------------
-- Writes go through the server API (service role) only. catalogue_items'
-- own policies and grants are NOT changed here.
--
-- Supabase grants new tables and functions to anon, authenticated and
-- service_role by default, and functions to PUBLIC. Everything below removes
-- what is not needed; section 12 then verifies the effective result and
-- aborts the whole migration if it is wrong.

-- Remove objects from an earlier draft of this migration, if any exist.
drop function if exists public.catalogue_item_is_public(uuid);
drop function if exists public.catalogue_set_checkout_compatible(text, boolean, text, text);

-- Functions: closed to PUBLIC and to every API role. Trigger functions need no
-- EXECUTE privilege to fire. Only the owner/superusers can call the approval
-- function, and it refuses anyone else (section 2).
revoke all on function public.catalogue_checkout_approvals_set_identity() from public, anon, authenticated, service_role;
revoke all on function public.catalogue_checkout_approvals_append_only() from public, anon, authenticated, service_role;
revoke all on function public.catalogue_pricing_models_guard() from public, anon, authenticated, service_role;
revoke all on function public.catalogue_set_checkout_compatible(text, boolean, text) from public, anon, authenticated, service_role;
revoke all on function public.catalogue_items_enforce_listing_rules() from public, anon, authenticated, service_role;
revoke all on function public.catalogue_categories_listing_types_guard() from public, anon, authenticated, service_role;
revoke all on function public.catalogue_listing_drafts_owner_guard() from public, anon, authenticated, service_role;
revoke all on function public.catalogue_items_seller_change_guard() from public, anon, authenticated, service_role;

alter table public.catalogue_pricing_models enable row level security;
alter table public.catalogue_checkout_model_approvals enable row level security;
alter table public.catalogue_units enable row level security;
alter table public.catalogue_attribute_definitions enable row level security;
alter table public.catalogue_product_details enable row level security;
alter table public.catalogue_service_details enable row level security;
alter table public.catalogue_item_attributes enable row level security;
alter table public.catalogue_listing_drafts enable row level security;

-- Public roles: read-only on configuration and details, nothing on drafts or
-- approvals. Explicit so it does not depend on default privileges.
revoke all on public.catalogue_pricing_models, public.catalogue_units,
     public.catalogue_attribute_definitions, public.catalogue_product_details,
     public.catalogue_service_details, public.catalogue_item_attributes
  from anon, authenticated;
grant select on public.catalogue_pricing_models, public.catalogue_units,
     public.catalogue_attribute_definitions, public.catalogue_product_details,
     public.catalogue_service_details, public.catalogue_item_attributes
  to anon, authenticated;
revoke all on public.catalogue_listing_drafts from anon, authenticated;
revoke all on public.catalogue_checkout_model_approvals from anon, authenticated;

-- service_role (the server API key):
--   * pricing models: read only. Changing them is the database owner's job.
--   * approval records and their sequence: no access at all.
--   * units, attribute definitions, drafts, details, item attributes: normal
--     data access for the API, but never TRUNCATE, REFERENCES or TRIGGER.
revoke all on public.catalogue_checkout_model_approvals from service_role;
revoke all on sequence public.catalogue_checkout_model_approvals_id_seq from anon, authenticated, service_role;
revoke all on public.catalogue_pricing_models from service_role;
grant select on public.catalogue_pricing_models to service_role;
revoke all on public.catalogue_units, public.catalogue_attribute_definitions,
     public.catalogue_product_details, public.catalogue_service_details,
     public.catalogue_item_attributes, public.catalogue_listing_drafts
  from service_role;
grant select, insert, update, delete on public.catalogue_units,
     public.catalogue_attribute_definitions, public.catalogue_product_details,
     public.catalogue_service_details, public.catalogue_item_attributes,
     public.catalogue_listing_drafts
  to service_role;

drop policy if exists catalogue_pricing_models_public_read on public.catalogue_pricing_models;
create policy catalogue_pricing_models_public_read on public.catalogue_pricing_models
  for select to anon, authenticated using (is_active);

drop policy if exists catalogue_units_public_read on public.catalogue_units;
create policy catalogue_units_public_read on public.catalogue_units
  for select to anon, authenticated using (is_active);

drop policy if exists catalogue_attribute_definitions_public_read on public.catalogue_attribute_definitions;
create policy catalogue_attribute_definitions_public_read on public.catalogue_attribute_definitions
  for select to anon, authenticated using (is_active);

-- Details are readable exactly when the listing itself is readable by the
-- caller. The sub-select is evaluated with the caller's own privileges and
-- catalogue_items' own row-level security, so the existing listing read
-- policy (currently "status <> 'deleted'") is followed automatically, with
-- no copy of that rule here and no change to that policy.
drop policy if exists catalogue_product_details_public_read on public.catalogue_product_details;
create policy catalogue_product_details_public_read on public.catalogue_product_details
  for select to anon, authenticated
  using (exists (select 1 from public.catalogue_items i where i.id = catalogue_product_details.item_id));

drop policy if exists catalogue_service_details_public_read on public.catalogue_service_details;
create policy catalogue_service_details_public_read on public.catalogue_service_details
  for select to anon, authenticated
  using (exists (select 1 from public.catalogue_items i where i.id = catalogue_service_details.item_id));

drop policy if exists catalogue_item_attributes_public_read on public.catalogue_item_attributes;
create policy catalogue_item_attributes_public_read on public.catalogue_item_attributes
  for select to anon, authenticated
  using (exists (select 1 from public.catalogue_items i where i.id = catalogue_item_attributes.item_id));

-- catalogue_listing_drafts and catalogue_checkout_model_approvals: RLS on, no
-- policies, no grants to public roles -> drafts are server API only; approval
-- records are owner only.

-- ---------------------------------------------------------------------------
-- 12. Post-checks (abort the whole migration if anything is wrong)
-- ---------------------------------------------------------------------------
do $$
declare
  flagged integer;
  compatible text;
  unsupported integer;
  unaudited text;
  problems text[] := '{}';
  fn text;
  fn_oid regprocedure;
  r text;
  t text;
  p text;
  all_new constant text[] := array[
    'catalogue_pricing_models','catalogue_checkout_model_approvals','catalogue_units',
    'catalogue_attribute_definitions','catalogue_product_details','catalogue_service_details',
    'catalogue_item_attributes','catalogue_listing_drafts'];
  write_privs constant text[] := array['INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER'];
begin
  select count(*) into flagged from public.catalogue_items where needs_type_review;
  select string_agg(key, ', ' order by sort_order) into compatible
  from public.catalogue_pricing_models where checkout_compatible;
  select count(*) into unsupported
  from public.catalogue_items i
  join public.catalogue_pricing_models m on m.key = i.pricing_model
  where i.status is distinct from 'deleted' and not m.checkout_compatible;
  if unsupported > 0 then
    raise exception 'Unexpected: % published listing(s) on a non-checkout-compatible model', unsupported;
  end if;

  select string_agg(m.key, ', ') into unaudited
  from public.catalogue_pricing_models m
  where m.checkout_compatible
    and not exists (select 1 from public.catalogue_checkout_model_approvals a
                    where a.pricing_model = m.key and a.approved_value);
  if unaudited is not null then
    raise exception 'Checkout-compatible model(s) without an approval record: %', unaudited;
  end if;

  -- Functions: not executable by PUBLIC or any API role.
  foreach fn in array array[
    'public.catalogue_checkout_approvals_set_identity()',
    'public.catalogue_checkout_approvals_append_only()',
    'public.catalogue_pricing_models_guard()',
    'public.catalogue_set_checkout_compatible(text, boolean, text)',
    'public.catalogue_items_enforce_listing_rules()',
    'public.catalogue_categories_listing_types_guard()',
    'public.catalogue_listing_drafts_owner_guard()',
    'public.catalogue_items_seller_change_guard()'] loop
    fn_oid := to_regprocedure(fn);
    if fn_oid is null then
      problems := problems || (fn || ' is missing');
      continue;
    end if;
    if exists (
      select 1
      from pg_proc pr,
           aclexplode(coalesce(pr.proacl, acldefault('f', pr.proowner))) a
      where pr.oid = fn_oid and a.grantee = 0 and a.privilege_type = 'EXECUTE'
    ) then
      problems := problems || (fn || ' is executable by PUBLIC');
    end if;
    foreach r in array array['anon','authenticated','service_role'] loop
      if has_function_privilege(r, fn_oid, 'EXECUTE') then
        problems := problems || (fn || ' is executable by ' || r);
      end if;
    end loop;
  end loop;

  -- Tables: no write privileges for the public roles.
  foreach t in array all_new loop
    foreach r in array array['anon','authenticated'] loop
      foreach p in array write_privs loop
        if has_table_privilege(r, 'public.' || t, p) then
          problems := problems || (r || ' has ' || p || ' on ' || t);
        end if;
      end loop;
    end loop;
    if not (select relrowsecurity from pg_class where oid = ('public.' || t)::regclass) then
      problems := problems || ('row-level security is off on ' || t);
    end if;
  end loop;

  foreach t in array array['catalogue_listing_drafts','catalogue_checkout_model_approvals'] loop
    foreach r in array array['anon','authenticated'] loop
      if has_table_privilege(r, 'public.' || t, 'SELECT') then
        problems := problems || (r || ' can read ' || t);
      end if;
    end loop;
  end loop;

  -- service_role: no approval access, no pricing-model writes, no
  -- TRUNCATE/REFERENCES/TRIGGER on the new tables; keeps the data access the API needs.
  foreach p in array array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER'] loop
    if has_table_privilege('service_role', 'public.catalogue_checkout_model_approvals', p) then
      problems := problems || ('service_role has ' || p || ' on catalogue_checkout_model_approvals');
    end if;
  end loop;
  foreach r in array array['anon','authenticated','service_role'] loop
    if has_sequence_privilege(r, 'public.catalogue_checkout_model_approvals_id_seq', 'USAGE')
       or has_sequence_privilege(r, 'public.catalogue_checkout_model_approvals_id_seq', 'SELECT')
       or has_sequence_privilege(r, 'public.catalogue_checkout_model_approvals_id_seq', 'UPDATE') then
      problems := problems || (r || ' can use the approvals sequence');
    end if;
  end loop;
  foreach p in array write_privs loop
    if has_table_privilege('service_role', 'public.catalogue_pricing_models', p) then
      problems := problems || ('service_role has ' || p || ' on catalogue_pricing_models');
    end if;
  end loop;
  if not has_table_privilege('service_role', 'public.catalogue_pricing_models', 'SELECT') then
    problems := problems || 'service_role cannot read catalogue_pricing_models';
  end if;
  foreach t in array array['catalogue_units','catalogue_attribute_definitions','catalogue_product_details',
                           'catalogue_service_details','catalogue_item_attributes','catalogue_listing_drafts'] loop
    foreach p in array array['TRUNCATE','REFERENCES','TRIGGER'] loop
      if has_table_privilege('service_role', 'public.' || t, p) then
        problems := problems || ('service_role has ' || p || ' on ' || t);
      end if;
    end loop;
    foreach p in array array['SELECT','INSERT','UPDATE','DELETE'] loop
      if not has_table_privilege('service_role', 'public.' || t, p) then
        problems := problems || ('service_role lacks ' || p || ' on ' || t);
      end if;
    end loop;
  end loop;

  if not has_function_privilege(current_user, 'public.catalogue_set_checkout_compatible(text, boolean, text)'::regprocedure, 'EXECUTE') then
    problems := problems || 'the migration owner cannot execute catalogue_set_checkout_compatible';
  end if;

  if cardinality(problems) > 0 then
    raise exception 'Permission post-check failed (nothing was saved): %', array_to_string(problems, '; ');
  end if;

  raise notice 'Listings flagged for type review: %', flagged;
  raise notice 'Checkout-compatible pricing models: %', compatible;
  raise notice 'Permission post-checks passed';
end $$;

commit;
