-- ============================================================================
-- Listing boosts: 9 tiers ($3-$4,000), adding Pro, Prime, Star, Elite, Premier
-- and Ultimate to Quick / Seller / Power. Every tier from Power up lasts 30
-- days; higher tiers buy priority.
--
-- Google Play won't accept a one-time product above $400, so Premier and
-- Ultimate have no Play product: they're bought by card (Paystack) on the
-- website and web app only, and show "Not available right now" in the
-- Android app.
--
-- Safe to re-run. Requires add_advertising.sql. Packages stay editable in
-- Admin portal -> Ads -> Packages; edits only affect future purchases.
-- ============================================================================

insert into advertising_packages
  (id, kind, name, tagline, price_usd, duration_hours, max_creatives, placements, priority, allow_external_link, benefits, highlight, sort_order, google_play_product_id)
values
  ('pro_boost', 'boost', 'Pro Boost', 'A month near the top', 100, 720, 0, '{shop,search,category}', 40, false,
   '["30 days of extra visibility", "Shop, search and category", "High boost priority"]', null, 140, 'onedream_boost_pro'),
  ('prime_boost', 'boost', 'Prime Boost', 'A month of stronger placement', 200, 720, 0, '{shop,search,category}', 50, false,
   '["30 days of extra visibility", "Shop, search and category", "Very high boost priority"]', null, 144, 'onedream_boost_prime'),
  ('star_boost', 'boost', 'Star Boost', 'A month of standout placement', 300, 720, 0, '{shop,search,category}', 60, false,
   '["30 days of extra visibility", "Shop, search and category", "Premium boost priority"]', null, 147, 'onedream_boost_star'),
  ('elite_boost', 'boost', 'Elite Boost', 'A month of premium placement', 400, 720, 0, '{shop,search,category}', 70, false,
   '["30 days of extra visibility", "Shop, search and category", "Elite boost priority"]', null, 150, 'onedream_boost_elite'),
  ('premier_boost', 'boost', 'Premier Boost', 'A month of top-level placement', 1500, 720, 0, '{shop,search,category}', 85, false,
   '["30 days of extra visibility", "Shop, search and category", "Top-level boost priority"]', null, 160, null),
  ('ultimate_boost', 'boost', 'Ultimate Boost', 'A month at maximum priority', 4000, 720, 0, '{shop,search,category}', 100, false,
   '["30 days of extra visibility", "Shop, search and category", "Maximum boost priority"]', 'Top tier', 170, null)
on conflict (id) do nothing;

-- Boosts last at most 30 days; the higher tiers buy priority, not time.
update advertising_packages set duration_hours = 720, updated_at = now()
where kind = 'boost' and duration_hours > 720;

-- Power Boost is no longer the top tier.
update advertising_packages set tagline = 'A month of high visibility', updated_at = now()
where id = 'power_boost' and tagline = 'A month of maximum visibility';

-- Verify
select id, name, price_usd, duration_hours / 24 as days, priority, google_play_product_id, is_active
from advertising_packages
where kind = 'boost'
order by sort_order;
