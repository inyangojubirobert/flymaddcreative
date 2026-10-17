-- ============================================================================
-- One Dream Storefront Promotion: seller videos used in One Dream's EXTERNAL
-- marketing (TikTok, Instagram, Facebook, YouTube...), with recorded consent
-- ============================================================================
-- Sellers create the content; One Dream reviews the videos sellers OPT IN,
-- selects some (several per seller allowed), and may spend up to US$10 of its
-- own external advertising budget on each selected video, within a total
-- programme budget (US$1,000 for terms v1), linking to the seller's storefront. Not cash, not a wallet balance, not a Google Play
-- product and not an in-app advertising credit.
--
--   promo_programme_terms     exact terms text per version (+ SHA-256)
--   promo_video_submissions   one opt-in per video: who, which listing/video,
--                             which terms, when, from where; review status;
--                             withdrawal of consent
--   promo_campaign_spend      One Dream's external ad spend per selected
--                             video, platform, links and reported results
--
-- Consent facts are immutable once recorded (trigger). Spend needs a
-- selected, not-withdrawn submission and can't exceed the limit of the terms
-- the seller accepted. Server-only (service role); no client access.
-- Rollback: drop the three tables and two functions (no money moves here).
-- ============================================================================

create table if not exists promo_programme_terms (
  version integer primary key,
  title text not null,
  body text not null,
  body_sha256 text not null,
  min_active_listings integer not null default 10 check (min_active_listings > 0),
  max_ad_spend_usd numeric(10,2) not null default 10 check (max_ad_spend_usd >= 0),        -- per selected video
  programme_budget_usd numeric(12,2) not null default 1000 check (programme_budget_usd >= 0), -- all videos under these terms
  is_current boolean not null default false,
  published_at timestamptz not null default now(),
  constraint promo_terms_hash check (body_sha256 = encode(sha256(convert_to(body, 'UTF8')), 'hex'))
);
create unique index if not exists promo_terms_one_current on promo_programme_terms (is_current) where is_current;

create table if not exists promo_video_submissions (
  id uuid primary key default gen_random_uuid(),
  participant_id uuid not null references participants(id),
  seller_username text not null,
  item_id uuid not null references catalogue_items(id),
  video_url text not null,
  terms_version integer not null references promo_programme_terms(version),
  terms_sha256 text not null,
  consent_text text not null,
  consent_at timestamptz not null default now(),
  consent_ip text,
  consent_user_agent text,
  status text not null default 'submitted' check (status in ('submitted', 'selected', 'not_selected', 'withdrawn')),
  review_note text,
  reviewed_by uuid,
  reviewed_at timestamptz,
  withdrawn_at timestamptz,
  withdrawal_reason text,
  created_at timestamptz not null default now(),
  constraint promo_withdrawn_consistent check ((status = 'withdrawn') = (withdrawn_at is not null))
);
-- One live submission per listing video; after a withdrawal it can be resubmitted.
create unique index if not exists promo_submissions_one_live on promo_video_submissions (item_id, video_url) where status <> 'withdrawn';
create index if not exists promo_submissions_seller on promo_video_submissions (participant_id, created_at desc);
create index if not exists promo_submissions_status on promo_video_submissions (status, created_at);

create table if not exists promo_campaign_spend (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null references promo_video_submissions(id),
  platform text not null check (platform in ('tiktok', 'instagram', 'facebook', 'youtube', 'x', 'other')),
  amount_usd numeric(10,2) not null check (amount_usd >= 0),
  spent_on date not null default current_date,
  campaign_ref text,
  campaign_url text,
  tracked_link text,
  impressions integer check (impressions is null or impressions >= 0),
  clicks integer check (clicks is null or clicks >= 0),
  notes text,
  recorded_by uuid,
  created_at timestamptz not null default now()
);
create index if not exists promo_spend_submission on promo_campaign_spend (submission_id);

-- Consent facts never change; only review and withdrawal fields do.
create or replace function promo_submissions_guard()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.participant_id is distinct from old.participant_id or new.seller_username is distinct from old.seller_username
     or new.item_id is distinct from old.item_id or new.video_url is distinct from old.video_url
     or new.terms_version is distinct from old.terms_version or new.terms_sha256 is distinct from old.terms_sha256
     or new.consent_text is distinct from old.consent_text or new.consent_at is distinct from old.consent_at
     or new.consent_ip is distinct from old.consent_ip or new.consent_user_agent is distinct from old.consent_user_agent
     or new.created_at is distinct from old.created_at then
    raise exception 'promo_consent_immutable';
  end if;
  if old.status = 'withdrawn' and new.status <> 'withdrawn' then
    raise exception 'promo_consent_withdrawn';
  end if;
  return new;
end;
$$;
drop trigger if exists promo_submissions_guard on promo_video_submissions;
create trigger promo_submissions_guard before update on promo_video_submissions
  for each row execute function promo_submissions_guard();

-- Spend only on selected, live submissions: at most the per-video limit, and
-- all spend under the same terms version within the programme budget.
create or replace function promo_spend_guard()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  sub promo_video_submissions%rowtype;
  cap numeric;
  budget numeric;
  spent numeric;
  spent_all numeric;
