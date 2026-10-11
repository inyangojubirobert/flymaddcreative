-- ============================================================================
-- Advertising & listing boosts
-- ============================================================================
-- Additive. Touches no existing table except reading participants and
-- catalogue_items through foreign keys.
--
--   advertising_packages        admin-managed catalogue (prices in USD)
--   advertising_placements      placement inventory (home / shop / search / category)
--   advertising_entitlements    one per verified purchase or admin grant
--   advertising_media           Cloudinary asset references (no binaries)
--   advertising_campaigns       ads and boosts share one engine (kind)
--   advertising_campaign_media  creatives attached to a campaign
--   advertising_events          impressions / clicks (deduplicated per viewer per hour)
--   advertising_moderation      append-only review history
--
-- Business rules live in functions so every client follows them:
--   ads_submit_campaign()  - content limits, ownership, entitlement still valid;
--                            boosts go live at once, ads go to review
--   ads_review_campaign()  - approve / reject / suspend / reinstate; every
--                            placement must have room (serialised); reinstate
--                            re-checks expiry, media, link and capacity
--   ads_extend_campaign()  - logged compensation for platform problems
--   ads_reject_media()     - withdraw a creative; live campaigns using it stop
--   triggers               - any change to a live ad's content, link or
--                            creatives sends it back to review (paused time is
--                            returned on re-approval)
--   ads_record_event()     - only for live campaigns, deduplicated
--   ads_revoke_entitlement() - refunds/revocations end the campaign
--
-- Server-only: RLS on with no policies, no client-role privileges.
-- Verify with the query at the bottom (every row ok = true).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Packages
-- ----------------------------------------------------------------------------
create table if not exists advertising_packages (
  id text primary key check (id ~ '^[a-z0-9_]{2,40}$'),
  kind text not null check (kind in ('ad', 'boost')),
  name text not null check (char_length(name) between 2 and 60),
  tagline text,
  price_usd numeric(10,2) not null check (price_usd > 0),
  duration_hours integer not null check (duration_hours between 1 and 8760),
  max_creatives integer not null default 0 check (max_creatives between 0 and 10),
  placements text[] not null default '{}',
  priority integer not null default 10 check (priority between 1 and 100),
  allow_external_link boolean not null default false,
  benefits jsonb not null default '[]',
  highlight text,
  google_play_product_id text unique,            -- must match the Play Console product id exactly
  is_active boolean not null default true,       -- false = retired / hidden
  sort_order integer not null default 100,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint advertising_packages_ad_creatives check (kind = 'boost' or max_creatives >= 1)
);

create table if not exists advertising_placements (
  key text primary key check (key ~ '^[a-z_]{2,30}$'),
  name text not null,
  max_active_ads integer not null default 10 check (max_active_ads between 0 and 100),
  is_active boolean not null default true
);

insert into advertising_placements (key, name, max_active_ads) values
  ('home', 'Home screen', 6),
  ('shop', 'Shop feed', 10),
  ('search', 'Search results', 10),
  ('category', 'Category pages', 10)
on conflict (key) do nothing;

insert into advertising_packages
  (id, kind, name, tagline, price_usd, duration_hours, max_creatives, placements, priority, allow_external_link, benefits, highlight, sort_order, google_play_product_id)
