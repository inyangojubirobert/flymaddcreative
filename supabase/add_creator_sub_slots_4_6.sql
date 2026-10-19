-- ============================================================================
-- Creator subscriptions: slots 4-6 per monthly price (19 Oct 2026).
-- Run ONLY AFTER `node scripts/create-google-play-subscriptions.mjs` has
-- created and activated the 18 new Play products (onedream_creator_*_s4..s6):
-- a slot listed here is offered in the app, so its Play product must exist.
-- Lets one Google account follow up to 6 creators at the same price.
-- Rollback: update digital_sub_products set is_active = false where slot > 3;
-- ============================================================================

insert into digital_sub_products (id, tier_id, slot, google_play_product_id)
select t.id || '_s' || s, t.id, s, 'onedream_creator_' || substr(t.id, 5) || '_s' || s
  from digital_sub_tiers t cross join generate_series(4, 6) as s
on conflict (id) do nothing;

select tier_id, count(*) filter (where is_active) as active_slots, (count(*) filter (where is_active)) = 6 as ok
  from digital_sub_products group by tier_id order by tier_id;
