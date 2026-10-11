-- ============================================================
-- ONE DREAM CATALOGUE — UNIVERSAL SEARCH ALIAS SYSTEM
-- Additive migration. Safe to run repeatedly (idempotent).
--
-- SCOPE
--   Adds a new, standalone table (catalogue_search_aliases) that lets
--   shoppers find departments and categories using synonyms, singular/
--   plural forms, abbreviations and common Nigerian/English terminology,
--   without touching any existing table, row, id, slug or relationship.
--
--   Does NOT create, rename, delete, merge or reorder any department or
--   category. Does NOT touch catalogue_items, catalogue_orders, payments,
--   wallets, subscriptions, commissions or any financial/settlement logic.
--
-- PHASE 1 FINDING (inspection of the live schema, read-only)
--   There is no separate "departments" table. public.catalogue_categories
--   is self-referential: rows with parent_id is null ARE the 17 departments,
--   rows with parent_id set are the 187 categories beneath them (204 rows
--   total, confirmed via a live, read-only REST query on 2026-10-10).
--   Because both "department" and "category" are the same underlying
--   table, the alias table below uses a single plain foreign key to
--   catalogue_categories(id) instead of the suggested polymorphic
--   entity_type/entity_id pair — this is simpler, gives real referential
--   integrity (FK + ON DELETE CASCADE) and needs no CHECK-based emulation
--   of polymorphism. "Department alias" vs "category alias" is simply
--   whichever kind of row category_id points to (check parent_id).
--
-- WHAT THIS FILE DOES
--   1. Creates public.catalogue_search_aliases (id, category_id, alias,
--      normalized_alias, created_at, updated_at) with:
--        - FK to catalogue_categories(id) on delete cascade
--        - unique (category_id, normalized_alias) to block duplicates
--        - btree index on normalized_alias for fast exact/prefix lookup
--        - trigram (pg_trgm) index for partial and typo-tolerant search
--   2. Enables RLS: public (anon, authenticated) may SELECT only.
--      No insert/update/delete grants are given to anon/authenticated —
--      alias creation/editing stays restricted to the service_role used
--      by server-side admin APIs, matching the existing
--      catalogue_categories_select_all convention.
--   3. Seeds aliases for every one of the 204 existing department and
--      category rows (looked up by slug, so the insert is a no-op for
--      any slug that does not exist in a given environment — it will
--      never fail or invent a category).
--   4. Adds public.search_catalogue_categories(search_term, result_limit):
--      a read-only SQL function implementing the matching/ranking rules
--      from the spec (exact name > exact alias > partial name/alias >
--      per-word alias/name match for multiword queries > bounded fuzzy
--      fallback), returning both the matched category and its
--      parent department so the frontend can route using the existing
--      category id/slug — no new "virtual" categories are ever returned.
--
-- DEPLOYMENT
--   Review in a staging project first. This script only adds objects,
--   so rollback is: drop function public.search_catalogue_categories;
--   drop table public.catalogue_search_aliases;
-- ============================================================

begin;

create extension if not exists pg_trgm;

-- ------------------------------------------------------------
-- 1. TABLE
-- ------------------------------------------------------------
create table if not exists public.catalogue_search_aliases (
  id uuid primary key default gen_random_uuid(),
  category_id uuid not null references public.catalogue_categories(id) on delete cascade,
  alias text not null,
  normalized_alias text generated always as (lower(trim(alias))) stored,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint catalogue_search_aliases_alias_len check (char_length(trim(alias)) between 1 and 80)
);

create unique index if not exists catalogue_search_aliases_unique
  on public.catalogue_search_aliases (category_id, normalized_alias);

create index if not exists catalogue_search_aliases_normalized_idx
  on public.catalogue_search_aliases (normalized_alias);

create index if not exists catalogue_search_aliases_trgm_idx
  on public.catalogue_search_aliases using gin (normalized_alias gin_trgm_ops);

-- Also helps partial/typo matching directly against the official names.
create index if not exists catalogue_categories_name_trgm_idx
  on public.catalogue_categories using gin (lower(name) gin_trgm_ops);

create or replace function public.catalogue_search_aliases_set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists catalogue_search_aliases_touch_updated_at
  on public.catalogue_search_aliases;

create trigger catalogue_search_aliases_touch_updated_at
  before update on public.catalogue_search_aliases
  for each row execute function public.catalogue_search_aliases_set_updated_at();

-- ------------------------------------------------------------
-- 2. SECURITY — public read-only, writes stay admin/service_role only
-- ------------------------------------------------------------
alter table public.catalogue_search_aliases enable row level security;

drop policy if exists catalogue_search_aliases_select_all
  on public.catalogue_search_aliases;

create policy catalogue_search_aliases_select_all
  on public.catalogue_search_aliases
  for select
  using (true);

-- Explicit, defense-in-depth read-only enforcement: strip whatever default
-- privileges may exist (e.g. a future "grant all to authenticated" run
-- elsewhere), then grant back only SELECT for public roles. With RLS
-- enabled and only a SELECT policy defined, insert/update/delete are
-- denied for anon/authenticated even if a stray grant existed.
revoke all on public.catalogue_search_aliases from public, anon, authenticated;

grant select
on public.catalogue_search_aliases
to anon, authenticated;

-- service_role (used only by trusted server-side admin APIs, never exposed
-- to clients) bypasses RLS already, but table-level privileges are a
-- separate layer in Postgres — grant them explicitly rather than relying
-- on a project-level default-privilege assumption.
grant select, insert, update, delete
on public.catalogue_search_aliases
to service_role;

-- No insert/update/delete grants to anon/authenticated on purpose:
-- alias creation stays restricted to the service_role used by admin APIs.

