-- ============================================================
-- ONE DREAM CATALOGUE — 100 CATEGORIES UNDER DEPARTMENTS
-- Safe to run repeatedly.
-- "More" is a home-screen action, not a category. Uncategorised
-- products use Other.
-- ============================================================

create table if not exists public.catalogue_categories (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null,
  icon text not null default 'pricetag',
  tint text not null default '#DBEAFE',
  ink text not null default '#1E3A8A',
  sort_order integer not null default 100,
  created_at timestamptz not null default now(),

  constraint catalogue_categories_name_len
    check (char_length(trim(name)) between 1 and 60),

  -- Names are unique per department (index below), not marketplace-wide.
  -- Databases created before this change get that from
  -- catalogue_department_scoped_names.sql.
  constraint catalogue_categories_slug_unique unique (slug)
);

alter table public.catalogue_categories
  add column if not exists parent_id uuid references public.catalogue_categories(id),
  add column if not exists is_featured boolean not null default false,
  add column if not exists is_active boolean not null default true,
  add column if not exists is_selectable boolean not null default true,
  add column if not exists image_url text,
  add column if not exists banner_title text,
  add column if not exists banner_subtitle text;

create index if not exists catalogue_categories_parent_id_idx
  on public.catalogue_categories(parent_id);

create unique index if not exists catalogue_categories_department_name_unique
  on public.catalogue_categories (
    coalesce(parent_id, '00000000-0000-0000-0000-000000000000'::uuid),
    lower(trim(name))
  );

alter table public.catalogue_items
  add column if not exists category_id uuid
  references public.catalogue_categories(id);

create index if not exists catalogue_items_category_id_idx
  on public.catalogue_items(category_id);


-- ============================================================
-- 100 CATEGORIES
-- ============================================================

insert into public.catalogue_categories
(name, slug, icon, tint, ink, sort_order)
values

-- GENERAL
('Fashion', 'fashion', 'shirt', '#FFE4E6', '#BE123C', 1),
('Digital', 'digital', 'laptop', '#DBEAFE', '#1D4ED8', 2),
('Services', 'services', 'people', '#DCFCE7', '#15803D', 3),
('Other', 'other', 'ellipsis-horizontal', '#EDE9FE', '#6D28D9', 4),

-- BEAUTY & FASHION
('Beauty & Skincare', 'beauty-skincare', 'sparkles', '#FCE7F3', '#BE185D', 5),
('Hair & Haircare', 'hair-haircare', 'cut', '#FCE7F3', '#9D174D', 6),
('Fragrances', 'fragrances', 'flower', '#FAE8FF', '#A21CAF', 7),
('Jewelry', 'jewelry', 'diamond', '#FEF3C7', '#B45309', 8),
('Watches', 'watches', 'watch', '#E0E7FF', '#4338CA', 9),
('Bags & Luggage', 'bags-luggage', 'bag-handle', '#F3E8FF', '#7E22CE', 10),
('Shoes', 'shoes', 'footsteps', '#FFEDD5', '#C2410C', 11),
('Men''s Clothing', 'mens-clothing', 'male', '#DBEAFE', '#1E40AF', 12),
('Women''s Clothing', 'womens-clothing', 'female', '#FCE7F3', '#BE185D', 13),
('Kids'' Clothing', 'kids-clothing', 'happy', '#FEF3C7', '#A16207', 14),
('Sportswear', 'sportswear', 'fitness', '#DCFCE7', '#15803D', 15),
('Traditional & Cultural Wear', 'traditional-cultural-wear', 'color-palette', '#FFEDD5', '#C2410C', 16),
('Fashion Accessories', 'fashion-accessories', 'glasses', '#EDE9FE', '#6D28D9', 17),

-- TECHNOLOGY
('Phones & Tablets', 'phones-tablets', 'phone-portrait', '#DBEAFE', '#1D4ED8', 18),
('Computers & Laptops', 'computers-laptops', 'laptop', '#E0F2FE', '#0369A1', 19),
('Computer Accessories', 'computer-accessories', 'hardware-chip', '#E0E7FF', '#4338CA', 20),
('Electronics', 'electronics', 'flash', '#FEF3C7', '#B45309', 21),
('Audio & Headphones', 'audio-headphones', 'headset', '#F3E8FF', '#7E22CE', 22),
('Cameras & Photography', 'cameras-photography', 'camera', '#E0F2FE', '#0369A1', 23),
('Gaming', 'gaming', 'game-controller', '#EDE9FE', '#6D28D9', 24),
('Smart Devices', 'smart-devices', 'wifi', '#DBEAFE', '#1D4ED8', 25),
('TV & Home Entertainment', 'tv-home-entertainment', 'tv', '#E0E7FF', '#4338CA', 26),
('Appliances', 'appliances', 'cube', '#F1F5F9', '#334155', 27),
('Solar & Power', 'solar-power', 'sunny', '#FEF3C7', '#B45309', 28),

