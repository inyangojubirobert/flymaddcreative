-- ============================================================
-- ONE DREAM CATALOGUE — CULINARY, LEGAL, ARTISANS
-- Safe to run repeatedly. Run after add_construction_department.sql.
--
-- Food & Grocery        + 10 culinary categories
-- Professional Services + 11 legal categories, plus the existing
--                         legal-services row renamed "Legal Consultation & Advice"
-- Artisans, Technicians & Repairs: new department 17 with 25 categories
--
-- Existing categories (Catering, Baked Goods, Local Services and its
-- categories) are left exactly as they are.
-- Legal Services and Legal Consultation & Advice were the same thing in the
-- same department, so they are one row: the original legal-services id and
-- slug, named "Legal Consultation & Advice". Do not add a second legal
-- consultation category.
-- Artisans' "Air Conditioning & Refrigeration" shares its name with the
-- Construction category; that needs catalogue_department_scoped_names.sql first.
-- ============================================================

do $$
begin
  if to_regclass('public.catalogue_categories_department_name_unique') is null
     or exists (select 1 from pg_constraint where conname = 'catalogue_categories_name_unique') then
    raise exception 'Run supabase/catalogue_department_scoped_names.sql first, then this script.';
  end if;
end $$;

-- Merge an earlier separate legal-consultation-advice row into legal-services:
-- listings move to legal-services first, then the empty row is removed.
do $$
declare
  keep_id uuid;
  dup_id uuid;
begin
  select id into keep_id from public.catalogue_categories where slug = 'legal-services';
  select id into dup_id from public.catalogue_categories where slug = 'legal-consultation-advice';

  if dup_id is not null and keep_id is not null then
    update public.catalogue_items set category_id = keep_id where category_id = dup_id;
    if exists (select 1 from public.catalogue_categories where parent_id = dup_id) then
      raise exception 'legal-consultation-advice has child categories; resolve them first.';
    end if;
    delete from public.catalogue_categories where id = dup_id;
  end if;
end $$;


-- ------------------------------------------------------------
-- DEPARTMENT 17
-- ------------------------------------------------------------

insert into public.catalogue_categories
(name, slug, icon, tint, ink, sort_order, is_featured, is_selectable, banner_subtitle)
values
('Artisans, Technicians & Repairs', 'artisans-technicians', 'build', '#ECFCCB', '#4D7C0F', 17, false, false,
 'Skilled hands for everyday repairs, installations and craftsmanship')
on conflict (slug)
do update set
  name = excluded.name,
  icon = excluded.icon,
  tint = excluded.tint,
  ink = excluded.ink,
  sort_order = excluded.sort_order,
  is_selectable = false,
  parent_id = null;


-- ------------------------------------------------------------
-- CATEGORIES
-- ------------------------------------------------------------

insert into public.catalogue_categories
(name, slug, icon, tint, ink, sort_order)
values
-- FOOD & GROCERY: CULINARY & CATERING
('Private Chefs & Personal Cooks', 'private-chefs-cooks', 'restaurant', '#FEF3C7', '#B45309', 301),
('Event Catering Services', 'event-catering-services', 'restaurant', '#FEF3C7', '#A16207', 309),
('Home-Cooked Meals & Food Delivery', 'home-cooked-meals', 'fast-food', '#FFEDD5', '#C2410C', 302),
('Cakes, Pastries & Baking', 'cakes-pastries-baking', 'restaurant', '#FCE7F3', '#BE185D', 310),
('Outdoor Catering & BBQ', 'outdoor-catering-bbq', 'flame', '#FEE2E2', '#B91C1C', 303),
('Meal Prep & Subscription Services', 'meal-prep-subscriptions', 'calendar', '#DCFCE7', '#15803D', 304),
('Culinary Training & Cooking Classes', 'culinary-training-classes', 'school', '#E0E7FF', '#4338CA', 305),
('Bartending & Beverage Services', 'bartending-beverage-services', 'wine', '#F3E8FF', '#7E22CE', 306),
('Food Decoration & Event Presentation', 'food-decoration-presentation', 'color-palette', '#FCE7F3', '#BE185D', 307),
('Restaurant & Kitchen Consulting', 'restaurant-kitchen-consulting', 'chatbubbles', '#DBEAFE', '#1D4ED8', 308),

