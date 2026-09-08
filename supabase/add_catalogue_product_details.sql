-- Optional product details used by the native seller shop.
-- Safe to run more than once on an existing FlyMadd database.
ALTER TABLE public.catalogue_items
  ADD COLUMN IF NOT EXISTS size TEXT,
  ADD COLUMN IF NOT EXISTS promo_video_url TEXT;

COMMENT ON COLUMN public.catalogue_items.size IS
  'Seller-entered product size, dimensions, or available-size summary.';

COMMENT ON COLUMN public.catalogue_items.promo_video_url IS
  'Public URL for an optional promotional product video.';
