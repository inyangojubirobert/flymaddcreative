-- ============================================================
-- ONE DREAM CATALOGUE — DEPARTMENT 16
-- Construction, Electrical & Building Services (35 categories)
-- Safe to run repeatedly. Run after catalogue_department_scoped_names.sql
-- (the department name is 44 characters and needs the 60-character limit).
--
-- Additive only: no existing category is renamed, moved or removed.
-- ============================================================

do $$
begin
  if to_regclass('public.catalogue_categories_department_name_unique') is null
     or exists (select 1 from pg_constraint where conname = 'catalogue_categories_name_unique') then
    raise exception 'Run supabase/catalogue_department_scoped_names.sql first, then this script.';
  end if;
end $$;


-- ------------------------------------------------------------
-- DEPARTMENT
-- ------------------------------------------------------------

insert into public.catalogue_categories
(name, slug, icon, tint, ink, sort_order, is_featured, is_selectable, banner_subtitle)
values
('Construction, Electrical & Building Services', 'construction-building', 'hammer', '#FFEDD5', '#C2410C', 16, false, false,
 'Electricians, plumbers, builders, contractors and building supplies')
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
-- ELECTRICAL & POWER
('Electrical Installation & Repairs', 'electrical-installation-repairs', 'flash', '#FEF3C7', '#B45309', 201),
('Electrical Materials & Accessories', 'electrical-materials-accessories', 'flash-outline', '#FEF3C7', '#A16207', 202),
('Solar & Inverter Installation', 'solar-inverter-installation', 'sunny', '#FEF3C7', '#B45309', 203),
('Generators & Power Systems', 'generators-power-systems', 'battery-charging', '#FFEDD5', '#C2410C', 204),
('Lighting & Fixtures', 'lighting-fixtures', 'bulb', '#FEF9C3', '#A16207', 205),
('Wiring, Cables & Distribution Boards', 'wiring-cables-distribution', 'git-network', '#FFEDD5', '#9A3412', 206),

-- CONSTRUCTION & BUILDING
('Building Contractors & Construction', 'building-contractors', 'business', '#FFEDD5', '#C2410C', 207),
('Building Materials & Supplies', 'building-materials-supplies', 'construct', '#FFEDD5', '#9A3412', 208),
('Cement, Blocks, Bricks & Concrete', 'cement-blocks-concrete', 'cube', '#F1F5F9', '#475569', 209),
('Roofing & Ceiling Services', 'roofing-ceiling', 'home', '#FFEDD5', '#C2410C', 210),
('Tiles, Flooring & Installation', 'tiles-flooring', 'grid', '#E0F2FE', '#0369A1', 211),
('Painting & Wall Finishing', 'painting-wall-finishing', 'color-fill', '#FCE7F3', '#BE185D', 212),
('Doors, Windows & Aluminium Works', 'doors-windows-aluminium', 'browsers', '#E0E7FF', '#4338CA', 213),
('Welding, Fabrication & Metal Works', 'welding-fabrication', 'flame', '#FEE2E2', '#B91C1C', 214),
('Carpentry & Woodwork', 'carpentry-woodwork', 'hammer', '#FFEDD5', '#9A3412', 215),

-- PLUMBING & MECHANICAL
('Plumbing Installation & Repairs', 'plumbing-installation-repairs', 'water', '#E0F2FE', '#0369A1', 216),
('Pipes, Fittings & Plumbing Materials', 'plumbing-materials', 'git-merge', '#E0F2FE', '#0369A1', 217),
('Borehole Drilling & Water Systems', 'borehole-water-systems', 'water-outline', '#DBEAFE', '#1D4ED8', 218),
('Water Tanks, Pumps & Treatment', 'water-tanks-pumps', 'beaker', '#DBEAFE', '#1E40AF', 219),
('Air Conditioning & Refrigeration', 'air-conditioning-refrigeration', 'snow', '#E0F2FE', '#0369A1', 220),