-- HOME
('Home & Kitchen', 'home-kitchen', 'home', '#DCFCE7', '#15803D', 29),
('Furniture', 'furniture', 'bed', '#FFEDD5', '#C2410C', 30),
('Home Decor', 'home-decor', 'images', '#FCE7F3', '#BE185D', 31),
('Bedding & Bath', 'bedding-bath', 'bed', '#E0F2FE', '#0369A1', 32),
('Cleaning Supplies', 'cleaning-supplies', 'sparkles', '#DCFCE7', '#15803D', 33),
('Garden & Outdoor', 'garden-outdoor', 'leaf', '#DCFCE7', '#166534', 34),
('Tools & Hardware', 'tools-hardware', 'hammer', '#F1F5F9', '#475569', 35),
('Building Materials', 'building-materials', 'construct', '#FFEDD5', '#9A3412', 36),

-- FOOD
('Food & Groceries', 'food-groceries', 'basket', '#FEF3C7', '#B45309', 37),
('Drinks & Beverages', 'drinks-beverages', 'cafe', '#DBEAFE', '#1D4ED8', 38),
('Snacks & Confectionery', 'snacks-confectionery', 'fast-food', '#FCE7F3', '#BE185D', 39),
('Baked Goods', 'baked-goods', 'restaurant', '#FFEDD5', '#C2410C', 40),
('Catering', 'catering', 'restaurant', '#FEF3C7', '#A16207', 41),
('Farm Produce', 'farm-produce', 'leaf', '#DCFCE7', '#15803D', 42),
('Meat & Seafood', 'meat-seafood', 'fish', '#FEE2E2', '#B91C1C', 43),

-- HEALTH & FITNESS
('Health & Wellness', 'health-wellness', 'heart', '#DCFCE7', '#15803D', 44),
('Fitness & Gym', 'fitness-gym', 'barbell', '#DBEAFE', '#1D4ED8', 45),
('Sports Equipment', 'sports-equipment', 'football', '#DCFCE7', '#166534', 46),
('Medical Supplies', 'medical-supplies', 'medkit', '#FEE2E2', '#B91C1C', 47),

-- FAMILY
('Baby Products', 'baby-products', 'happy', '#FEF3C7', '#A16207', 48),
('Toys & Games', 'toys-games', 'game-controller', '#FCE7F3', '#BE185D', 49),

-- BOOKS, ARTS & MEDIA
('Books', 'books', 'book', '#E0E7FF', '#4338CA', 50),
('Stationery', 'stationery', 'pencil', '#DBEAFE', '#1D4ED8', 51),
('Art & Crafts', 'art-crafts', 'color-palette', '#FFEDD5', '#C2410C', 52),
('Music', 'music', 'musical-notes', '#F3E8FF', '#7E22CE', 53),
('Movies & Entertainment', 'movies-entertainment', 'film', '#EDE9FE', '#6D28D9', 54),
('Event Tickets', 'event-tickets', 'ticket', '#FEF3C7', '#B45309', 55),

-- DIGITAL PRODUCTS
('E-books', 'ebooks', 'book-outline', '#DBEAFE', '#1D4ED8', 56),
('Online Courses', 'online-courses', 'school', '#DCFCE7', '#15803D', 57),
('Templates & Design Assets', 'templates-design-assets', 'color-palette', '#FCE7F3', '#BE185D', 58),
('Software & Apps', 'software-apps', 'code-slash', '#E0E7FF', '#4338CA', 59),
('Music & Audio Files', 'music-audio-files', 'musical-notes', '#F3E8FF', '#7E22CE', 60),
('Photography & Stock Media', 'photography-stock-media', 'images', '#E0F2FE', '#0369A1', 61),
('Domains & Websites', 'domains-websites', 'globe', '#DBEAFE', '#1D4ED8', 62),