values
  ('starter_ads', 'ad', 'Starter Ads', 'Get your business seen', 10, 72, 1, '{shop,category}', 10, true,
   '["3 days of sponsored placements", "1 creative (image or video)", "Standard delivery priority", "External link + analytics"]', null, 10, 'onedream_ad_starter'),
  ('growth_ads', 'ad', 'Growth Ads', 'Reach more of the community', 20, 168, 2, '{home,shop,category}', 20, true,
   '["7 days on home and discovery", "2 creatives (image or video)", "Enhanced delivery priority", "External link + analytics"]', 'Popular', 20, 'onedream_ad_growth'),
  ('premium_ads', 'ad', 'Premium Ads', 'Premium visibility', 40, 360, 3, '{home,shop,search,category}', 30, true,
   '["15 days in premium placements", "3 creatives (image or video)", "High delivery priority", "External link + analytics"]', null, 30, 'onedream_ad_premium'),
  ('business_ads', 'ad', 'Business Ads', 'For established brands', 75, 720, 5, '{home,shop,search,category}', 40, true,
   '["30 days across all eligible placements", "5 creatives (image or video)", "Highest eligible priority", "External link + analytics"]', null, 40, 'onedream_ad_business'),
  ('quick_boost', 'boost', 'Quick Boost', 'A one-day push for a listing', 3, 24, 0, '{shop,category}', 10, false,
   '["24 hours of extra visibility", "Shop feed and category pages", "Standard boost priority"]', null, 110, 'onedream_boost_quick'),
  ('seller_boost', 'boost', 'Seller Boost', 'A week at the front of the shelf', 10, 168, 0, '{shop,search,category}', 20, false,
   '["7 days of extra visibility", "Shop, search and category", "Enhanced boost priority"]', 'Popular', 120, 'onedream_boost_seller'),
  ('power_boost', 'boost', 'Power Boost', 'A month of maximum visibility', 25, 720, 0, '{shop,search,category}', 30, false,
   '["30 days of extra visibility", "Shop, search and category", "High boost priority"]', null, 130, 'onedream_boost_power')
on conflict (id) do nothing;

-- ----------------------------------------------------------------------------
-- Entitlements (purchases / grants)
-- ----------------------------------------------------------------------------
create table if not exists advertising_entitlements (
  id uuid primary key default gen_random_uuid(),
  participant_id uuid not null references participants(id),
  package_id text not null references advertising_packages(id),
  package_snapshot jsonb not null,                -- terms as purchased
  provider text not null check (provider in ('google_play', 'admin_grant')),
  provider_ref text not null,                     -- purchase token / grant id
  order_id text,
  price_usd numeric(10,2),
  is_paid boolean not null,
  status text not null default 'available' check (status in ('available', 'used', 'refunded', 'revoked')),
  note text,
  granted_by uuid,
  revoke_reason text,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint advertising_entitlements_provider_ref_key unique (provider, provider_ref)
);
create index if not exists advertising_entitlements_owner_idx on advertising_entitlements (participant_id, status);

-- ----------------------------------------------------------------------------
-- Media (Cloudinary references only)
-- ----------------------------------------------------------------------------
create table if not exists advertising_media (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references participants(id),
  cloudinary_public_id text not null unique,
  cloudinary_asset_id text,
  resource_type text not null check (resource_type in ('image', 'video')),
  delivery_type text not null default 'authenticated' check (delivery_type in ('authenticated', 'upload')),
  format text not null,
  bytes bigint not null check (bytes > 0),
  width integer,
  height integer,
  duration_seconds numeric(8,2),
  version bigint,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'removed')),
  reviewed_by uuid,
  reviewed_at timestamptz,
  reject_reason text,
  created_at timestamptz not null default now(),
  removed_at timestamptz,
  -- Unapproved media is never publicly delivered.
  constraint advertising_media_public_only_when_approved check (delivery_type = 'authenticated' or status = 'approved')
);
create index if not exists advertising_media_owner_idx on advertising_media (owner_id, status);