begin
  select * into sub from promo_video_submissions where id = new.submission_id for update;
  if not found then raise exception 'promo_submission_missing'; end if;
  if sub.status <> 'selected' then raise exception 'promo_not_selected'; end if;
  perform pg_advisory_xact_lock(hashtext('promo_budget:' || sub.terms_version));
  select max_ad_spend_usd, programme_budget_usd into cap, budget from promo_programme_terms where version = sub.terms_version;
  select coalesce(sum(amount_usd), 0) into spent from promo_campaign_spend
   where submission_id = new.submission_id and id is distinct from new.id;
  if spent + new.amount_usd > cap then raise exception 'promo_spend_over_limit'; end if;
  select coalesce(sum(c.amount_usd), 0) into spent_all from promo_campaign_spend c
    join promo_video_submissions v on v.id = c.submission_id
   where v.terms_version = sub.terms_version and c.id is distinct from new.id;
  if spent_all + new.amount_usd > budget then raise exception 'promo_budget_exhausted'; end if;
  return new;
end;
$$;
drop trigger if exists promo_spend_guard on promo_campaign_spend;
create trigger promo_spend_guard before insert or update on promo_campaign_spend
  for each row execute function promo_spend_guard();

alter table promo_programme_terms enable row level security;
alter table promo_video_submissions enable row level security;
alter table promo_campaign_spend enable row level security;
revoke all on table promo_programme_terms, promo_video_submissions, promo_campaign_spend from anon, authenticated, public;
grant all on table promo_programme_terms, promo_video_submissions, promo_campaign_spend to service_role;
revoke all on function promo_submissions_guard() from public, anon, authenticated;
revoke all on function promo_spend_guard() from public, anon, authenticated;

-- ----------------------------------------------------------------------------
-- Terms, version 1
-- ----------------------------------------------------------------------------
insert into promo_programme_terms (version, title, body, body_sha256, min_active_listings, max_ad_spend_usd, programme_budget_usd, is_current)
select 1, t.title, t.body, encode(sha256(convert_to(t.body, 'UTF8')), 'hex'), 10, 10, 1000, true
from (select 'One Dream Storefront Promotion Programme'::text as title, $terms$One Dream Storefront Promotion Programme

Create your storefront. Showcase your products. Get discovered.

One Dream Initiative promotes its marketplace by featuring selected seller-created promotional videos in its external social media and advertising campaigns. Taking part is optional.

How it works
1. Create your One Dream storefront and publish at least 10 genuine, active product or service listings.
2. Add original promotional videos to your listings (one per listing). You can submit as many of them as you like.
3. Choose, video by video, whether to submit it for external promotion.
4. One Dream reviews submitted videos and selects suitable ones for its external campaigns. Several videos may be selected, including more than one from the same seller.
5. Each selected video may receive up to US$10 of external advertising, paid for by One Dream, promoting your storefront and the One Dream marketplace. The programme has a total advertising budget of US$1,000 across all selected videos; when it is used up, One Dream may stop selecting videos or open a new round.

Your consent
By submitting your video you confirm that:
- you own the video, or have permission to use all footage, music, images, voices and other material in it for commercial advertising;
- you authorise One Dream Initiative to reproduce, edit, resize, caption, combine with One Dream branding, publish and advertise the submitted video on external platforms, including TikTok, Instagram, Facebook, YouTube and X;
- your business or storefront name, product or service details and your One Dream listing or storefront link may appear with it;
- this permission is non-exclusive and royalty-free, and you keep ownership of your original content;
- taking part does not guarantee selection, advertising spend, views, customers or sales.

Selection and value
One Dream selects videos for authenticity, originality, clarity, presentation, relevance and suitability for advertising. For a selected video, One Dream decides the campaign, platform, targeting, schedule and spend, up to US$10 per video. The promotional value is an allocation of One Dream's external advertising budget. It is not a cash reward, a withdrawable balance, a Google Play purchase or an in-app advertising credit.

Withdrawing
You can withdraw your consent at any time in the app (My Listings, External promotion) or by contacting One Dream support. Withdrawal stops future use. Content already published and advertisements already run are not automatically removed.

Taking part is optional
You can show a promotional video on your storefront without entering this programme. Declining does not affect your ability to list or sell on One Dream.$terms$::text as body) t
where not exists (select 1 from promo_programme_terms where version = 1);

-- Verification - every row must be ok = true
with checks(check_name, ok) as (
  select 'tables exist', to_regclass('public.promo_video_submissions') is not null and to_regclass('public.promo_campaign_spend') is not null
  union all select 'current terms published', exists (select 1 from promo_programme_terms where is_current)
  union all select 'terms hash matches text', not exists (select 1 from promo_programme_terms where body_sha256 <> encode(sha256(convert_to(body, 'UTF8')), 'hex'))
  union all select 'consent is immutable', exists (select 1 from pg_trigger where tgname = 'promo_submissions_guard')
  union all select 'spend capped per video and by programme budget', exists (select 1 from pg_trigger where tgname = 'promo_spend_guard')
  union all select 'v1: $10 per video, $1,000 budget', exists (select 1 from promo_programme_terms where version = 1 and max_ad_spend_usd = 10 and programme_budget_usd = 1000)
  union all select 'server-only', not has_table_privilege('anon', 'public.promo_video_submissions', 'select')
)
select * from checks order by ok, check_name;
