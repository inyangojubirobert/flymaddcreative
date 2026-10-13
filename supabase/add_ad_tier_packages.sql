-- ============================================================================
-- Advertising: Bronze / Silver / Gold / Platinum ad packages ($100-$999.99),
-- and the Play Console product IDs actually created for Starter and Growth
-- (onedream_ad_starters, onedream_ads_growth - Play IDs can't be renamed).
--
-- Safe to re-run. Requires add_advertising.sql. Packages stay editable in
-- Admin portal -> Ads -> Packages; edits only affect future purchases.
-- ============================================================================

insert into advertising_packages
  (id, kind, name, tagline, price_usd, duration_hours, max_creatives, placements, priority, allow_external_link, benefits, highlight, sort_order, google_play_product_id)
values
  ('bronze_ads', 'ad', 'Bronze Ads', 'More reach for a full month', 100, 720, 6, '{home,shop,search,category}', 50, true,
   '["30 days across all eligible placements", "6 creatives (image or video)", "1.25x the exposure of Business Ads", "External link + analytics"]', null, 50, 'onedream_ad_bronze'),
  ('silver_ads', 'ad', 'Silver Ads', 'Be seen more often, all month', 200, 720, 7, '{home,shop,search,category}', 65, true,
   '["30 days across all eligible placements", "7 creatives (image or video)", "1.6x the exposure of Business Ads", "External link + analytics"]', null, 60, 'onedream_ad_silver'),
  ('gold_ads', 'ad', 'Gold Ads', 'Premium exposure, all month', 500, 720, 8, '{home,shop,search,category}', 80, true,
   '["30 days across all eligible placements", "8 creatives (image or video)", "2x the exposure of Business Ads", "External link + analytics"]', null, 70, 'onedream_ad_gold'),
  ('platinum_ads', 'ad', 'Platinum Ads', 'Maximum exposure, all month', 999.99, 720, 10, '{home,shop,search,category}', 100, true,
   '["30 days across all eligible placements", "10 creatives (image or video)", "Highest exposure: 2.5x Business Ads", "External link + analytics"]', 'Top tier', 80, 'onedream_ad_platinum')
on conflict (id) do nothing;

-- Business Ads is no longer the top tier.
update advertising_packages
set benefits = '["30 days across all eligible placements", "5 creatives (image or video)", "High delivery priority", "External link + analytics"]',
    updated_at = now()
where id = 'business_ads' and benefits ? 'Highest eligible priority';

-- Match the IDs created in Play Console.
update advertising_packages set google_play_product_id = 'onedream_ad_starters', updated_at = now()
where id = 'starter_ads' and google_play_product_id = 'onedream_ad_starter';
update advertising_packages set google_play_product_id = 'onedream_ads_growth', updated_at = now()
where id = 'growth_ads' and google_play_product_id = 'onedream_ad_growth';

-- Verify
select id, name, price_usd, duration_hours / 24 as days, max_creatives, priority, google_play_product_id, is_active
from advertising_packages
where kind = 'ad'
order by sort_order;