-- ------------------------------------------------------------
-- 3. DATA — aliases for every existing department and category
--    (looked up by slug; rows for slugs that do not exist are
--    silently skipped, never invented)
-- ------------------------------------------------------------
insert into public.catalogue_search_aliases (category_id, alias)
select c.id, v.alias
from public.catalogue_categories c
join (values
  ('fashion-beauty', 'Fashion'),
  ('fashion-beauty', 'Clothing'),
  ('fashion-beauty', 'Clothes'),
  ('fashion-beauty', 'Apparel'),
  ('fashion-beauty', 'Wear'),
  ('fashion-beauty', 'Outfits'),
  ('fashion-beauty', 'Dresses'),
  ('fashion-beauty', 'Shirts'),
  ('fashion-beauty', 'Trousers'),
  ('fashion-beauty', 'Jeans'),
  ('fashion-beauty', 'Shoes'),
  ('fashion-beauty', 'Footwear'),
  ('fashion-beauty', 'Sneakers'),
  ('fashion-beauty', 'Sandals'),
  ('fashion-beauty', 'Bags'),
  ('fashion-beauty', 'Handbags'),
  ('fashion-beauty', 'Accessories'),
  ('fashion-beauty', 'Jewelry'),
  ('fashion-beauty', 'Jewellery'),
  ('fashion-beauty', 'Watches'),
  ('fashion-beauty', 'Cosmetics'),
  ('fashion-beauty', 'Makeup'),
  ('fashion-beauty', 'Skincare'),
  ('fashion-beauty', 'Beauty Products'),
  ('fashion-beauty', 'Perfume'),
  ('fashion-beauty', 'Fragrance'),
  ('fashion-beauty', 'Hair Products'),
  ('fashion-beauty', 'Wigs'),
  ('fashion-beauty', 'Personal Style'),
  ('technology', 'Tech'),
  ('technology', 'Electronics'),
  ('technology', 'Gadgets'),
  ('technology', 'Devices'),
  ('technology', 'Computers'),
  ('technology', 'Laptops'),
  ('technology', 'Smartphones'),
  ('technology', 'Mobile Phones'),
  ('technology', 'Phones'),
  ('technology', 'Tablets'),
  ('technology', 'Computer Equipment'),
  ('technology', 'Electronic Devices'),
  ('technology', 'Smart Devices'),
  ('technology', 'Networking'),
  ('technology', 'Computer Hardware'),
  ('technology', 'IT Equipment'),
  ('home-living', 'Home'),
  ('home-living', 'Household'),
  ('home-living', 'Furniture'),
  ('home-living', 'Interior Decoration'),
  ('home-living', 'Home Decor'),
  ('home-living', 'Kitchen'),
  ('home-living', 'Kitchenware'),
  ('home-living', 'Appliances'),
  ('home-living', 'Bedding'),
  ('home-living', 'Mattresses'),
  ('home-living', 'Home Accessories'),
  ('home-living', 'Household Items'),
  ('home-living', 'Living Room'),
  ('home-living', 'Bedroom'),
  ('home-living', 'Home Improvement'),
  ('home-living', 'Home Essentials'),
  ('food-grocery', 'Food'),
  ('food-grocery', 'Groceries'),
  ('food-grocery', 'Grocery'),
  ('food-grocery', 'Provisions'),
  ('food-grocery', 'Foodstuff'),
  ('food-grocery', 'Food Items'),
  ('food-grocery', 'Beverages'),
  ('food-grocery', 'Drinks'),
  ('food-grocery', 'Snacks'),
  ('food-grocery', 'Fruits'),
  ('food-grocery', 'Vegetables'),
  ('food-grocery', 'Meat'),
  ('food-grocery', 'Fish'),
  ('food-grocery', 'Farm Produce'),
  ('food-grocery', 'Ingredients'),
  ('food-grocery', 'Cooking Supplies'),
  ('food-grocery', 'Fresh Food'),
  ('food-grocery', 'Supermarket'),
  ('food-grocery', 'Market Food'),
  ('health-fitness', 'Health'),
  ('health-fitness', 'Wellness'),
  ('health-fitness', 'Fitness'),
  ('health-fitness', 'Exercise'),
  ('health-fitness', 'Gym'),
  ('health-fitness', 'Workout'),
  ('health-fitness', 'Sports Equipment'),
  ('health-fitness', 'Medical Supplies'),
  ('health-fitness', 'Healthcare Products'),
  ('health-fitness', 'Personal Care'),
  ('health-fitness', 'Health Equipment'),
  ('health-fitness', 'Fitness Accessories'),
  ('health-fitness', 'Rehabilitation Equipment'),
  ('health-fitness', 'Wellness Products'),
  ('kids-family', 'Children'),
  ('kids-family', 'Kids'),
  ('kids-family', 'Babies'),
  ('kids-family', 'Baby Products'),
  ('kids-family', 'Toys'),
  ('kids-family', 'Children''s Clothing'),
  ('kids-family', 'Baby Clothes'),
  ('kids-family', 'Parenting'),
  ('kids-family', 'Maternity'),
  ('kids-family', 'Nursery'),
  ('kids-family', 'School Supplies'),
  ('kids-family', 'Family Essentials'),
  ('kids-family', 'Baby Accessories'),
  ('kids-family', 'Infant Products'),
  ('kids-family', 'Toddler Products'),
  ('books-art-entertainment', 'Books'),
  ('books-art-entertainment', 'Literature'),
  ('books-art-entertainment', 'Reading'),
  ('books-art-entertainment', 'Novels'),
  ('books-art-entertainment', 'Educational Books'),
  ('books-art-entertainment', 'Art'),
  ('books-art-entertainment', 'Artwork'),
  ('books-art-entertainment', 'Paintings'),
  ('books-art-entertainment', 'Drawings'),
  ('books-art-entertainment', 'Music'),
  ('books-art-entertainment', 'Entertainment'),
  ('books-art-entertainment', 'Movies'),
  ('books-art-entertainment', 'Films'),
  ('books-art-entertainment', 'Instruments'),
  ('books-art-entertainment', 'Musical Equipment'),
  ('books-art-entertainment', 'Creative Materials'),
  ('books-art-entertainment', 'Collectibles'),
  ('books-art-entertainment', 'Crafts'),
  ('digital-products', 'Digital'),
  ('digital-products', 'Downloads'),
  ('digital-products', 'Software'),
  ('digital-products', 'Apps'),
  ('digital-products', 'Applications'),
  ('digital-products', 'Templates'),
  ('digital-products', 'Ebooks'),
  ('digital-products', 'Digital Files'),
  ('digital-products', 'Online Products'),
  ('digital-products', 'Digital Assets'),
  ('digital-products', 'Graphics'),
  ('digital-products', 'Website Templates'),
  ('digital-products', 'Digital Designs'),
  ('digital-products', 'Plugins'),
  ('digital-products', 'Themes'),
  ('digital-products', 'Presets'),
  ('digital-products', 'Digital Resources'),
  ('professional-services', 'Professional'),
  ('professional-services', 'Consulting'),
  ('professional-services', 'Consultancy'),
  ('professional-services', 'Legal Services'),
  ('professional-services', 'Accounting'),
  ('professional-services', 'Business Consulting'),
  ('professional-services', 'Engineering Services'),
  ('professional-services', 'Architecture'),
  ('professional-services', 'Design Services'),
  ('professional-services', 'Financial Services'),
  ('professional-services', 'Marketing Services'),
  ('professional-services', 'Technical Consulting'),
  ('professional-services', 'Professional Assistance'),
  ('professional-services', 'Expert Services'),
  ('local-services', 'Services Near Me'),
  ('local-services', 'Repairs'),
  ('local-services', 'Maintenance'),
  ('local-services', 'Cleaning'),
  ('local-services', 'Plumbing'),
  ('local-services', 'Electrical Repairs'),
  ('local-services', 'Electrician'),
  ('local-services', 'Carpentry'),
  ('local-services', 'Painting Services'),
  ('local-services', 'Handyman'),
  ('local-services', 'Locksmith'),
  ('local-services', 'Laundry'),
  ('local-services', 'Tailoring'),
  ('local-services', 'Installation'),
  ('local-services', 'Domestic Services'),
  ('local-services', 'Home Repairs'),
  ('local-services', 'Local Professionals'),
  ('travel-transport', 'Travel'),
  ('travel-transport', 'Transportation'),
  ('travel-transport', 'Transport'),
  ('travel-transport', 'Logistics'),
  ('travel-transport', 'Delivery'),
  ('travel-transport', 'Shipping'),
  ('travel-transport', 'Courier'),
  ('travel-transport', 'Tourism'),
  ('travel-transport', 'Holidays'),
  ('travel-transport', 'Vacation'),
  ('travel-transport', 'Car Hire'),
  ('travel-transport', 'Vehicle Rental'),
  ('travel-transport', 'Bus Services'),
  ('travel-transport', 'Travel Services'),
  ('travel-transport', 'Moving Services'),
  ('travel-transport', 'Haulage'),
  ('travel-transport', 'Freight'),
  ('automotive', 'Cars'),
  ('automotive', 'Vehicles'),
  ('automotive', 'Automobiles'),
  ('automotive', 'Motors'),
  ('automotive', 'Motorcycles'),
  ('automotive', 'Bikes'),
  ('automotive', 'Car Parts'),
  ('automotive', 'Auto Parts'),
  ('automotive', 'Spare Parts'),
  ('automotive', 'Vehicle Accessories'),
  ('automotive', 'Tyres'),
  ('automotive', 'Tires'),
  ('automotive', 'Car Maintenance'),
  ('automotive', 'Automotive Equipment'),
  ('automotive', 'Vehicle Sales'),
  ('property', 'Real Estate'),
  ('property', 'Houses'),
  ('property', 'Homes'),
  ('property', 'Land'),
  ('property', 'Apartments'),
  ('property', 'Flats'),
  ('property', 'Buildings'),
  ('property', 'Commercial Property'),
  ('property', 'Residential Property'),
  ('property', 'Property Sales'),
  ('property', 'Property Rental'),
  ('property', 'Rent'),
  ('property', 'Housing'),
  ('property', 'Warehouses'),
  ('property', 'Shops'),
  ('property', 'Office Space'),
  ('property', 'Real Estate Listings'),
  ('business-industry', 'Business'),
  ('business-industry', 'Industrial'),
  ('business-industry', 'Manufacturing'),
  ('business-industry', 'Machinery'),
  ('business-industry', 'Industrial Equipment'),
  ('business-industry', 'Agricultural Equipment'),
  ('business-industry', 'Farming Equipment'),
  ('business-industry', 'Construction Equipment'),
  ('business-industry', 'Wholesale'),
  ('business-industry', 'Bulk Supplies'),
  ('business-industry', 'Commercial Equipment'),
  ('business-industry', 'Factory Equipment'),
  ('business-industry', 'Business Supplies'),
  ('business-industry', 'Heavy Equipment'),
  ('gifts-specialty', 'Gifts'),
  ('gifts-specialty', 'Gift Items'),
  ('gifts-specialty', 'Presents'),
  ('gifts-specialty', 'Souvenirs'),
  ('gifts-specialty', 'Specialty Products'),
  ('gifts-specialty', 'Unique Items'),
  ('gifts-specialty', 'Customized Gifts'),
  ('gifts-specialty', 'Personalized Gifts'),
  ('gifts-specialty', 'Handmade Items'),
  ('gifts-specialty', 'Collectibles'),
  ('gifts-specialty', 'Novelty Items'),
  ('gifts-specialty', 'Special Occasions'),
  ('gifts-specialty', 'Other Products'),
  ('gifts-specialty', 'Miscellaneous Items'),
  ('construction-building', 'Construction'),
  ('construction-building', 'Building'),
  ('construction-building', 'Building Services'),
  ('construction-building', 'Electrical Services'),
  ('construction-building', 'Builders'),
  ('construction-building', 'Contractors'),
  ('construction-building', 'Building Supplies'),
  ('construction-building', 'Building Works'),
  ('construction-building', 'Renovation'),
  ('construction-building', 'Remodeling'),
  ('construction-building', 'Site Works'),
  ('construction-building', 'Civil Works'),
  ('artisans-technicians', 'Artisans'),
  ('artisans-technicians', 'Technicians'),
  ('artisans-technicians', 'Repairs'),
  ('artisans-technicians', 'Repair Services'),
  ('artisans-technicians', 'Fundis'),
  ('artisans-technicians', 'Handymen'),
  ('artisans-technicians', 'Mechanics'),
  ('artisans-technicians', 'Maintenance Services'),
  ('artisans-technicians', 'Repair Technicians'),
  ('fashion', 'Clothing'),
  ('fashion', 'Clothes'),
  ('fashion', 'Fashion Wear'),
  ('fashion', 'Outfits'),
  ('fashion', 'Apparel'),
  ('beauty-skincare', 'Cosmetics'),
  ('beauty-skincare', 'Makeup'),
  ('beauty-skincare', 'Skincare'),
  ('beauty-skincare', 'Beauty Products'),
  ('beauty-skincare', 'Skin Care'),
  ('hair-haircare', 'Haircare'),
  ('hair-haircare', 'Hair Care Products'),
  ('hair-haircare', 'Barbing'),
  ('hair-haircare', 'Hair Extensions'),
  ('hair-haircare', 'Hair Styling'),
  ('fragrances', 'Perfume'),
  ('fragrances', 'Perfumes'),
  ('fragrances', 'Cologne'),
  ('fragrances', 'Body Spray'),
  ('fragrances', 'Scent'),
  ('fragrances', 'Aftershave'),
  ('fragrances', 'Fragrance'),
  ('jewelry', 'Jewellery'),
  ('jewelry', 'Rings'),
  ('jewelry', 'Necklaces'),
  ('jewelry', 'Earrings'),
  ('jewelry', 'Bracelets'),
  ('watches', 'Wristwatches'),
  ('watches', 'Timepieces'),
  ('watches', 'Watch'),
  ('bags-luggage', 'Handbags'),
  ('bags-luggage', 'Backpacks'),
  ('bags-luggage', 'Purses'),
  ('bags-luggage', 'Travel Bags'),
  ('bags-luggage', 'Suitcases'),
  ('shoes', 'Footwear'),
  ('shoes', 'Sneakers'),
  ('shoes', 'Sandals'),
  ('shoes', 'Slippers'),
  ('shoes', 'Boots'),
  ('mens-clothing', 'Men''s Wear'),
  ('mens-clothing', 'Mens Wear'),
  ('mens-clothing', 'Male Clothing'),
  ('mens-clothing', 'Men''s Clothes'),
  ('womens-clothing', 'Women''s Wear'),
  ('womens-clothing', 'Womens Wear'),
  ('womens-clothing', 'Ladies Clothing'),
  ('womens-clothing', 'Female Clothing'),
  ('womens-clothing', 'Women''s Clothes'),
  ('sportswear', 'Activewear'),
  ('sportswear', 'Gym Wear'),
  ('sportswear', 'Athletic Wear'),
  ('sportswear', 'Workout Clothes'),
  ('traditional-cultural-wear', 'Ankara'),
  ('traditional-cultural-wear', 'Aso Ebi'),
  ('traditional-cultural-wear', 'Native Wear'),
  ('traditional-cultural-wear', 'Agbada'),
  ('traditional-cultural-wear', 'Traditional Attire'),
  ('fashion-accessories', 'Accessories'),
  ('fashion-accessories', 'Belts'),
  ('fashion-accessories', 'Scarves'),
  ('fashion-accessories', 'Sunglasses'),
  ('office-business-supplies', 'Office Supplies'),
  ('office-business-supplies', 'Business Supplies'),
  ('industrial-equipment', 'Machinery'),
  ('industrial-equipment', 'Factory Equipment'),
  ('agricultural-equipment', 'Farming Equipment'),
  ('agricultural-equipment', 'Farm Machinery'),
  ('property-for-sale', 'Houses for Sale'),
  ('property-for-sale', 'Land for Sale'),
  ('property-for-sale', 'Apartments for Sale'),
  ('property-for-rent', 'Houses for Rent'),
  ('property-for-rent', 'Rentals'),
  ('property-for-rent', 'Apartments for Rent'),
  ('property-for-rent', 'Flats for Rent'),
  ('other', 'Miscellaneous'),
  ('other', 'Specialty Items'),
  ('pet-supplies', 'Pet Food'),
  ('pet-supplies', 'Pet Accessories'),
  ('pet-supplies', 'Animal Supplies'),
  ('gifts-souvenirs', 'Gift Items'),
  ('gifts-souvenirs', 'Presents'),
  ('gifts-souvenirs', 'Souvenirs'),
  ('religious-inspirational', 'Religious Items'),
  ('religious-inspirational', 'Christian Products'),
  ('religious-inspirational', 'Islamic Products'),
  ('collectibles-antiques', 'Antiques'),
  ('collectibles-antiques', 'Vintage Items'),
  ('collectibles-antiques', 'Collectibles'),
  ('services', 'Service Providers'),
  ('business-services', 'Corporate Services'),
  ('business-services', 'Business Support'),
  ('graphic-design', 'Logo Design'),
  ('graphic-design', 'Branding Design'),
  ('web-development', 'Website Development'),
  ('web-development', 'Web Design'),
  ('web-development', 'Web Developer'),
  ('app-development', 'Mobile App Development'),
  ('app-development', 'Software Development'),
  ('ai-automation-services', 'Artificial Intelligence'),
  ('ai-automation-services', 'Automation'),
  ('ai-automation-services', 'Chatbots'),
  ('marketing-advertising', 'Digital Marketing'),
  ('marketing-advertising', 'Advertising'),
  ('marketing-advertising', 'Promotion'),
  ('social-media-services', 'Social Media Management'),
  ('social-media-services', 'SMM'),
  ('photography-services', 'Photographer'),
  ('photography-services', 'Photo Shoots'),
  ('video-production', 'Videography'),
  ('video-production', 'Video Editing'),
  ('music-audio-services', 'Audio Production'),
  ('music-audio-services', 'Sound Engineering'),
  ('writing-editing', 'Copywriting'),
  ('writing-editing', 'Proofreading'),
  ('writing-editing', 'Content Writing'),
  ('consulting', 'Consultancy'),
  ('consulting', 'Advisory Services'),
  ('legal-services', 'Legal Consultation'),
  ('legal-services', 'Lawyer'),
  ('legal-services', 'Attorney'),
  ('accounting-finance-services', 'Bookkeeping'),
  ('accounting-finance-services', 'Tax Services'),
  ('accounting-finance-services', 'Financial Advice'),
  ('education-tutoring', 'Tutors'),
  ('education-tutoring', 'Lessons'),
  ('education-tutoring', 'Teaching'),
  ('business-corporate-law', 'Corporate Law'),
  ('business-corporate-law', 'Business Lawyer'),
  ('property-real-estate-law', 'Real Estate Law'),
  ('property-real-estate-law', 'Property Lawyer'),
  ('family-matrimonial-law', 'Divorce Lawyer'),
  ('family-matrimonial-law', 'Family Lawyer'),
  ('family-matrimonial-law', 'Marriage Law'),
  ('criminal-defense-litigation', 'Criminal Lawyer'),
  ('criminal-defense-litigation', 'Litigation Lawyer'),
  ('immigration-visa-law', 'Immigration Lawyer'),
  ('immigration-visa-law', 'Visa Services'),
  ('immigration-visa-law', 'Immigration Law'),
  ('intellectual-property-law', 'IP Law'),
  ('intellectual-property-law', 'Patent Lawyer'),
  ('intellectual-property-law', 'Trademark Lawyer'),
  ('intellectual-property-law', 'Copyright Law'),
  ('employment-labour-law', 'Employment Lawyer'),
  ('employment-labour-law', 'Labour Law'),
  ('employment-labour-law', 'Labor Law'),
  ('employment-labour-law', 'Workplace Law'),
  ('contract-drafting-review', 'Contract Lawyer'),
  ('contract-drafting-review', 'Contract Review'),
  ('contract-drafting-review', 'Legal Drafting'),
  ('tax-financial-law', 'Tax Lawyer'),
  ('tax-financial-law', 'Tax Law'),
  ('tax-financial-law', 'Financial Law'),
  ('dispute-resolution-mediation', 'Mediation'),
  ('dispute-resolution-mediation', 'Arbitration'),
  ('dispute-resolution-mediation', 'Dispute Resolution'),
  ('wills-probate-estate', 'Wills'),
  ('wills-probate-estate', 'Inheritance'),
  ('wills-probate-estate', 'Probate'),
  ('wills-probate-estate', 'Estate Administration'),
  ('wills-probate-estate', 'Estate Planning'),
  ('repair-services', 'Repairs'),
  ('repair-services', 'Repair'),
  ('repair-services', 'Fix It Services'),
  ('home-services', 'Domestic Services'),
  ('home-services', 'Household Services'),
  ('cleaning-services', 'Cleaners'),
  ('cleaning-services', 'House Cleaning'),
  ('cleaning-services', 'Office Cleaning'),
  ('beauty-services', 'Makeup Artist'),
  ('beauty-services', 'Beauty Treatments'),
  ('hair-barber-services', 'Barber'),
  ('hair-barber-services', 'Hairdresser'),
  ('hair-barber-services', 'Salon'),
  ('fashion-design-tailoring', 'Tailor'),
  ('fashion-design-tailoring', 'Seamstress'),
  ('fashion-design-tailoring', 'Fashion Designer'),
  ('printing-branding', 'Printing Services'),
  ('printing-branding', 'Branding'),
  ('printing-branding', 'Print Shop'),
  ('digital', 'Downloads'),
  ('digital', 'Digital Files'),
  ('digital', 'Online Products'),
  ('ebooks', 'Digital Books'),
  ('online-courses', 'Courses'),
  ('online-courses', 'E-learning'),
  ('online-courses', 'Tutorials'),
  ('templates-design-assets', 'Templates'),
  ('templates-design-assets', 'Design Files'),
  ('templates-design-assets', 'Graphics'),
  ('software-apps', 'Software'),
  ('software-apps', 'Applications'),
  ('software-apps', 'Mobile Apps'),
  ('software-apps', 'Computer Programs'),
  ('music-audio-files', 'Beats'),
  ('music-audio-files', 'Sound Files'),
  ('music-audio-files', 'Audio Tracks'),
  ('photography-stock-media', 'Stock Photos'),
  ('photography-stock-media', 'Stock Images'),
  ('photography-stock-media', 'Stock Footage'),
  ('domains-websites', 'Domain Names'),
  ('domains-websites', 'Websites for Sale'),
  ('home-kitchen', 'Kitchenware'),
  ('home-kitchen', 'Kitchen Utensils'),
  ('home-kitchen', 'Cookware'),
  ('home-kitchen', 'Kitchen Tools'),
  ('furniture', 'Sofas'),
  ('furniture', 'Chairs'),
  ('furniture', 'Tables'),
  ('furniture', 'Cabinets'),
  ('home-decor', 'Interior Decor'),
  ('home-decor', 'Wall Art'),
  ('home-decor', 'Decorations'),
  ('home-decor', 'Decor'),
  ('bedding-bath', 'Bedsheets'),
  ('bedding-bath', 'Duvets'),
  ('bedding-bath', 'Towels'),
  ('bedding-bath', 'Bathroom Accessories'),
  ('bedding-bath', 'Mattresses'),
  ('cleaning-supplies', 'Cleaners'),
  ('cleaning-supplies', 'Cleaning Products'),
  ('cleaning-supplies', 'Detergents'),
  ('garden-outdoor', 'Gardening'),
  ('garden-outdoor', 'Outdoor Furniture'),
  ('garden-outdoor', 'Patio'),
  ('garden-outdoor', 'Garden Tools'),
  ('tools-hardware', 'Hand Tools'),
  ('tools-hardware', 'Power Tools'),
  ('tools-hardware', 'Hardware Supplies'),
  ('building-materials', 'Construction Materials'),
  ('building-materials', 'Building Supplies'),
  ('electrical-installation-repairs', 'Electrician'),
  ('electrical-installation-repairs', 'Electrical Wiring'),
  ('electrical-installation-repairs', 'Wiring Repairs'),
  ('electrical-installation-repairs', 'Electrical Installer'),
  ('electrical-materials-accessories', 'Electrical Supplies'),
  ('electrical-materials-accessories', 'Wiring Materials'),
  ('solar-inverter-installation', 'Solar Installer'),
  ('solar-inverter-installation', 'Inverter Setup'),
  ('solar-inverter-installation', 'Solar Installation'),
  ('generators-power-systems', 'Generator'),
  ('generators-power-systems', 'Power Backup'),
  ('generators-power-systems', 'Gen Set'),
  ('lighting-fixtures', 'Light Fittings'),
  ('lighting-fixtures', 'Bulbs'),
  ('lighting-fixtures', 'Chandeliers'),
  ('lighting-fixtures', 'Lights'),
  ('wiring-cables-distribution', 'Electrical Cables'),
  ('wiring-cables-distribution', 'Wires'),
  ('wiring-cables-distribution', 'Distribution Board'),
  ('building-contractors', 'Contractor'),
  ('building-contractors', 'Builder'),
  ('building-contractors', 'Construction Company'),
  ('building-materials-supplies', 'Construction Materials'),
  ('building-materials-supplies', 'Building Supplies'),
  ('cement-blocks-concrete', 'Cement'),
  ('cement-blocks-concrete', 'Blocks'),
  ('cement-blocks-concrete', 'Bricks'),
  ('cement-blocks-concrete', 'Concrete'),
  ('roofing-ceiling', 'Roofer'),
  ('roofing-ceiling', 'Roof Repairs'),
  ('roofing-ceiling', 'Ceiling Installation'),
  ('roofing-ceiling', 'Roofing'),
  ('tiles-flooring', 'Tiler'),
  ('tiles-flooring', 'Floor Tiles'),
  ('tiles-flooring', 'Flooring'),
  ('painting-wall-finishing', 'Painter'),
  ('painting-wall-finishing', 'Wall Painting'),
  ('painting-wall-finishing', 'Decorating'),
  ('doors-windows-aluminium', 'Aluminium Fabrication'),
  ('doors-windows-aluminium', 'Window Installation'),
  ('doors-windows-aluminium', 'Door Installation'),
  ('welding-fabrication', 'Welder'),
  ('welding-fabrication', 'Metal Fabrication'),
  ('welding-fabrication', 'Welding'),
  ('carpentry-woodwork', 'Carpenter'),
  ('carpentry-woodwork', 'Woodworker'),
  ('carpentry-woodwork', 'Furniture Maker'),
  ('plumbing-installation-repairs', 'Plumber'),
  ('plumbing-installation-repairs', 'Pipe Fitting'),
  ('plumbing-installation-repairs', 'Plumbing'),
  ('plumbing-materials', 'Plumbing Supplies'),
  ('plumbing-materials', 'Pipe Fittings'),
  ('borehole-water-systems', 'Borehole'),
  ('borehole-water-systems', 'Well Drilling'),
  ('borehole-water-systems', 'Water Supply'),
  ('water-tanks-pumps', 'Water Tank'),
  ('water-tanks-pumps', 'Water Pump'),
  ('water-tanks-pumps', 'Water Treatment'),
  ('air-conditioning-refrigeration', 'AC Repair'),
  ('air-conditioning-refrigeration', 'Fridge Repair'),
  ('air-conditioning-refrigeration', 'Cooling Systems'),
  ('air-conditioning-refrigeration', 'Air Conditioner'),
  ('building-renovation', 'Renovation'),
  ('building-renovation', 'Remodeling'),
  ('building-renovation', 'Home Improvement'),
  ('pop-screeding-finishing', 'POP Ceiling'),
  ('pop-screeding-finishing', 'Screeding'),
  ('pop-screeding-finishing', 'Interior Finishing'),
  ('waterproofing-damp-control', 'Waterproofing'),
  ('waterproofing-damp-control', 'Damp Proofing'),
  ('landscaping-exterior', 'Landscaper'),
  ('landscaping-exterior', 'Gardening'),
  ('landscaping-exterior', 'Exterior Design'),
  ('building-maintenance-handyman', 'Handyman'),
  ('building-maintenance-handyman', 'Maintenance'),
  ('building-maintenance-handyman', 'Repairs'),
  ('architectural-design', 'Architect'),
  ('architectural-design', 'Building Design'),
  ('architectural-design', 'Blueprints'),
  ('civil-structural-engineering', 'Civil Engineer'),
  ('civil-structural-engineering', 'Structural Engineer'),
  ('quantity-surveying', 'Quantity Surveyor'),
  ('quantity-surveying', 'Cost Estimator'),
  ('land-surveying-site-prep', 'Land Surveyor'),
  ('land-surveying-site-prep', 'Site Preparation'),
  ('building-inspection-supervision', 'Building Inspector'),
  ('building-inspection-supervision', 'Project Supervisor'),
  ('construction-tools-equipment', 'Construction Equipment'),
  ('construction-tools-equipment', 'Builders Tools'),
  ('heavy-machinery-rental', 'Heavy Equipment'),
  ('heavy-machinery-rental', 'Machinery Rental'),
  ('scaffolding-formwork', 'Scaffold'),
  ('scaffolding-formwork', 'Formwork'),
  ('cctv-security-installation', 'CCTV Installer'),
  ('cctv-security-installation', 'Security Camera'),
  ('cctv-security-installation', 'CCTV Installation'),
  ('smart-home-automation', 'Smart Home'),
  ('smart-home-automation', 'Home Automation'),
  ('books', 'Novels'),
  ('books', 'Textbooks'),
  ('books', 'Reading Materials'),
  ('stationery', 'Office Supplies'),
  ('stationery', 'Writing Materials'),
  ('art-crafts', 'Craft Supplies'),
  ('art-crafts', 'Artwork'),
  ('art-crafts', 'Handicrafts'),
  ('music', 'Instruments'),
  ('music', 'Musical Instruments'),
  ('movies-entertainment', 'Films'),
  ('movies-entertainment', 'Movies'),
  ('movies-entertainment', 'DVDs'),
  ('event-tickets', 'Tickets'),
  ('event-tickets', 'Concert Tickets'),
  ('event-tickets', 'Show Tickets'),
  ('phones-tablets', 'Smartphones'),
  ('phones-tablets', 'Cellphones'),
  ('phones-tablets', 'Handsets'),
  ('phones-tablets', 'Mobile Phones'),
  ('phones-tablets', 'Phones'),
  ('phones-tablets', 'Tablet'),
  ('computers-laptops', 'PCs'),
  ('computers-laptops', 'Desktops'),
  ('computers-laptops', 'Computer Systems'),
  ('computers-laptops', 'Laptop'),
  ('computers-laptops', 'Computer'),
  ('computer-accessories', 'PC Accessories'),
  ('computer-accessories', 'Keyboards'),
  ('computer-accessories', 'Mice'),
  ('computer-accessories', 'Computer Peripherals'),
  ('electronics', 'Electronic Gadgets'),
  ('electronics', 'Electronic Devices'),
  ('electronics', 'Gadgets'),
  ('audio-headphones', 'Earphones'),
  ('audio-headphones', 'Speakers'),
  ('audio-headphones', 'Sound Systems'),
  ('audio-headphones', 'Headsets'),
  ('cameras-photography', 'Camera Equipment'),
  ('cameras-photography', 'Photography Gear'),
  ('cameras-photography', 'Camera'),
  ('cameras-photography', 'Lenses'),
  ('gaming', 'Video Games'),
  ('gaming', 'Game Consoles'),
  ('gaming', 'Gaming Accessories'),
  ('gaming', 'Games'),
  ('smart-devices', 'Smart Gadgets'),
  ('smart-devices', 'IoT Devices'),
  ('smart-devices', 'Wearables'),
  ('smart-devices', 'Smartwatch'),
  ('tv-home-entertainment', 'Television'),
  ('tv-home-entertainment', 'TVs'),
  ('tv-home-entertainment', 'Home Theatre'),
  ('tv-home-entertainment', 'Home Cinema'),
  ('appliances', 'Household Appliances'),
  ('appliances', 'Kitchen Appliances'),
  ('appliances', 'Home Appliances'),
  ('solar-power', 'Solar Panels'),
  ('solar-power', 'Inverters'),
  ('solar-power', 'Power Backup'),
  ('solar-power', 'Solar Energy'),
  ('health-wellness', 'Health Products'),
  ('health-wellness', 'Wellness Products'),
  ('fitness-gym', 'Gym Equipment'),
  ('fitness-gym', 'Workout Gear'),
  ('fitness-gym', 'Exercise Equipment'),
  ('sports-equipment', 'Sporting Goods'),
  ('sports-equipment', 'Sports Gear'),
  ('medical-supplies', 'Healthcare Supplies'),
  ('medical-supplies', 'Medical Equipment'),
  ('food-groceries', 'Foodstuff'),
  ('food-groceries', 'Provisions'),
  ('food-groceries', 'Groceries'),
  ('food-groceries', 'Food Items'),
  ('drinks-beverages', 'Drinks'),
  ('drinks-beverages', 'Soft Drinks'),
  ('drinks-beverages', 'Juices'),
  ('drinks-beverages', 'Water'),
  ('drinks-beverages', 'Beverages'),
  ('snacks-confectionery', 'Snacks'),
  ('snacks-confectionery', 'Sweets'),
  ('snacks-confectionery', 'Candy'),
  ('snacks-confectionery', 'Chin Chin'),
  ('baked-goods', 'Bread'),
  ('baked-goods', 'Pastries'),
  ('baked-goods', 'Confectionery'),
  ('catering', 'Caterers'),
  ('catering', 'Event Catering'),
  ('catering', 'Catering Services'),
  ('farm-produce', 'Agricultural Produce'),
  ('farm-produce', 'Fresh Produce'),
  ('farm-produce', 'Farm Goods'),
  ('meat-seafood', 'Meat'),
  ('meat-seafood', 'Fish'),
  ('meat-seafood', 'Poultry'),
  ('meat-seafood', 'Seafood'),
  ('private-chefs-cooks', 'Personal Chef'),
  ('private-chefs-cooks', 'Home Chef'),
  ('private-chefs-cooks', 'Private Cook'),
  ('home-cooked-meals', 'Home Food'),
  ('home-cooked-meals', 'Food Delivery'),
  ('home-cooked-meals', 'Meal Delivery'),
  ('outdoor-catering-bbq', 'BBQ'),
  ('outdoor-catering-bbq', 'Barbecue'),
  ('outdoor-catering-bbq', 'Grill Catering'),
  ('meal-prep-subscriptions', 'Meal Plans'),
  ('meal-prep-subscriptions', 'Food Subscription'),
  ('meal-prep-subscriptions', 'Meal Prep'),
  ('culinary-training-classes', 'Cooking Classes'),
  ('culinary-training-classes', 'Culinary School'),
  ('culinary-training-classes', 'Chef Training'),
  ('bartending-beverage-services', 'Bartender'),
  ('bartending-beverage-services', 'Mixology'),
  ('bartending-beverage-services', 'Drinks Service'),
  ('food-decoration-presentation', 'Food Styling'),
  ('food-decoration-presentation', 'Event Food Decor'),
  ('restaurant-kitchen-consulting', 'Restaurant Consulting'),
  ('restaurant-kitchen-consulting', 'Kitchen Setup'),
  ('event-catering-services', 'Party Catering'),
  ('event-catering-services', 'Wedding Catering'),
  ('cakes-pastries-baking', 'Cakes'),
  ('cakes-pastries-baking', 'Pastries'),
  ('cakes-pastries-baking', 'Baking'),
  ('cakes-pastries-baking', 'Baker'),
  ('cars-vehicles', 'Cars'),
  ('cars-vehicles', 'Vehicles'),
  ('cars-vehicles', 'Automobiles'),
  ('auto-parts-accessories', 'Spare Parts'),
  ('auto-parts-accessories', 'Car Parts'),
  ('auto-parts-accessories', 'Vehicle Parts'),
  ('motorcycles-bicycles', 'Motorbikes'),
  ('motorcycles-bicycles', 'Bikes'),
  ('motorcycles-bicycles', 'Okada'),
  ('motorcycles-bicycles', 'Bicycles'),
  ('appliance-repairs', 'Appliance Repair'),
  ('appliance-repairs', 'Appliance Technician'),
  ('phone-tablet-repairs', 'Phone Repair'),
  ('phone-tablet-repairs', 'Screen Repair'),
  ('phone-tablet-repairs', 'Tablet Repair'),
  ('computer-laptop-repairs', 'Computer Repair'),
  ('computer-laptop-repairs', 'Laptop Repair'),
  ('electronics-repairs', 'Electronics Technician'),
  ('electronics-repairs', 'Electronics Repair'),
  ('generator-repairs', 'Generator Technician'),
  ('generator-repairs', 'Generator Repair'),
  ('solar-inverter-technicians', 'Solar Technician'),
  ('solar-inverter-technicians', 'Inverter Repair'),
  ('electrical-repairs', 'Electrician'),
  ('electrical-repairs', 'Electrical Repair'),
  ('plumbing-pipe-repairs', 'Plumber'),
  ('plumbing-pipe-repairs', 'Pipe Repair'),
  ('ac-refrigeration-repairs', 'AC Repair'),
  ('ac-refrigeration-repairs', 'Fridge Technician'),
  ('ac-refrigeration-repairs', 'Air Conditioner Repair'),
  ('automotive-mechanics', 'Mechanic'),
  ('automotive-mechanics', 'Car Repair'),
  ('auto-electricians-diagnostics', 'Auto Electrician'),
  ('auto-electricians-diagnostics', 'Car Diagnostics'),
  ('motorcycle-tricycle-repairs', 'Okada Repair'),
  ('motorcycle-tricycle-repairs', 'Keke Repair'),
  ('motorcycle-tricycle-repairs', 'Motorcycle Repair'),
  ('welding-metal-fabrication', 'Welder'),
  ('welding-metal-fabrication', 'Metal Fabrication'),
  ('carpentry-furniture-repairs', 'Carpenter'),
  ('carpentry-furniture-repairs', 'Furniture Repair'),
  ('upholstery-restoration', 'Upholsterer'),
  ('upholstery-restoration', 'Upholstery Repair'),
  ('tailoring-alterations', 'Tailor'),
  ('tailoring-alterations', 'Seamstress'),
  ('tailoring-alterations', 'Alterations'),
  ('shoe-making-repairs', 'Cobbler'),
  ('shoe-making-repairs', 'Shoe Repair'),
  ('painting-decorating', 'Painter'),
  ('painting-decorating', 'Decorator'),
  ('tiling-flooring', 'Tiler'),
  ('tiling-flooring', 'Floor Tiling'),
  ('pop-ceiling-installation', 'POP Ceiling'),
  ('pop-ceiling-installation', 'Ceiling Installer'),
  ('locksmith-key-cutting', 'Locksmith'),
  ('locksmith-key-cutting', 'Keys'),
  ('locksmith-key-cutting', 'Lock Repairs'),
  ('locksmith-key-cutting', 'Key Duplication'),
  ('cctv-security-technicians', 'CCTV Technician'),
  ('cctv-security-technicians', 'Security Technician'),
  ('borehole-pump-technicians', 'Borehole Technician'),
  ('borehole-pump-technicians', 'Pump Technician'),
  ('cleaning-maintenance-services', 'Cleaner'),
  ('cleaning-maintenance-services', 'Cleaning Technician'),
  ('general-handyman', 'Handyman'),
  ('general-handyman', 'Fundi'),
  ('general-handyman', 'General Repairs'),
  ('kids-clothing', 'Children''s Clothing'),
  ('kids-clothing', 'Kids Clothes'),
  ('kids-clothing', 'Baby Clothes'),
  ('baby-products', 'Baby Essentials'),
  ('baby-products', 'Infant Products'),
  ('toys-games', 'Toys'),
  ('toys-games', 'Games'),
  ('toys-games', 'Playthings'),
  ('logistics-delivery', 'Courier'),
  ('logistics-delivery', 'Shipping'),
  ('logistics-delivery', 'Delivery Services'),
  ('travel-tourism', 'Tour Operator'),
  ('travel-tourism', 'Travel Agency'),
  ('travel-tourism', 'Holidays'),
  ('hotels-accommodation', 'Hotel'),
  ('hotels-accommodation', 'Accommodation'),
  ('hotels-accommodation', 'Lodging'),
  ('car-hire-transport', 'Car Rental'),
  ('car-hire-transport', 'Vehicle Hire'),
  ('car-hire-transport', 'Transport Services'),
  ('short-stays-short-lets', 'Short Let'),
  ('short-stays-short-lets', 'Short Stay'),
  ('short-stays-short-lets', 'Airbnb'),
  ('serviced-apartments', 'Service Apartments'),
  ('serviced-apartments', 'Serviced Apartment'),
  ('guesthouses-lodges', 'Guesthouse'),
  ('guesthouses-lodges', 'Lodge'),
  ('vacation-rentals', 'Holiday Rentals'),
  ('vacation-rentals', 'Vacation Rental'),
  ('resorts', 'Resort'),
  ('hostels', 'Hostel'),
  ('hostels', 'Backpacker Lodging')

) as v(slug, alias) on v.slug = c.slug
on conflict (category_id, normalized_alias) do nothing;