-- PROFESSIONAL SERVICES
('Business Services', 'business-services', 'briefcase', '#DBEAFE', '#1E40AF', 63),
('Graphic Design', 'graphic-design', 'color-palette', '#FCE7F3', '#BE185D', 64),
('Web Development', 'web-development', 'globe', '#E0F2FE', '#0369A1', 65),
('App Development', 'app-development', 'phone-portrait', '#DBEAFE', '#1D4ED8', 66),
('AI & Automation Services', 'ai-automation-services', 'sparkles', '#EDE9FE', '#6D28D9', 67),
('Marketing & Advertising', 'marketing-advertising', 'megaphone', '#FEF3C7', '#B45309', 68),
('Social Media Services', 'social-media-services', 'share-social', '#FCE7F3', '#BE185D', 69),
('Photography Services', 'photography-services', 'camera', '#E0F2FE', '#0369A1', 70),
('Video Production', 'video-production', 'videocam', '#EDE9FE', '#6D28D9', 71),
('Music & Audio Services', 'music-audio-services', 'mic', '#F3E8FF', '#7E22CE', 72),
('Writing & Editing', 'writing-editing', 'create', '#DBEAFE', '#1D4ED8', 73),
('Consulting', 'consulting', 'chatbubbles', '#DCFCE7', '#15803D', 74),
('Legal Consultation & Advice', 'legal-services', 'scale', '#F1F5F9', '#334155', 75),
('Accounting & Finance Services', 'accounting-finance-services', 'calculator', '#DCFCE7', '#15803D', 76),
('Education & Tutoring', 'education-tutoring', 'school', '#FEF3C7', '#A16207', 77),

-- LOCAL & PERSONAL SERVICES
('Repair Services', 'repair-services', 'build', '#F1F5F9', '#475569', 78),
('Home Services', 'home-services', 'home', '#DCFCE7', '#15803D', 79),
('Cleaning Services', 'cleaning-services', 'sparkles', '#E0F2FE', '#0369A1', 80),
('Beauty Services', 'beauty-services', 'sparkles', '#FCE7F3', '#BE185D', 81),
('Hair & Barber Services', 'hair-barber-services', 'cut', '#EDE9FE', '#6D28D9', 82),
('Fashion Design & Tailoring', 'fashion-design-tailoring', 'shirt', '#FFE4E6', '#BE123C', 83),
('Printing & Branding', 'printing-branding', 'print', '#DBEAFE', '#1D4ED8', 84),

-- LOGISTICS & TRAVEL
('Logistics & Delivery', 'logistics-delivery', 'cube', '#FEF3C7', '#B45309', 85),
('Travel & Tourism', 'travel-tourism', 'airplane', '#E0F2FE', '#0369A1', 86),
('Hotels', 'hotels-accommodation', 'bed', '#F3E8FF', '#7E22CE', 87),
('Car Hire & Transport', 'car-hire-transport', 'car', '#DBEAFE', '#1D4ED8', 88),

-- AUTOMOTIVE
('Cars & Vehicles', 'cars-vehicles', 'car-sport', '#F1F5F9', '#334155', 89),
('Auto Parts & Accessories', 'auto-parts-accessories', 'cog', '#F1F5F9', '#475569', 90),
('Motorcycles & Bicycles', 'motorcycles-bicycles', 'bicycle', '#DCFCE7', '#15803D', 91),

-- PROPERTY
('Property for Sale', 'property-for-sale', 'business', '#DBEAFE', '#1D4ED8', 92),
('Property for Rent', 'property-for-rent', 'key', '#FEF3C7', '#B45309', 93),

-- BUSINESS & INDUSTRY
('Office & Business Supplies', 'office-business-supplies', 'briefcase', '#E0E7FF', '#4338CA', 94),
('Industrial Equipment', 'industrial-equipment', 'construct', '#F1F5F9', '#334155', 95),
('Agricultural Equipment', 'agricultural-equipment', 'leaf', '#DCFCE7', '#166534', 96),

-- OTHER MARKETPLACE AREAS
('Pet Supplies', 'pet-supplies', 'paw', '#FEF3C7', '#A16207', 97),
('Gifts & Souvenirs', 'gifts-souvenirs', 'gift', '#FCE7F3', '#BE185D', 98),
('Religious & Inspirational', 'religious-inspirational', 'heart', '#EDE9FE', '#6D28D9', 99),
('Collectibles & Antiques', 'collectibles-antiques', 'trophy', '#FFEDD5', '#9A3412', 100)

on conflict (slug)
do update set
  name = excluded.name,
  icon = excluded.icon,
  tint = excluded.tint,
  ink = excluded.ink,
  sort_order = excluded.sort_order;