-- PROFESSIONAL SERVICES: LEGAL ADVICE & SERVICES
('Legal Consultation & Advice', 'legal-services', 'scale', '#F1F5F9', '#334155', 75),
('Business & Corporate Law', 'business-corporate-law', 'briefcase', '#E0E7FF', '#4338CA', 311),
('Property & Real Estate Law', 'property-real-estate-law', 'business', '#DBEAFE', '#1D4ED8', 312),
('Family & Matrimonial Law', 'family-matrimonial-law', 'people', '#FCE7F3', '#BE185D', 313),
('Criminal Defense & Litigation', 'criminal-defense-litigation', 'shield', '#FEE2E2', '#B91C1C', 314),
('Immigration & Visa Law', 'immigration-visa-law', 'airplane', '#E0F2FE', '#0369A1', 315),
('Intellectual Property Law', 'intellectual-property-law', 'bulb', '#FEF3C7', '#B45309', 316),
('Employment & Labour Law', 'employment-labour-law', 'id-card', '#DCFCE7', '#15803D', 317),
('Contract Drafting & Review', 'contract-drafting-review', 'document-text', '#F1F5F9', '#475569', 318),
('Tax & Financial Law', 'tax-financial-law', 'calculator', '#DCFCE7', '#166534', 319),
('Dispute Resolution & Mediation', 'dispute-resolution-mediation', 'chatbubbles', '#EDE9FE', '#6D28D9', 320),
('Wills, Probate & Estate Planning', 'wills-probate-estate', 'document-lock', '#FFEDD5', '#9A3412', 321),

-- ARTISANS, TECHNICIANS & REPAIRS
('Appliance Repairs', 'appliance-repairs', 'cube', '#E0F2FE', '#0369A1', 331),
('Phone & Tablet Repairs', 'phone-tablet-repairs', 'phone-portrait', '#DBEAFE', '#1D4ED8', 332),
('Computer & Laptop Repairs', 'computer-laptop-repairs', 'laptop', '#E0E7FF', '#4338CA', 333),
('Electronics Repairs', 'electronics-repairs', 'tv', '#EDE9FE', '#6D28D9', 334),
('Generator Repairs & Maintenance', 'generator-repairs', 'battery-charging', '#FFEDD5', '#C2410C', 335),
('Solar & Inverter Technicians', 'solar-inverter-technicians', 'sunny', '#FEF3C7', '#B45309', 336),
('Electrical Repairs', 'electrical-repairs', 'flash', '#FEF3C7', '#A16207', 337),
('Plumbing & Pipe Repairs', 'plumbing-pipe-repairs', 'water', '#E0F2FE', '#0369A1', 338),
('Air Conditioning & Refrigeration', 'ac-refrigeration-repairs', 'snow', '#E0F2FE', '#0369A1', 339),
('Automotive Mechanics', 'automotive-mechanics', 'car', '#F1F5F9', '#334155', 340),
('Auto Electricians & Diagnostics', 'auto-electricians-diagnostics', 'pulse', '#F1F5F9', '#475569', 341),
('Motorcycle & Tricycle Repairs', 'motorcycle-tricycle-repairs', 'bicycle', '#DCFCE7', '#15803D', 342),
('Welding & Metal Fabrication', 'welding-metal-fabrication', 'flame', '#FEE2E2', '#B91C1C', 343),
('Carpentry & Furniture Repairs', 'carpentry-furniture-repairs', 'hammer', '#FFEDD5', '#9A3412', 344),
('Upholstery & Furniture Restoration', 'upholstery-restoration', 'bed', '#F3E8FF', '#7E22CE', 345),
('Tailoring & Clothing Alterations', 'tailoring-alterations', 'cut', '#FFE4E6', '#BE123C', 346),
('Shoe Making & Repairs', 'shoe-making-repairs', 'footsteps', '#FFEDD5', '#C2410C', 347),
('Painting & Decorating', 'painting-decorating', 'color-fill', '#FCE7F3', '#BE185D', 348),
('Tiling & Flooring', 'tiling-flooring', 'grid', '#E0F2FE', '#0369A1', 349),
('POP & Ceiling Installation', 'pop-ceiling-installation', 'brush', '#FCE7F3', '#9D174D', 350),
('Locksmith & Key Cutting', 'locksmith-key-cutting', 'key', '#FEF3C7', '#A16207', 351),
('CCTV & Security Technicians', 'cctv-security-technicians', 'videocam', '#E0E7FF', '#4338CA', 352),
('Borehole & Pump Technicians', 'borehole-pump-technicians', 'water-outline', '#DBEAFE', '#1D4ED8', 353),
('Cleaning & Maintenance Services', 'cleaning-maintenance-services', 'sparkles', '#DCFCE7', '#15803D', 354),
('General Handyman Services', 'general-handyman', 'build', '#F1F5F9', '#475569', 355)

