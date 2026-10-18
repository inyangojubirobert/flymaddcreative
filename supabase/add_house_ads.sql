-- ============================================================================
-- House ads: One Dream's own ads, uploaded by admins
-- ============================================================================
-- Admin-uploaded images or videos promoting One Dream's own products, apps
-- and pages (a Play Store link, a website page, a listing or a storefront).
-- They need no advertiser, package or subscription, and never touch the paid
-- advertising tables, billing or Google Play products.
--
-- /api/ads/serve mixes them into the same placements as paid ads:
--   mode 'fill'   - shown only in ad slots no paid campaign fills (default),
--                   so paying advertisers always come first;
--   mode 'rotate' - competes with paid ads by weight.
-- Media lives in Cloudinary (public delivery, folder onedream_house_ads);
-- this table stores verified references. Impressions and clicks are counted
-- per viewer per hour, like paid ads.
-- Rollback: drop the two tables and the function (nothing else depends on them).
-- ============================================================================

create table if not exists house_ads (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(trim(title)) between 2 and 80),
  body text check (body is null or char_length(body) <= 300),
  cta_label text check (cta_label is null or char_length(cta_label) <= 24),
  destination_type text not null check (destination_type in ('external', 'listing', 'profile')),
  destination_url text,
  listing_id uuid references catalogue_items(id),
  profile_username text,
  resource_type text not null check (resource_type in ('image', 'video')),
  format text not null,
  cloudinary_public_id text not null unique,
  bytes bigint,
  width integer,
  height integer,
  duration_seconds numeric(8,2),
  version bigint,
  placements text[] not null default array['home', 'shop', 'search', 'category']::text[],
  mode text not null default 'fill' check (mode in ('fill', 'rotate')),
  weight integer not null default 10 check (weight between 1 and 100),
  starts_at timestamptz not null default now(),
  ends_at timestamptz,
  status text not null default 'active' check (status in ('active', 'paused', 'archived')),
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint house_ads_destination check (
    (destination_type = 'external' and destination_url ~ '^https://' and listing_id is null and profile_username is null)
    or (destination_type = 'listing' and listing_id is not null and destination_url is null)
    or (destination_type = 'profile' and profile_username is not null and destination_url is null)
  ),
  constraint house_ads_placements check (
    cardinality(placements) >= 1 and placements <@ array['home', 'shop', 'search', 'category']::text[]
  ),
  constraint house_ads_window check (ends_at is null or ends_at > starts_at)
);
create index if not exists house_ads_live on house_ads (status, starts_at, ends_at);

create table if not exists house_ad_events (
  id bigint generated always as identity primary key,
  house_ad_id uuid not null references house_ads(id) on delete cascade,
  kind text not null check (kind in ('impression', 'click')),
  placement text,
  viewer_key text not null,
  hour_bucket timestamptz not null,
  created_at timestamptz not null default now(),
  constraint house_ad_events_once unique (house_ad_id, kind, viewer_key, hour_bucket)
);
create index if not exists house_ad_events_ad on house_ad_events (house_ad_id, kind);

-- One impression / click per viewer, ad and hour. Returns true when counted.
create or replace function house_ads_record_event(p_house_ad_id uuid, p_kind text, p_placement text, p_viewer_key text)
returns boolean
language plpgsql
set search_path = public
as $$
declare inserted bigint;
begin
  if p_kind not in ('impression', 'click') or coalesce(p_viewer_key, '') = '' then return false; end if;
  if not exists (select 1 from house_ads where id = p_house_ad_id and status = 'active') then return false; end if;
  insert into house_ad_events (house_ad_id, kind, placement, viewer_key, hour_bucket)
  values (p_house_ad_id, p_kind, left(p_placement, 20), left(p_viewer_key, 100), date_trunc('hour', now()))
  on conflict on constraint house_ad_events_once do nothing
  returning id into inserted;
  return inserted is not null;
end;
$$;

alter table house_ads enable row level security;
alter table house_ad_events enable row level security;
revoke all on table house_ads, house_ad_events from anon, authenticated, public;
grant all on table house_ads, house_ad_events to service_role;
revoke all on function house_ads_record_event(uuid, text, text, text) from public, anon, authenticated;
grant execute on function house_ads_record_event(uuid, text, text, text) to service_role;

-- Verification - every row must be ok = true
with checks(check_name, ok) as (
  select 'tables exist', to_regclass('public.house_ads') is not null and to_regclass('public.house_ad_events') is not null
  union all select 'event counter exists', to_regprocedure('public.house_ads_record_event(uuid,text,text,text)') is not null
  union all select 'server-only', not has_table_privilege('anon', 'public.house_ads', 'select')
)
select * from checks order by ok, check_name;
