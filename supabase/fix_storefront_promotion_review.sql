-- ============================================================================
-- Storefront Promotion: fixes from the review (run after
-- add_storefront_promotion.sql). Idempotent.
-- ============================================================================
--  1. Terms are immutable. Once published, a version's text, hash and limits
--     can't be changed, and a version that sellers accepted can't be deleted.
--     New wording means a new version, published with promo_publish_terms(),
--     which retires the current one and activates the new one atomically.
--  2. At most 3 FUNDED (selected) videos per seller per terms version, so one
--     seller can't take most of the budget. Unlimited submissions.
--  3. Budget is reserved at selection: each selected video commits its full
--     per-video limit (or what was actually spent, if more was recorded
--     before), and a video can't be selected if the remaining uncommitted
--     budget can't cover it.
--  4. Spend records are append-only. A mistake is corrected with a new
--     negative row that must carry a note; the running total per video can
--     never go below zero or above the limit.
--  5. Terms version 2: clearer wording ("for a chance to be featured";
--     "selection doesn't mean the full US$10 will be spent"; the 3-video
--     limit). v1 had no submissions when this was written, so v2 replaces it
--     as the current terms.
-- ============================================================================

alter table promo_programme_terms add column if not exists max_selected_per_seller integer not null default 3;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'promo_terms_max_selected') then
    alter table promo_programme_terms add constraint promo_terms_max_selected check (max_selected_per_seller > 0);
  end if;
end $$;

-- ----------------------------------------------------------------------------
-- 1. Immutable terms; atomic publishing
-- ----------------------------------------------------------------------------
create or replace function promo_terms_guard()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    if exists (select 1 from promo_video_submissions where terms_version = old.version) then
      raise exception 'promo_terms_in_use';
    end if;
    return old;
  end if;
  if new.version is distinct from old.version or new.title is distinct from old.title
     or new.body is distinct from old.body or new.body_sha256 is distinct from old.body_sha256
     or new.min_active_listings is distinct from old.min_active_listings
     or new.max_ad_spend_usd is distinct from old.max_ad_spend_usd
     or new.programme_budget_usd is distinct from old.programme_budget_usd
     or new.max_selected_per_seller is distinct from old.max_selected_per_seller
     or new.published_at is distinct from old.published_at then
    raise exception 'promo_terms_immutable';
  end if;
  return new;   -- only is_current may change
end;
$$;
drop trigger if exists promo_terms_guard on promo_programme_terms;
create trigger promo_terms_guard before update or delete on promo_programme_terms
  for each row execute function promo_terms_guard();

-- Publishes a new terms version and makes it the only current one.
create or replace function promo_publish_terms(
  p_version integer, p_title text, p_body text, p_min_active_listings integer,
  p_max_ad_spend_usd numeric, p_programme_budget_usd numeric, p_max_selected_per_seller integer)
returns integer
language plpgsql
set search_path = public
as $$
begin
  perform pg_advisory_xact_lock(hashtext('promo_terms_publish'));
  if exists (select 1 from promo_programme_terms where version = p_version) then
    raise exception 'promo_terms_version_exists';
  end if;
  update promo_programme_terms set is_current = false where is_current;
  insert into promo_programme_terms (version, title, body, body_sha256, min_active_listings, max_ad_spend_usd,
                                     programme_budget_usd, max_selected_per_seller, is_current)
  values (p_version, p_title, p_body, encode(sha256(convert_to(p_body, 'UTF8')), 'hex'), p_min_active_listings,
          p_max_ad_spend_usd, p_programme_budget_usd, p_max_selected_per_seller, true);
  return p_version;
end;
$$;

-- ----------------------------------------------------------------------------
-- 2 + 3. Selection limits and budget reservation
-- ----------------------------------------------------------------------------
-- Committed budget of one terms version: a selected video reserves its full
-- limit (or its spend, if higher); any other video counts what was spent.
create or replace function promo_committed_usd(p_terms_version integer, p_exclude uuid default null)
returns numeric
language sql
stable
set search_path = public
as $$
  select coalesce(sum(case when v.status = 'selected' then greatest(t.max_ad_spend_usd, coalesce(sp.spent, 0))
                           else coalesce(sp.spent, 0) end), 0)
    from promo_video_submissions v
    join promo_programme_terms t on t.version = v.terms_version
    left join lateral (select sum(c.amount_usd) as spent from promo_campaign_spend c where c.submission_id = v.id) sp on true
   where v.terms_version = p_terms_version and v.id is distinct from p_exclude;
$$;

create or replace function promo_selection_guard()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  t promo_programme_terms%rowtype;
  seller_selected integer;
  own_spent numeric;
begin
  if new.status <> 'selected' or old.status = 'selected' then return new; end if;
  perform pg_advisory_xact_lock(hashtext('promo_budget:' || new.terms_version));
  select * into t from promo_programme_terms where version = new.terms_version;
  select count(*) into seller_selected from promo_video_submissions
   where participant_id = new.participant_id and terms_version = new.terms_version and status = 'selected' and id <> new.id;
  if seller_selected >= t.max_selected_per_seller then raise exception 'promo_seller_limit'; end if;
  select coalesce(sum(amount_usd), 0) into own_spent from promo_campaign_spend where submission_id = new.id;
  if promo_committed_usd(new.terms_version, new.id) + greatest(t.max_ad_spend_usd, own_spent) > t.programme_budget_usd then
    raise exception 'promo_budget_committed';
  end if;
  return new;
end;
$$;
drop trigger if exists promo_selection_guard on promo_video_submissions;
create trigger promo_selection_guard before update on promo_video_submissions
  for each row execute function promo_selection_guard();