-- ----------------------------------------------------------------------------
-- Campaigns
-- ----------------------------------------------------------------------------
create table if not exists advertising_campaigns (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references participants(id),
  kind text not null check (kind in ('ad', 'boost')),
  package_id text not null references advertising_packages(id),
  entitlement_id uuid not null unique references advertising_entitlements(id),
  title text not null check (char_length(title) between 2 and 80),
  body text check (body is null or char_length(body) <= 280),
  cta_label text check (cta_label is null or char_length(cta_label) <= 24),
  destination_type text not null check (destination_type in ('external', 'listing', 'profile')),
  destination_url text check (destination_url is null or (destination_url like 'https://%' and char_length(destination_url) <= 2048)),
  destination_final_url text,
  destination_checked_at timestamptz,
  listing_id uuid references catalogue_items(id),
  placements text[] not null default '{}',
  priority integer not null default 10,
  status text not null default 'draft'
    check (status in ('draft', 'pending_review', 'active', 'paused', 'rejected', 'suspended', 'revoked')),
  starts_at timestamptz,
  ends_at timestamptz,
  submitted_at timestamptz,
  reviewed_at timestamptz,
  reviewed_by uuid,
  review_note text,
  paused_at timestamptz,                         -- set while a live ad awaits re-review after an edit
  compensated_hours integer not null default 0 check (compensated_hours >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint advertising_campaigns_destination check (
    (destination_type = 'external' and destination_url is not null)
    or (destination_type = 'listing' and listing_id is not null)
    or destination_type = 'profile'
  ),
  constraint advertising_campaigns_boost_listing check (kind = 'ad' or destination_type = 'listing')
);
create index if not exists advertising_campaigns_live_idx on advertising_campaigns (status, ends_at);
create index if not exists advertising_campaigns_owner_idx on advertising_campaigns (owner_id, created_at desc);

create table if not exists advertising_campaign_media (
  campaign_id uuid not null references advertising_campaigns(id) on delete cascade,
  media_id uuid not null references advertising_media(id),
  position integer not null default 0,
  primary key (campaign_id, media_id)
);

-- ----------------------------------------------------------------------------
-- Analytics + moderation history
-- ----------------------------------------------------------------------------
create table if not exists advertising_events (
  id bigint generated always as identity primary key,
  campaign_id uuid not null references advertising_campaigns(id) on delete cascade,
  kind text not null check (kind in ('impression', 'click')),
  placement text,
  viewer_key text not null,
  bucket timestamptz not null,
  created_at timestamptz not null default now(),
  constraint advertising_events_dedupe unique (campaign_id, kind, viewer_key, bucket)
);
create index if not exists advertising_events_campaign_idx on advertising_events (campaign_id, kind);

create table if not exists advertising_moderation (
  id bigint generated always as identity primary key,
  campaign_id uuid references advertising_campaigns(id) on delete cascade,
  media_id uuid references advertising_media(id),
  entitlement_id uuid references advertising_entitlements(id),
  action text not null,
  actor text not null check (actor in ('admin', 'system', 'owner')),
  actor_id uuid,
  note text,
  created_at timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- Rules
-- ----------------------------------------------------------------------------
-- Duration policy (fair to advertisers, not gameable):
--   * The paid period starts when the campaign first goes live - admin review
--     time before that is never charged.
--   * Advertiser edits to a live ad pause it for re-review; the paused time is
--     added back on re-approval (they get the full paid exposure, never more).
--   * Admin suspension for a policy breach does NOT stop the clock, and a
--     suspended campaign cannot be reinstated after its period has ended.
--   * Platform problems (outage, wrongful suspension) are compensated by an
--     admin "extend" (ads_extend_campaign), logged, capped at the package
--     duration in total.

-- Everything that must be true for a campaign to be (or become) live.
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
  -- A website can change after it was checked: require a recent check.
  if c.destination_type = 'external' and c.destination_checked_at < now() - interval '7 days' then raise exception 'destination_stale'; end if;
  if c.destination_type = 'listing' then
    select username into v_username from participants where id = c.owner_id;
    if not exists (select 1 from catalogue_items where id = c.listing_id and seller_username = v_username and status = 'active') then
      raise exception 'listing_not_owned_or_inactive';
    end if;
  end if;
end;
$$;

-- Every placement the campaign uses must have room. A campaign paused for
-- re-review keeps its slot. Serialised with an advisory lock so two
-- concurrent approvals cannot both take the last slot.
create or replace function ads_assert_capacity(p_campaign_id uuid)
returns void
language plpgsql
set search_path = public
as $$
declare
  c advertising_campaigns%rowtype;
  v_full text;
begin
  perform pg_advisory_xact_lock(hashtext('advertising_placement_capacity'));
  select * into c from advertising_campaigns where id = p_campaign_id;
  if c.kind <> 'ad' then return; end if;
  if cardinality(c.placements) = 0 then raise exception 'placements_full'; end if;

  select p.key into v_full
    from unnest(c.placements) as want(key)
    left join advertising_placements p on p.key = want.key
   where p.key is null or not p.is_active
      or (select count(*) from advertising_campaigns x
           where x.id <> c.id and x.kind = 'ad' and x.ends_at > now() and p.key = any (x.placements)
             and (x.status = 'active' or (x.status = 'pending_review' and x.paused_at is not null))) >= p.max_active_ads
   limit 1;
  if found then raise exception 'placements_full: %', coalesce(v_full, 'unknown'); end if;
end;
$$;

-- Goes live (first time) or resumes (after a pause for re-review).
create or replace function ads_go_live(p_campaign_id uuid)
returns void
language plpgsql
set search_path = public
as $$
declare
  c advertising_campaigns%rowtype;
  v_hours integer;
begin
  select * into c from advertising_campaigns where id = p_campaign_id;
  select (package_snapshot->>'duration_hours')::int into v_hours from advertising_entitlements where id = c.entitlement_id;
  if c.starts_at is null then
    update advertising_campaigns
       set status = 'active', starts_at = now(), ends_at = now() + make_interval(hours => v_hours), paused_at = null, updated_at = now()
     where id = c.id;
  else
    -- Paused for the advertiser's own edit: give the paused time back.
    update advertising_campaigns
       set status = 'active',
           ends_at = ends_at + case when paused_at is not null then now() - paused_at else interval '0' end,
           paused_at = null, updated_at = now()
     where id = c.id;
  end if;
end;
$$;

create or replace function ads_submit_campaign(p_campaign_id uuid, p_owner_id uuid)
returns text
language plpgsql
set search_path = public
as $$
declare
  c advertising_campaigns%rowtype;
  e advertising_entitlements%rowtype;
  v_max integer;
  v_count integer;
  v_bad integer;
begin
  select * into c from advertising_campaigns where id = p_campaign_id and owner_id = p_owner_id for update;
  if not found then raise exception 'campaign_not_found'; end if;
  if c.status not in ('draft', 'rejected', 'paused') then raise exception 'campaign_not_submittable'; end if;
  if c.ends_at is not null and c.ends_at <= now() then raise exception 'campaign_expired'; end if;

  select * into e from advertising_entitlements where id = c.entitlement_id for update;
  if e.status <> 'used' or e.participant_id <> p_owner_id then raise exception 'entitlement_invalid'; end if;

  v_max := (e.package_snapshot->>'max_creatives')::int;
  select count(*) into v_count from advertising_campaign_media where campaign_id = c.id;
  select count(*) into v_bad
    from advertising_campaign_media cm join advertising_media m on m.id = cm.media_id
   where cm.campaign_id = c.id and (m.owner_id <> p_owner_id or m.status in ('rejected', 'removed'));
  if v_bad > 0 then raise exception 'media_invalid'; end if;
  if v_count > v_max then raise exception 'too_many_creatives'; end if;
  if c.kind = 'ad' and v_count < 1 then raise exception 'creative_required'; end if;

  if c.destination_type = 'external' then
    if coalesce((e.package_snapshot->>'allow_external_link')::boolean, false) is not true then raise exception 'external_link_not_allowed'; end if;
    if c.destination_checked_at is null then raise exception 'destination_unchecked'; end if;
  end if;

  if c.kind = 'boost' then
    -- Boosts promote an already-public listing: no new content to review.
    perform ads_assert_publishable(c.id);
    perform ads_go_live(c.id);
    update advertising_campaigns set submitted_at = now() where id = c.id;
    insert into advertising_moderation (campaign_id, action, actor, actor_id, note)
    values (c.id, 'boost_activated', 'system', p_owner_id, 'Boost of an existing listing');
    return 'active';
  end if;

  update advertising_campaigns set status = 'pending_review', submitted_at = now(), updated_at = now() where id = c.id;
  insert into advertising_moderation (campaign_id, action, actor, actor_id) values (c.id, 'submitted', 'owner', p_owner_id);
  return 'pending_review';
end;
$$;

create or replace function ads_review_campaign(p_campaign_id uuid, p_admin_id uuid, p_action text, p_note text)
returns text
language plpgsql
set search_path = public
as $$
declare
  c advertising_campaigns%rowtype;
begin
  select * into c from advertising_campaigns where id = p_campaign_id for update;
  if not found then raise exception 'campaign_not_found'; end if;

  if p_action = 'approve' then
    if c.status <> 'pending_review' then raise exception 'campaign_not_pending'; end if;
    perform ads_assert_publishable(c.id);
    perform ads_assert_capacity(c.id);
    perform ads_go_live(c.id);
    update advertising_campaigns set reviewed_at = now(), reviewed_by = p_admin_id, review_note = p_note where id = c.id;
  elsif p_action = 'reject' then
    if c.status <> 'pending_review' then raise exception 'campaign_not_pending'; end if;
    update advertising_campaigns set status = 'rejected', reviewed_at = now(), reviewed_by = p_admin_id, review_note = p_note, updated_at = now() where id = c.id;
  elsif p_action = 'suspend' then
    -- Policy action: the clock keeps running (see duration policy above).
    if c.status not in ('active', 'pending_review') then raise exception 'campaign_not_suspendable'; end if;
    update advertising_campaigns set status = 'suspended', paused_at = null, reviewed_at = now(), reviewed_by = p_admin_id, review_note = p_note, updated_at = now() where id = c.id;
  elsif p_action = 'reinstate' then
    if c.status <> 'suspended' then raise exception 'campaign_not_suspended'; end if;
    if c.starts_at is null then
      update advertising_campaigns set status = 'pending_review', reviewed_at = now(), reviewed_by = p_admin_id, review_note = p_note, updated_at = now() where id = c.id;
    else
      perform ads_assert_publishable(c.id);   -- includes "not expired"
      perform ads_assert_capacity(c.id);
      update advertising_campaigns set status = 'active', reviewed_at = now(), reviewed_by = p_admin_id, review_note = p_note, updated_at = now() where id = c.id;
    end if;
  else
    raise exception 'invalid_action';
  end if;

  insert into advertising_moderation (campaign_id, action, actor, actor_id, note) values (c.id, p_action, 'admin', p_admin_id, p_note);
  return (select status from advertising_campaigns where id = c.id);
end;
$$;

-- Compensation for platform problems. Total compensation is capped at the
-- package duration; an expired campaign restarts from now.
create or replace function ads_extend_campaign(p_campaign_id uuid, p_admin_id uuid, p_hours integer, p_note text)
returns timestamptz
language plpgsql
set search_path = public
as $$
declare
  c advertising_campaigns%rowtype;
  v_duration integer;
begin
  if coalesce(trim(p_note), '') = '' then raise exception 'note_required'; end if;
  select * into c from advertising_campaigns where id = p_campaign_id for update;
  if not found then raise exception 'campaign_not_found'; end if;
  if c.starts_at is null or c.status in ('revoked') then raise exception 'campaign_not_started'; end if;
  select (package_snapshot->>'duration_hours')::int into v_duration from advertising_entitlements where id = c.entitlement_id;
  if p_hours is null or p_hours < 1 or c.compensated_hours + p_hours > v_duration then raise exception 'extension_too_long'; end if;
  update advertising_campaigns
     set ends_at = greatest(ends_at, now()) + make_interval(hours => p_hours),
         compensated_hours = compensated_hours + p_hours, updated_at = now()
   where id = c.id;
  insert into advertising_moderation (campaign_id, action, actor, actor_id, note)
  values (c.id, 'extended_' || p_hours || 'h', 'admin', p_admin_id, p_note);
  return (select ends_at from advertising_campaigns where id = c.id);
end;
$$;

-- Withdraws approval of a creative (the API first makes the Cloudinary asset
-- private again). Live campaigns using it are suspended at once.
create or replace function ads_reject_media(p_media_id uuid, p_admin_id uuid, p_note text)
returns integer
language plpgsql
set search_path = public
as $$
declare
  v_suspended integer;
begin
  if coalesce(trim(p_note), '') = '' then raise exception 'note_required'; end if;
  update advertising_media
     set status = 'rejected', delivery_type = 'authenticated', reviewed_by = p_admin_id, reviewed_at = now(), reject_reason = p_note
   where id = p_media_id and status in ('pending', 'approved');
  if not found then raise exception 'media_not_found'; end if;
  update advertising_campaigns
     set status = 'suspended', paused_at = null, review_note = 'A creative was withdrawn: ' || p_note, updated_at = now()
   where status in ('active', 'pending_review')
     and id in (select campaign_id from advertising_campaign_media where media_id = p_media_id);
  get diagnostics v_suspended = row_count;
  insert into advertising_moderation (media_id, action, actor, actor_id, note) values (p_media_id, 'media_rejected', 'admin', p_admin_id, p_note);
  return v_suspended;
end;
$$;

-- Any change to what a live ad shows or where it leads withdraws its approval,
-- whoever makes the change (enforced here, not only in the API).
create or replace function ads_campaign_requires_review()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if old.status = 'active' and new.status in ('active', 'pending_review') and (
       new.title is distinct from old.title or new.body is distinct from old.body
    or new.cta_label is distinct from old.cta_label or new.destination_type is distinct from old.destination_type
    or new.destination_url is distinct from old.destination_url or new.listing_id is distinct from old.listing_id) then
    if old.kind = 'boost' then raise exception 'live_boost_locked'; end if;
    new.status := 'pending_review';
  end if;
  if old.status = 'active' and new.status = 'pending_review' then
    new.paused_at := coalesce(new.paused_at, now());
    new.submitted_at := now();
  end if;
  return new;
end;
$$;

drop trigger if exists advertising_campaigns_requires_review on advertising_campaigns;
create trigger advertising_campaigns_requires_review
  before update on advertising_campaigns
  for each row execute function ads_campaign_requires_review();

create or replace function ads_media_change_requires_review()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_campaign uuid := coalesce(new.campaign_id, old.campaign_id);
begin
  if exists (select 1 from advertising_campaigns where id = v_campaign and status = 'active' and kind = 'boost') then
    raise exception 'live_boost_locked';
  end if;
  update advertising_campaigns set status = 'pending_review' where id = v_campaign and status = 'active';
  return null;
end;
$$;

drop trigger if exists advertising_campaign_media_requires_review on advertising_campaign_media;
create trigger advertising_campaign_media_requires_review
  after insert or update or delete on advertising_campaign_media
  for each row execute function ads_media_change_requires_review();

create or replace function ads_record_event(p_campaign_id uuid, p_kind text, p_placement text, p_viewer_key text)
returns boolean
language plpgsql
set search_path = public
as $$
declare
  v_inserted integer;
begin
  if p_kind not in ('impression', 'click') or coalesce(char_length(p_viewer_key), 0) not between 8 and 128 then
    return false;
  end if;
  insert into advertising_events (campaign_id, kind, placement, viewer_key, bucket)
  select p_campaign_id, p_kind, left(p_placement, 30), p_viewer_key, date_trunc('hour', now())
   where exists (select 1 from advertising_campaigns
                  where id = p_campaign_id and status = 'active' and starts_at <= now() and ends_at > now())
  on conflict on constraint advertising_events_dedupe do nothing;
  get diagnostics v_inserted = row_count;
  return v_inserted > 0;
end;
$$;

create or replace function ads_revoke_entitlement(p_provider text, p_provider_ref text, p_status text, p_reason text)
returns integer
language plpgsql
set search_path = public
as $$
declare
  e advertising_entitlements%rowtype;
begin
  if p_status not in ('refunded', 'revoked') then raise exception 'invalid_status'; end if;
  select * into e from advertising_entitlements where provider = p_provider and provider_ref = p_provider_ref for update;
  if not found or e.status in ('refunded', 'revoked') then return 0; end if;
  update advertising_entitlements set status = p_status, revoke_reason = p_reason, revoked_at = now(), updated_at = now() where id = e.id;
  update advertising_campaigns set status = 'revoked', paused_at = null, review_note = p_reason, updated_at = now()
   where entitlement_id = e.id and status <> 'revoked';
  insert into advertising_moderation (entitlement_id, campaign_id, action, actor, note)
  values (e.id, (select id from advertising_campaigns where entitlement_id = e.id), p_status, 'system', p_reason);
  return 1;
end;
$$;

-- ----------------------------------------------------------------------------
-- Server-only access
-- ----------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['advertising_packages', 'advertising_placements', 'advertising_entitlements', 'advertising_media',
                           'advertising_campaigns', 'advertising_campaign_media', 'advertising_events', 'advertising_moderation'] loop
    execute format('alter table %I enable row level security', t);
    execute format('revoke all on table %I from anon, authenticated, public', t);
    execute format('grant all on table %I to service_role', t);
  end loop;
end $$;

do $$
declare f text;
begin
  foreach f in array array[
    'ads_assert_publishable(uuid)', 'ads_assert_capacity(uuid)', 'ads_go_live(uuid)',
    'ads_submit_campaign(uuid, uuid)', 'ads_review_campaign(uuid, uuid, text, text)',
    'ads_extend_campaign(uuid, uuid, integer, text)', 'ads_reject_media(uuid, uuid, text)',
    'ads_record_event(uuid, text, text, text)', 'ads_revoke_entitlement(text, text, text, text)',
    'ads_campaign_requires_review()', 'ads_media_change_requires_review()'] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $$;

-- ----------------------------------------------------------------------------
-- Verification - every row must be ok = true
-- ----------------------------------------------------------------------------
with checks(check_name, ok) as (
  select 'table ' || t, to_regclass('public.' || t) is not null
    from unnest(array['advertising_packages', 'advertising_placements', 'advertising_entitlements', 'advertising_media',
                      'advertising_campaigns', 'advertising_campaign_media', 'advertising_events', 'advertising_moderation']) t
  union all select 'RLS on ' || t, coalesce((select relrowsecurity from pg_class where oid = to_regclass('public.' || t)), false)
    from unnest(array['advertising_packages', 'advertising_entitlements', 'advertising_media', 'advertising_campaigns', 'advertising_events']) t
  union all select 'anon cannot read ' || t, not has_table_privilege('anon', 'public.' || t, 'select')
    from unnest(array['advertising_entitlements', 'advertising_media', 'advertising_campaigns']) t
  union all select '7 launch packages seeded', (select count(*) from advertising_packages where id in
    ('starter_ads', 'growth_ads', 'premium_ads', 'business_ads', 'quick_boost', 'seller_boost', 'power_boost')) = 7
  union all select 'Google Play product id placeholders set for the 7 launch packages',
    (select count(*) from advertising_packages where id in ('starter_ads', 'growth_ads', 'premium_ads', 'business_ads', 'quick_boost', 'seller_boost', 'power_boost')
       and google_play_product_id is not null) = 7
  union all select '4 placements', (select count(*) from advertising_placements) >= 4
  union all select 'purchase token unique', exists (select 1 from pg_constraint where conname = 'advertising_entitlements_provider_ref_key')
  union all select 'unapproved media never public', exists (select 1 from pg_constraint where conname = 'advertising_media_public_only_when_approved')
  union all select 'function ' || f, to_regproc('public.' || f) is not null
    from unnest(array['ads_submit_campaign', 'ads_review_campaign', 'ads_record_event', 'ads_revoke_entitlement',
                      'ads_extend_campaign', 'ads_reject_media', 'ads_assert_publishable', 'ads_assert_capacity', 'ads_go_live']) f
  union all select 'trigger ' || t, exists (select 1 from pg_trigger where tgname = t)
    from unnest(array['advertising_campaigns_requires_review', 'advertising_campaign_media_requires_review']) t
  union all select 'anon cannot extend campaigns', not has_function_privilege('anon', 'public.ads_extend_campaign(uuid,uuid,integer,text)', 'execute')
  union all select 'authenticated cannot record events directly', not has_function_privilege('authenticated', 'public.ads_record_event(uuid,text,text,text)', 'execute')
  union all select 'anon cannot review campaigns', not has_function_privilege('anon', 'public.ads_review_campaign(uuid,uuid,text,text)', 'execute')
)
select * from checks;
