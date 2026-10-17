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