-- ============================================================
-- EXISTING PRODUCTS WITHOUT A CATEGORY
-- ============================================================

update public.catalogue_categories
set name = 'Other', slug = 'other'
where slug = 'more'
  and not exists (
    select 1 from public.catalogue_categories where slug = 'other'
  );

-- If both rows exist, move products off More and delete it.
do $$
declare
  old_more_id uuid;
  other_id uuid;
begin
  select id
  into old_more_id
  from public.catalogue_categories
  where slug = 'more';

  select id
  into other_id
  from public.catalogue_categories
  where slug = 'other';

  if old_more_id is not null and other_id is not null then

    update public.catalogue_items
    set category_id = other_id
    where category_id = old_more_id;

    delete from public.catalogue_categories
    where id = old_more_id;

  end if;
end $$;

update public.catalogue_items
set category_id = (
  select id
  from public.catalogue_categories
  where slug = 'other'
)
where category_id is null;

alter table public.catalogue_items
  alter column category_id set not null;


-- ============================================================
-- DEPARTMENTS
-- Parents are for browsing. Products stay on the 100 categories.
-- ============================================================

insert into public.catalogue_categories
(name, slug, icon, tint, ink, sort_order, is_featured)
values
('Fashion & Beauty', 'fashion-beauty', 'shirt', '#FFE4E6', '#BE123C', 1, true),
('Technology', 'technology', 'phone-portrait', '#DBEAFE', '#1D4ED8', 2, false),
('Home & Living', 'home-living', 'home', '#DCFCE7', '#15803D', 3, false),
('Food & Grocery', 'food-grocery', 'basket', '#FEF3C7', '#B45309', 4, false),
('Health & Fitness', 'health-fitness', 'heart', '#DCFCE7', '#166534', 5, false),
('Kids & Family', 'kids-family', 'happy', '#FEF3C7', '#A16207', 6, false),
('Books, Art & Entertainment', 'books-art-entertainment', 'book', '#E0E7FF', '#4338CA', 7, false),
('Digital Products', 'digital-products', 'laptop', '#DBEAFE', '#1D4ED8', 8, true),
('Professional Services', 'professional-services', 'briefcase', '#DBEAFE', '#1E40AF', 9, true),
('Local Services', 'local-services', 'construct', '#F1F5F9', '#475569', 10, false),
('Travel & Transport', 'travel-transport', 'airplane', '#E0F2FE', '#0369A1', 11, false),
('Automotive', 'automotive', 'car', '#F1F5F9', '#334155', 12, false),
('Property', 'property', 'business', '#DBEAFE', '#1D4ED8', 13, false),
('Business & Industry', 'business-industry', 'cube', '#E0E7FF', '#4338CA', 14, false),
('Gifts & Specialty', 'gifts-specialty', 'gift', '#FCE7F3', '#BE185D', 15, false)
on conflict (slug)
do update set
  name = excluded.name,
  icon = excluded.icon,
  tint = excluded.tint,
  ink = excluded.ink,
  sort_order = excluded.sort_order,
  parent_id = null;