-- ------------------------------------------------------------
-- 4. SEARCH — 7-tier ranking: exact name > exact alias > partial name
--    (whole phrase) > partial alias (whole phrase) > alias word match >
--    name word match > fuzzy fallback (Phase 5/6 matching + ranking).
--    Read-only; respects RLS of the calling role. Returns the real
--    category/department row so the frontend can navigate using existing
--    ids/slugs/routes.
-- ------------------------------------------------------------
create or replace function public.search_catalogue_categories(
  search_term text,
  result_limit integer default 20
)
returns table (
  category_id uuid,
  category_name text,
  category_slug text,
  is_department boolean,
  department_id uuid,
  department_name text,
  match_type text,
  rank integer
)
language sql
stable
as $$
  with term as (
    -- q: case-folded, trimmed full phrase, used for exact/partial whole-phrase
    --    matching (kept as typed, e.g. "men's clothing" still has the apostrophe).
    -- clean: same phrase with punctuation collapsed to spaces, used only to
    --    derive word tokens for multiword and fuzzy matching.
    -- Input is capped to 200 chars up front: every downstream branch scans
    -- proportionally to input size/word count, so unbounded input is a cheap
    -- way to force expensive scans — cap it before any work is done.
    select lower(trim(left(search_term, 200))) as q,
           lower(trim(regexp_replace(left(search_term, 200), '[^[:alnum:]]+', ' ', 'g'))) as clean
  ),
  tokens as (
    -- distinct words (>= 4 chars) from the query, so a multiword search like
    -- "Men's perfume" or "electrical repairs" can match on any significant
    -- word, not just when the whole typed phrase appears verbatim (Phase 5F).
    -- A 4-char floor (not 3) matters: 3-char fragments like "men" or "car"
    -- are coincidentally substrings of many unrelated words ("equipMENt",
    -- "skinCARe"), which was previously burying real matches in noise.
    -- Capped to 12 distinct tokens: each token fans out into its own scan
    -- across categories/aliases in the branches below, so an adversarially
    -- word-stuffed query can't force unbounded work.
    select distinct token
    from term, regexp_split_to_table(term.clean, '\s+') as token
    where length(token) >= 4
    limit 12
  ),
  strong_candidates as (
    -- 1. exact category/department name match
    select
      c.id as category_id, c.name as category_name, c.slug as category_slug,
      c.parent_id is null as is_department,
      coalesce(c.parent_id, c.id) as department_id,
      coalesce(p.name, c.name) as department_name,
      'exact_name'::text as match_type, 1 as rank
    from public.catalogue_categories c
    left join public.catalogue_categories p on p.id = c.parent_id
    cross join term
    where c.is_active and length(term.q) > 0 and lower(c.name) = term.q

    union all
    -- 2. exact alias match
    select
      c.id, c.name, c.slug,
      c.parent_id is null,
      coalesce(c.parent_id, c.id),
      coalesce(p.name, c.name),
      'exact_alias', 2
    from public.catalogue_search_aliases a
    join public.catalogue_categories c on c.id = a.category_id
    left join public.catalogue_categories p on p.id = c.parent_id
    cross join term
    where c.is_active and length(term.q) > 0 and a.normalized_alias = term.q

    union all
    -- 3. partial category/department name match: the whole typed phrase
    --    appears in the name. Guarded by a minimum length so very short
    --    input does not return excessively broad results (Phase 5E).
    select
      c.id, c.name, c.slug,
      c.parent_id is null,
      coalesce(c.parent_id, c.id),
      coalesce(p.name, c.name),
      'partial_name', 3
    from public.catalogue_categories c
    left join public.catalogue_categories p on p.id = c.parent_id
    cross join term
    where c.is_active and length(term.q) >= 3 and lower(c.name) like '%' || term.q || '%'

    union all
    -- 4. partial alias match (whole typed phrase)
    select
      c.id, c.name, c.slug,
      c.parent_id is null,
      coalesce(c.parent_id, c.id),
      coalesce(p.name, c.name),
      'partial_alias', 4
    from public.catalogue_search_aliases a
    join public.catalogue_categories c on c.id = a.category_id
    left join public.catalogue_categories p on p.id = c.parent_id
    cross join term
    where c.is_active and length(term.q) >= 3 and a.normalized_alias like '%' || term.q || '%'

    union all
    -- 5. multiword support (Phase 5F): one significant word of the query
    --    (>= 4 chars) matches an alias, e.g. "Men's perfume" finds the
    --    "Perfume" alias even though the whole phrase never appears
    --    anywhere verbatim. Ranked above a bare name-word match (6) because
    --    aliases are curated/intentional, so a word hit there is a more
    --    deliberate signal than a coincidental substring of a long name.
    select distinct
      c.id, c.name, c.slug,
      c.parent_id is null,
      coalesce(c.parent_id, c.id),
      coalesce(p.name, c.name),
      'partial_alias_word', 5
    from tokens t
    cross join public.catalogue_search_aliases a
    join public.catalogue_categories c on c.id = a.category_id
    left join public.catalogue_categories p on p.id = c.parent_id
    where c.is_active and a.normalized_alias like '%' || t.token || '%'

    union all
    -- 6. multiword support against the category/department name itself.
    select distinct
      c.id, c.name, c.slug,
      c.parent_id is null,
      coalesce(c.parent_id, c.id),
      coalesce(p.name, c.name),
      'partial_name_word', 6
    from tokens t
    cross join public.catalogue_categories c
    left join public.catalogue_categories p on p.id = c.parent_id
    where c.is_active and lower(c.name) like '%' || t.token || '%'
  ),
  -- 7. bounded fuzzy/typo match (Phase 5J), evaluated per word via
  --    word_similarity so e.g. "Perfum" still finds "Perfume". This only
  --    ever runs when steps 1-6 found nothing, so a coincidental trigram
  --    overlap (e.g. "wedding" vs "welding", "sneakers" vs "speakers")
  --    never buries a real match — it is strictly a last-resort fallback,
  --    matching Phase 6's "weaker fuzzy matches" being the lowest priority.
  fuzzy_candidates as (
    select distinct
      c.id as category_id, c.name as category_name, c.slug as category_slug,
      c.parent_id is null as is_department,
      coalesce(c.parent_id, c.id) as department_id,
      coalesce(p.name, c.name) as department_name,
      'fuzzy'::text as match_type, 7 as rank
    from tokens t
    cross join public.catalogue_categories c
    left join public.catalogue_categories p on p.id = c.parent_id
    where not exists (select 1 from strong_candidates)
      and c.is_active
      and word_similarity(t.token, lower(c.name)) > 0.4

    union all
    select distinct
      c.id, c.name, c.slug,
      c.parent_id is null,
      coalesce(c.parent_id, c.id),
      coalesce(p.name, c.name),
      'fuzzy', 7
    from tokens t
    cross join public.catalogue_search_aliases a
    join public.catalogue_categories c on c.id = a.category_id
    left join public.catalogue_categories p on p.id = c.parent_id
    where not exists (select 1 from strong_candidates)
      and c.is_active
      and word_similarity(t.token, a.normalized_alias) > 0.4
  ),
  candidates as (
    select * from strong_candidates
    union all
    select * from fuzzy_candidates
  ),
  -- keep each category's single best (lowest-rank) match, then present
  -- the overall list ranked best-first per the Phase 6 prioritization
  best_per_category as (
    select distinct on (category_id)
      category_id, category_name, category_slug, is_department,
      department_id, department_name, match_type, rank
    from candidates
    order by category_id, rank
  )
  select category_id, category_name, category_slug, is_department,
         department_id, department_name, match_type, rank
  from best_per_category
  -- tie-break: when a category and its own parent department match with
  -- equal rank, surface the more specific category first (Phase 6: don't
  -- force a department result when a precise category result exists).
  order by rank, is_department, category_name
  limit greatest(result_limit, 0);
