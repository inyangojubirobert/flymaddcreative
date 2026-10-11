-- Optional remote images for catalogue departments AND their categories.
-- Departments and categories share catalogue_categories, so every row gets these columns.
--   Department row (parent_id is null): image_url is the banner on the department screen.
--   Category row (parent_id set): image_url is the tile image in its department and the
--   banner on the category's own screen. banner_title / banner_subtitle override the name.
-- Safe to run repeatedly. Leaves every URL empty until one is stored; empty rows keep the icon.

alter table public.catalogue_categories
  add column if not exists image_url text,
  add column if not exists banner_title text,
  add column if not exists banner_subtitle text;

-- Example:
-- update public.catalogue_categories
--   set image_url = 'https://res.cloudinary.com/.../shoes.jpg',
--       banner_subtitle = 'Sneakers, heels and everyday pairs'
--   where slug = 'shoes';