update public.catalogue_categories as category
set parent_id = department.id
from (
  values
    ('fashion', 'fashion-beauty'),
    ('beauty-skincare', 'fashion-beauty'),
    ('hair-haircare', 'fashion-beauty'),
    ('fragrances', 'fashion-beauty'),
    ('jewelry', 'fashion-beauty'),
    ('watches', 'fashion-beauty'),
    ('bags-luggage', 'fashion-beauty'),
    ('shoes', 'fashion-beauty'),
    ('mens-clothing', 'fashion-beauty'),
    ('womens-clothing', 'fashion-beauty'),
    ('sportswear', 'fashion-beauty'),
    ('traditional-cultural-wear', 'fashion-beauty'),
    ('fashion-accessories', 'fashion-beauty'),
    ('phones-tablets', 'technology'),
    ('computers-laptops', 'technology'),
    ('computer-accessories', 'technology'),
    ('electronics', 'technology'),
    ('audio-headphones', 'technology'),
    ('cameras-photography', 'technology'),
    ('gaming', 'technology'),
    ('smart-devices', 'technology'),
    ('tv-home-entertainment', 'technology'),
    ('appliances', 'technology'),
    ('solar-power', 'technology'),
    ('home-kitchen', 'home-living'),
    ('furniture', 'home-living'),
    ('home-decor', 'home-living'),
    ('bedding-bath', 'home-living'),
    ('cleaning-supplies', 'home-living'),
    ('garden-outdoor', 'home-living'),
    ('tools-hardware', 'home-living'),
    ('building-materials', 'home-living'),
    ('food-groceries', 'food-grocery'),
    ('drinks-beverages', 'food-grocery'),
    ('snacks-confectionery', 'food-grocery'),
    ('baked-goods', 'food-grocery'),
    ('catering', 'food-grocery'),
    ('farm-produce', 'food-grocery'),
    ('meat-seafood', 'food-grocery'),
    ('health-wellness', 'health-fitness'),
    ('fitness-gym', 'health-fitness'),
    ('sports-equipment', 'health-fitness'),
    ('medical-supplies', 'health-fitness'),
    ('kids-clothing', 'kids-family'),
    ('baby-products', 'kids-family'),
    ('toys-games', 'kids-family'),
    ('books', 'books-art-entertainment'),
    ('stationery', 'books-art-entertainment'),
    ('art-crafts', 'books-art-entertainment'),
    ('music', 'books-art-entertainment'),
    ('movies-entertainment', 'books-art-entertainment'),
    ('event-tickets', 'books-art-entertainment'),
    ('digital', 'digital-products'),
    ('ebooks', 'digital-products'),
    ('online-courses', 'digital-products'),
    ('templates-design-assets', 'digital-products'),
    ('software-apps', 'digital-products'),
    ('music-audio-files', 'digital-products'),
    ('photography-stock-media', 'digital-products'),
    ('domains-websites', 'digital-products'),
    ('services', 'professional-services'),
    ('business-services', 'professional-services'),
    ('graphic-design', 'professional-services'),
    ('web-development', 'professional-services'),
    ('app-development', 'professional-services'),
    ('ai-automation-services', 'professional-services'),
    ('marketing-advertising', 'professional-services'),
    ('social-media-services', 'professional-services'),
    ('photography-services', 'professional-services'),
    ('video-production', 'professional-services'),
    ('music-audio-services', 'professional-services'),
    ('writing-editing', 'professional-services'),
    ('consulting', 'professional-services'),
    ('legal-services', 'professional-services'),
    ('accounting-finance-services', 'professional-services'),
    ('education-tutoring', 'professional-services'),
    ('repair-services', 'local-services'),
    ('home-services', 'local-services'),
    ('cleaning-services', 'local-services'),
    ('beauty-services', 'local-services'),
    ('hair-barber-services', 'local-services'),
    ('fashion-design-tailoring', 'local-services'),
    ('printing-branding', 'local-services'),
    ('logistics-delivery', 'travel-transport'),
    ('travel-tourism', 'travel-transport'),
    ('hotels-accommodation', 'travel-transport'),
    ('car-hire-transport', 'travel-transport'),
    ('cars-vehicles', 'automotive'),
    ('auto-parts-accessories', 'automotive'),
    ('motorcycles-bicycles', 'automotive'),
    ('property-for-sale', 'property'),
    ('property-for-rent', 'property'),
    ('office-business-supplies', 'business-industry'),
    ('industrial-equipment', 'business-industry'),
    ('agricultural-equipment', 'business-industry'),
    ('pet-supplies', 'gifts-specialty'),
    ('gifts-souvenirs', 'gifts-specialty'),
    ('religious-inspirational', 'gifts-specialty'),
    ('collectibles-antiques', 'gifts-specialty'),
    ('other', 'gifts-specialty')
) as membership(category_slug, department_slug)
join public.catalogue_categories as department
  on department.slug = membership.department_slug
where category.slug = membership.category_slug;

update public.catalogue_categories
set is_featured = slug in (
  'fashion-beauty',
  'digital-products',
  'professional-services',
  'electronics'
);

-- Departments cannot be attached to products.
update public.catalogue_categories
set is_selectable = false
where parent_id is null;

-- Broad buckets stay for older products and home aliases.
-- Other only holds older uncategorised products; it is not shown as a category.
-- Sellers must pick a specific category or type a new one.
update public.catalogue_categories
set is_selectable = false
where slug in (
  'fashion',
  'digital',
  'services',
  'other'
);

update public.catalogue_categories
set is_selectable = true
where parent_id is not null
  and slug not in ('fashion', 'digital', 'services', 'other');


-- ============================================================
-- SECURITY
-- ============================================================

alter table public.catalogue_categories enable row level security;

drop policy if exists catalogue_categories_select_all
on public.catalogue_categories;

create policy catalogue_categories_select_all
  on public.catalogue_categories
  for select
  using (true);

grant select
on public.catalogue_categories
to anon, authenticated;