$$;

-- Explicit, defense-in-depth read-only enforcement: strip the PUBLIC
-- execute privilege Postgres grants by default on new functions, then
-- grant it back only to the roles that should be able to search.
revoke all on function public.search_catalogue_categories(text, integer) from public;
grant execute on function public.search_catalogue_categories(text, integer) to anon, authenticated, service_role;

commit;

-- ------------------------------------------------------------
-- OPTIONAL CHECKS (read-only, run manually after review)
-- ------------------------------------------------------------
-- Coverage report: departments/categories with at least one alias.
-- select
--   count(*) filter (where parent_id is null) as total_departments,
--   count(*) filter (where parent_id is not null) as total_categories,
--   count(*) filter (where parent_id is null and id in (select category_id from public.catalogue_search_aliases)) as departments_with_aliases,
--   count(*) filter (where parent_id is not null and id in (select category_id from public.catalogue_search_aliases)) as categories_with_aliases
-- from public.catalogue_categories;
--
-- Spot-check the Phase 11 test cases:
-- select * from public.search_catalogue_categories('Perfume');
-- select * from public.search_catalogue_categories('Perfumes');
-- select * from public.search_catalogue_categories('Sneakers');
-- select * from public.search_catalogue_categories('Electrician');
-- select * from public.search_catalogue_categories('Locksmith');
-- select * from public.search_catalogue_categories('Inheritance');
-- select * from public.search_catalogue_categories('Jewelry');
-- select * from public.search_catalogue_categories('Apple'); -- ambiguous, expect multiple rows
-- select * from public.search_catalogue_categories('zzzznotreal'); -- expect empty set