-- PROPERTY IMPROVEMENT & MAINTENANCE
('Building Renovation & Remodeling', 'building-renovation', 'construct', '#DCFCE7', '#15803D', 221),
('POP, Screeding & Interior Finishing', 'pop-screeding-finishing', 'brush', '#FCE7F3', '#9D174D', 222),
('Waterproofing & Damp Control', 'waterproofing-damp-control', 'umbrella', '#E0F2FE', '#0369A1', 223),
('Landscaping & Exterior Works', 'landscaping-exterior', 'leaf', '#DCFCE7', '#166534', 224),
('Building Maintenance & Handyman Services', 'building-maintenance-handyman', 'build', '#F1F5F9', '#475569', 225),

-- TECHNICAL & PROFESSIONAL SERVICES
('Architectural Design & Building Plans', 'architectural-design', 'compass', '#E0E7FF', '#4338CA', 226),
('Civil & Structural Engineering', 'civil-structural-engineering', 'analytics', '#E0E7FF', '#3730A3', 227),
('Quantity Surveying & Cost Estimation', 'quantity-surveying', 'calculator', '#DCFCE7', '#15803D', 228),
('Land Surveying & Site Preparation', 'land-surveying-site-prep', 'map', '#FEF3C7', '#A16207', 229),
('Building Inspection & Project Supervision', 'building-inspection-supervision', 'clipboard', '#F1F5F9', '#334155', 230),

-- EQUIPMENT & SECURITY
('Construction Tools & Equipment', 'construction-tools-equipment', 'build-outline', '#F1F5F9', '#475569', 231),
('Heavy Machinery & Equipment Rental', 'heavy-machinery-rental', 'cog', '#F1F5F9', '#334155', 232),
('Scaffolding & Formwork', 'scaffolding-formwork', 'layers', '#FFEDD5', '#C2410C', 233),
('CCTV & Security System Installation', 'cctv-security-installation', 'videocam', '#E0E7FF', '#4338CA', 234),
('Smart Home & Building Automation', 'smart-home-automation', 'hardware-chip', '#DBEAFE', '#1D4ED8', 235)

on conflict (slug)
do update set
  name = excluded.name,
  icon = excluded.icon,
  tint = excluded.tint,
  ink = excluded.ink,
  sort_order = excluded.sort_order;


-- ------------------------------------------------------------
-- LINK CATEGORIES TO THE DEPARTMENT
-- ------------------------------------------------------------

update public.catalogue_categories as category
set parent_id = department.id,
    is_active = true,
    is_selectable = true
from public.catalogue_categories as department
where department.slug = 'construction-building'
  and category.slug in (
    'electrical-installation-repairs',
    'electrical-materials-accessories',
    'solar-inverter-installation',
    'generators-power-systems',
    'lighting-fixtures',
    'wiring-cables-distribution',
    'building-contractors',
    'building-materials-supplies',
    'cement-blocks-concrete',
    'roofing-ceiling',
    'tiles-flooring',
    'painting-wall-finishing',
    'doors-windows-aluminium',
    'welding-fabrication',
    'carpentry-woodwork',
    'plumbing-installation-repairs',
    'plumbing-materials',
    'borehole-water-systems',
    'water-tanks-pumps',
    'air-conditioning-refrigeration',
    'building-renovation',
    'pop-screeding-finishing',
    'waterproofing-damp-control',
    'landscaping-exterior',
    'building-maintenance-handyman',
    'architectural-design',
    'civil-structural-engineering',
    'quantity-surveying',
    'land-surveying-site-prep',
    'building-inspection-supervision',
    'construction-tools-equipment',
    'heavy-machinery-rental',
    'scaffolding-formwork',
    'cctv-security-installation',
    'smart-home-automation'
  );


-- ------------------------------------------------------------
-- CHECK: expect 16 departments and 35 categories here.
-- ------------------------------------------------------------
-- select count(*) from public.catalogue_categories where parent_id is null and is_active;
-- select count(*) from public.catalogue_categories c
--   join public.catalogue_categories d on d.id = c.parent_id
--   where d.slug = 'construction-building';