on conflict (slug)
do update set
  name = excluded.name,
  icon = excluded.icon,
  tint = excluded.tint,
  ink = excluded.ink,
  sort_order = excluded.sort_order;


-- ------------------------------------------------------------
-- LINK CATEGORIES TO DEPARTMENTS
-- ------------------------------------------------------------

update public.catalogue_categories as category
set parent_id = department.id,
    is_active = true,
    is_selectable = true
from (
  values
    ('private-chefs-cooks', 'food-grocery'),
    ('event-catering-services', 'food-grocery'),
    ('home-cooked-meals', 'food-grocery'),
    ('cakes-pastries-baking', 'food-grocery'),
    ('outdoor-catering-bbq', 'food-grocery'),
    ('meal-prep-subscriptions', 'food-grocery'),
    ('culinary-training-classes', 'food-grocery'),
    ('bartending-beverage-services', 'food-grocery'),
    ('food-decoration-presentation', 'food-grocery'),
    ('restaurant-kitchen-consulting', 'food-grocery'),
    ('legal-services', 'professional-services'),
    ('business-corporate-law', 'professional-services'),
    ('property-real-estate-law', 'professional-services'),
    ('family-matrimonial-law', 'professional-services'),
    ('criminal-defense-litigation', 'professional-services'),
    ('immigration-visa-law', 'professional-services'),
    ('intellectual-property-law', 'professional-services'),
    ('employment-labour-law', 'professional-services'),
    ('contract-drafting-review', 'professional-services'),
    ('tax-financial-law', 'professional-services'),
    ('dispute-resolution-mediation', 'professional-services'),
    ('wills-probate-estate', 'professional-services'),
    ('appliance-repairs', 'artisans-technicians'),
    ('phone-tablet-repairs', 'artisans-technicians'),
    ('computer-laptop-repairs', 'artisans-technicians'),
    ('electronics-repairs', 'artisans-technicians'),
    ('generator-repairs', 'artisans-technicians'),
    ('solar-inverter-technicians', 'artisans-technicians'),
    ('electrical-repairs', 'artisans-technicians'),
    ('plumbing-pipe-repairs', 'artisans-technicians'),
    ('ac-refrigeration-repairs', 'artisans-technicians'),
    ('automotive-mechanics', 'artisans-technicians'),
    ('auto-electricians-diagnostics', 'artisans-technicians'),
    ('motorcycle-tricycle-repairs', 'artisans-technicians'),
    ('welding-metal-fabrication', 'artisans-technicians'),
    ('carpentry-furniture-repairs', 'artisans-technicians'),
    ('upholstery-restoration', 'artisans-technicians'),
    ('tailoring-alterations', 'artisans-technicians'),
    ('shoe-making-repairs', 'artisans-technicians'),
    ('painting-decorating', 'artisans-technicians'),
    ('tiling-flooring', 'artisans-technicians'),
    ('pop-ceiling-installation', 'artisans-technicians'),
    ('locksmith-key-cutting', 'artisans-technicians'),
    ('cctv-security-technicians', 'artisans-technicians'),
    ('borehole-pump-technicians', 'artisans-technicians'),
    ('cleaning-maintenance-services', 'artisans-technicians'),
    ('general-handyman', 'artisans-technicians')
) as membership(category_slug, department_slug)
join public.catalogue_categories as department
  on department.slug = membership.department_slug
where category.slug = membership.category_slug;


-- ------------------------------------------------------------
-- CHECK: expect 17 departments; Food & Grocery 17, Professional Services 27,
-- Artisans 25, Construction 35 (counts include hidden broad buckets).
-- ------------------------------------------------------------
-- select d.slug, count(c.id)
--   from public.catalogue_categories d
--   left join public.catalogue_categories c on c.parent_id = d.id
--  where d.parent_id is null and d.is_active
--  group by d.slug order by d.slug;