-- ----------------------------------------------------------------------------
-- 4. Append-only spend with noted corrections
-- ----------------------------------------------------------------------------
alter table promo_campaign_spend drop constraint if exists promo_campaign_spend_amount_usd_check;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'promo_spend_amount') then
    alter table promo_campaign_spend add constraint promo_spend_amount
      check (amount_usd <> 0 and (amount_usd > 0 or length(trim(coalesce(notes, ''))) >= 5));
  end if;
end $$;

create or replace function promo_spend_guard()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  sub promo_video_submissions%rowtype;
  t promo_programme_terms%rowtype;
  spent numeric;
  spent_all numeric;
begin
  if tg_op <> 'INSERT' then raise exception 'promo_spend_append_only'; end if;
  select * into sub from promo_video_submissions where id = new.submission_id for update;
  if not found then raise exception 'promo_submission_missing'; end if;
  perform pg_advisory_xact_lock(hashtext('promo_budget:' || sub.terms_version));
  select * into t from promo_programme_terms where version = sub.terms_version;
  select coalesce(sum(amount_usd), 0) into spent from promo_campaign_spend where submission_id = new.submission_id;
  if new.amount_usd > 0 then
    -- New spend: only on a selected, live video, within its limit and the budget.
    if sub.status <> 'selected' then raise exception 'promo_not_selected'; end if;
    if spent + new.amount_usd > t.max_ad_spend_usd then raise exception 'promo_spend_over_limit'; end if;
    select coalesce(sum(c.amount_usd), 0) into spent_all from promo_campaign_spend c
      join promo_video_submissions v on v.id = c.submission_id where v.terms_version = sub.terms_version;
    if spent_all + new.amount_usd > t.programme_budget_usd then raise exception 'promo_budget_exhausted'; end if;
  elsif spent + new.amount_usd < 0 then
    -- A correction can't take a video's total below zero.
    raise exception 'promo_correction_too_large';
  end if;
  return new;
end;
$$;
drop trigger if exists promo_spend_guard on promo_campaign_spend;
create trigger promo_spend_guard before insert or update or delete on promo_campaign_spend
  for each row execute function promo_spend_guard();

revoke all on function promo_terms_guard() from public, anon, authenticated;
revoke all on function promo_selection_guard() from public, anon, authenticated;
revoke all on function promo_spend_guard() from public, anon, authenticated;
revoke all on function promo_publish_terms(integer, text, text, integer, numeric, numeric, integer) from public, anon, authenticated;
revoke all on function promo_committed_usd(integer, uuid) from public, anon, authenticated;
grant execute on function promo_publish_terms(integer, text, text, integer, numeric, numeric, integer) to service_role;
grant execute on function promo_committed_usd(integer, uuid) to service_role;

-- ----------------------------------------------------------------------------
-- 5. Terms version 2 (current)
-- ----------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from promo_programme_terms where version = 2) then
    perform promo_publish_terms(2, 'One Dream Storefront Promotion Programme', $terms$One Dream Storefront Promotion Programme

Create your storefront, showcase your products and submit your promotional videos for a chance to be featured in One Dream's external advertising campaigns. Selected videos may receive up to US$10 in advertising funded by One Dream.

What this is
One Dream Initiative promotes its marketplace on external platforms using authentic videos made by its sellers. The advertising budget is One Dream's own spending to reach new customers. It is not money paid to sellers. Taking part is optional.

How it works
1. Create your One Dream storefront and publish at least 10 genuine, active product or service listings.
2. Add original promotional videos to your listings (one per listing). You can submit as many of them as you like.
3. Choose, video by video, whether to submit it for external promotion.
4. One Dream reviews submitted videos and selects suitable ones for its external campaigns. Up to 3 videos per seller can be selected and funded in each programme round, so that many different businesses are featured.
5. Each selected video may receive up to US$10 of external advertising, paid for by One Dream, promoting your storefront and the One Dream marketplace. Being selected does not mean the full US$10 will be spent: One Dream decides how much, if any, to spend on each campaign. The programme round has a total advertising budget of US$1,000 across all selected videos; when it is committed, One Dream stops selecting videos or opens a new round with new terms.

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
You can show a promotional video on your storefront without entering this programme. Declining does not affect your ability to list or sell on One Dream.$terms$, 10, 10, 1000, 3);
  end if;
end $$;

-- Verification - every row must be ok = true
with checks(check_name, ok) as (
  select 'terms v2 is the only current version', (select count(*) from promo_programme_terms where is_current) = 1 and exists (select 1 from promo_programme_terms where version = 2 and is_current)
  union all select 'v2: $10 per video, $1,000 budget, 3 per seller', exists (select 1 from promo_programme_terms where version = 2 and max_ad_spend_usd = 10 and programme_budget_usd = 1000 and max_selected_per_seller = 3)
  union all select 'terms hashes match their text', not exists (select 1 from promo_programme_terms where body_sha256 <> encode(sha256(convert_to(body, 'UTF8')), 'hex'))
  union all select 'terms are immutable', exists (select 1 from pg_trigger where tgname = 'promo_terms_guard')
  union all select 'selection reserves budget and limits per seller', exists (select 1 from pg_trigger where tgname = 'promo_selection_guard')
  union all select 'spend is append-only', exists (select 1 from pg_trigger t join pg_class c on c.oid = t.tgrelid where t.tgname = 'promo_spend_guard' and c.relname = 'promo_campaign_spend' and (t.tgtype & 8) = 8)
  union all select 'server-only', not has_function_privilege('anon', 'public.promo_publish_terms(integer,text,text,integer,numeric,numeric,integer)', 'execute')
)
select * from checks order by ok, check_name;
